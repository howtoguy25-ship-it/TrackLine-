// Fix pass 7 §1: smart exit gates (warehouses, depots, factories, car parks).
//
// Data: OpenStreetMap through our Overpass pipeline (services/siteExits.ts) -- site outlines
// (landuse=industrial/commercial, building=warehouse/industrial, amenity=parking), gates and
// barriers (barrier=gate/lift_gate/sliding_gate/swing_gate/...; access, opening_hours, entrance)
// and private service roads (highway=service + access=private/no/delivery). And our own answers
// (Firestore siteExits/{exitId}, server: firebase/functions/siteExitsCore.js).
//
// When to ask -- not every time:
//   * the route starts inside, or within 150 m of, a large site (> 5,000 m²) -- or a site we
//     already have answers for;
//   * AND the route's first stretch passes one of its gates (or runs along a private service
//     road), OR drivers have said that exit is sometimes closed at this time;
//   * NOT if 3+ recent answers at this time agree (then that's used automatically: closed ->
//     another exit before anyone is asked; open -> nothing), and NOT if this driver answered for
//     this exit in the last 7 days at a similar time;
//   * and only while stopped or under 10 km/h.
// Pure; tested in __tests__/fixPass7/exitGates.test.ts.
import type { LatLng } from "@/utils/polyline";
import { distanceKm } from "@/utils/geo";

export const SITE_MIN_AREA_M2 = 5000;
export const SITE_NEAR_M = 150;
export const ROUTE_START_M = 800;
export const GATE_ON_ROUTE_M = 15;
export const GATE_IN_SITE_M = 30;
export const PRIVATE_ROAD_M = 8;
export const ASK_MAX_KMH = 10;
export const ASK_SECONDS = 8;
export const MY_ANSWER_FRESH_MS = 7 * 24 * 3600 * 1000;
export const PATTERN_WINDOW_MS = 60 * 24 * 3600 * 1000;
export const PATTERN_MIN = 3;
export const PATTERN_AGREE = 0.75;

export const GATE_BARRIERS = ["gate", "lift_gate", "sliding_gate", "swing_gate", "chain", "barrier_board", "full-height_turnstile", "entrance"];
const PRIVATE_ACCESS = ["private", "no", "delivery", "customers", "destination"];

export type SiteKind = "industrial" | "commercial" | "warehouse" | "car_park";
export interface Site {
  id: string; // "w123" / "r45"
  kind: SiteKind;
  name: string | null;
  polygon: LatLng[];
  areaM2: number;
}
export interface Gate {
  id: string; // "n123" (an OSM node), or "w456" for the end of a private service road
  point: LatLng;
  barrier: string | null;
  access: string | null;
  openingHours: string | null;
}
export interface PrivateRoad {
  id: string;
  line: LatLng[];
}
export interface SiteData {
  sites: Site[];
  gates: Gate[];
  privateRoads: PrivateRoad[];
}

export interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

// ---- geometry (local metres; sites are small, so flat is fine) ----
const M_PER_DEG = 111_195;
const metres = (a: LatLng, b: LatLng) => distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
function toXY(origin: LatLng, p: LatLng): [number, number] {
  return [(p.longitude - origin.longitude) * M_PER_DEG * Math.cos((origin.latitude * Math.PI) / 180), (p.latitude - origin.latitude) * M_PER_DEG];
}

export function polygonAreaM2(poly: LatLng[]): number {
  if (poly.length < 3) return 0;
  const o = poly[0];
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = toXY(o, poly[i]);
    const [x2, y2] = toXY(o, poly[(i + 1) % poly.length]);
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.latitude > p.latitude !== b.latitude > p.latitude && p.longitude < ((b.longitude - a.longitude) * (p.latitude - a.latitude)) / (b.latitude - a.latitude) + a.longitude) inside = !inside;
  }
  return inside;
}

/** Distance (m) from a point to a polyline. */
export function distanceToLine(p: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return metres(p, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = toXY(p, line[i - 1]);
    const [bx, by] = toXY(p, line[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** The route's first `metres` (and how far along each kept vertex is). */
export function routeStart(line: LatLng[], maxM = ROUTE_START_M): { points: LatLng[]; along: number[] } {
  const points: LatLng[] = [];
  const along: number[] = [];
  let d = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) d += metres(line[i - 1], line[i]);
    points.push(line[i]);
    along.push(d);
    if (d >= maxM) break;
  }
  return { points, along };
}

// ---- OSM ----
export function parseOverpass(elements: OsmElement[]): SiteData {
  const sites: Site[] = [];
  const gates: Gate[] = [];
  const privateRoads: PrivateRoad[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    if (e.type === "node" && e.lat != null && e.lon != null && (GATE_BARRIERS.includes(t.barrier ?? "") || t.entrance)) {
      gates.push({ id: `n${e.id}`, point: { latitude: e.lat, longitude: e.lon }, barrier: t.barrier ?? (t.entrance ? "entrance" : null), access: t.access ?? null, openingHours: t.opening_hours ?? null });
      continue;
    }
    const line = (e.geometry ?? []).map((g) => ({ latitude: g.lat, longitude: g.lon }));
    if (e.type === "way" && t.highway === "service" && PRIVATE_ACCESS.includes(t.access ?? "") && line.length > 1) {
      privateRoads.push({ id: `w${e.id}`, line });
      continue;
    }
    const kind: SiteKind | null =
      t.building === "warehouse" || t.building === "industrial" ? "warehouse" : t.landuse === "industrial" ? "industrial" : t.landuse === "commercial" || t.landuse === "retail" ? "commercial" : t.amenity === "parking" ? "car_park" : null;
    if (kind && (e.type === "way" || e.type === "relation") && line.length >= 3) {
      sites.push({ id: `${e.type === "way" ? "w" : "r"}${e.id}`, kind, name: t.name ?? null, polygon: line, areaM2: polygonAreaM2(line) });
    }
  }
  return { sites, gates, privateRoads };
}

/** The Overpass query for everything within ~500 m of a point. */
export function overpassQuery(p: LatLng, radiusM = 500): string {
  const a = `around:${radiusM},${p.latitude},${p.longitude}`;
  const barriers = GATE_BARRIERS.filter((b) => b !== "entrance").join("|");
  return (
    `[out:json][timeout:20];(` +
    `way(${a})[landuse~"^(industrial|commercial|retail)$"];` +
    `way(${a})[building~"^(warehouse|industrial)$"];` +
    `way(${a})[amenity=parking];` +
    `node(${a})[barrier~"^(${barriers})$"];` +
    `node(${a})[entrance];` +
    `way(${a})[highway=service][access~"^(${PRIVATE_ACCESS.join("|")})$"];` +
    `);out geom tags;`
  );
}

// ---- the site, its exits, the route ----
/** The large site the point is in (or within 150 m of); the smallest such, the most specific. */
export function siteAt(p: LatLng, sites: Site[], knownSiteIds: ReadonlySet<string> = new Set()): Site | null {
  const hits = sites.filter((s) => (s.areaM2 > SITE_MIN_AREA_M2 || knownSiteIds.has(s.id)) && (pointInPolygon(p, s.polygon) || distanceToLine(p, [...s.polygon, s.polygon[0]]) <= SITE_NEAR_M));
  return hits.sort((a, b) => a.areaM2 - b.areaM2)[0] ?? null;
}

/** The site's exits: gates inside it or on its edge (30 m). */
export function siteGates(site: Site, gates: Gate[]): Gate[] {
  const ring = [...site.polygon, site.polygon[0]];
  return gates.filter((g) => pointInPolygon(g.point, site.polygon) || distanceToLine(g.point, ring) <= GATE_IN_SITE_M);
}

/** Gates the route's first stretch passes (within 15 m), nearest the start first. */
export function gatesOnRouteStart(line: LatLng[], gates: Gate[]): { gate: Gate; alongM: number }[] {
  const { points, along } = routeStart(line);
  const out: { gate: Gate; alongM: number }[] = [];
  for (const g of gates) {
    let best = Infinity;
    let at = 0;
    for (let i = 0; i < points.length; i++) {
      const d = distanceToLine(g.point, points.slice(Math.max(0, i - 1), i + 1));
      if (d < best) {
        best = d;
        at = along[i];
      }
    }
    if (best <= GATE_ON_ROUTE_M) out.push({ gate: g, alongM: at });
  }
  return out.sort((a, b) => a.alongM - b.alongM);
}

/**
 * The route's first stretch along a private service road: the point where it leaves it (the
 * exit), as an exit of its own (keyed by the road, "w<id>").
 */
export function privateRoadExit(line: LatLng[], roads: PrivateRoad[]): Gate | null {
  const { points } = routeStart(line);
  for (const r of roads) {
    let lastOn: LatLng | null = null;
    for (const p of points) if (distanceToLine(p, r.line) <= PRIVATE_ROAD_M) lastOn = p;
    if (lastOn) return { id: r.id, point: lastOn, barrier: null, access: "private", openingHours: null };
  }
  return null;
}

// ---- answers and patterns (the same rules as the server's siteExitsCore.js) ----
export type Bucket = `${"weekday" | "weekend"}-${"night" | "morning" | "day" | "afternoon" | "evening"}`;
export function bucketFor(date: Date): Bucket {
  const day = date.getDay();
  const h = date.getHours();
  const dayType = day === 0 || day === 6 ? "weekend" : "weekday";
  const band = h < 6 ? "night" : h < 10 ? "morning" : h < 15 ? "day" : h < 19 ? "afternoon" : "evening";
  return `${dayType}-${band}` as Bucket;
}

export interface ExitAnswer {
  open: boolean;
  bucket: string;
  atMs: number;
}
export interface ExitDoc {
  answers?: ExitAnswer[];
  hours?: string | null;
}
export type PatternState = "open" | "closed" | "unknown";

export function patternFor(answers: readonly ExitAnswer[] | undefined, bucket: string, nowMs: number): { state: PatternState; open: number; closed: number } {
  const recent = (answers ?? []).filter((a) => a.bucket === bucket && nowMs - a.atMs <= PATTERN_WINDOW_MS);
  const open = recent.filter((a) => a.open).length;
  const closed = recent.length - open;
  let state: PatternState = "unknown";
  if (closed >= PATTERN_MIN && closed / recent.length >= PATTERN_AGREE) state = "closed";
  else if (open >= PATTERN_MIN && open / recent.length >= PATTERN_AGREE) state = "open";
  return { state, open, closed };
}

export type ExitDecision = { kind: "none" } | { kind: "ask"; exit: Gate } | { kind: "avoid"; exit: Gate };

/**
 * For the exit the route uses: ask, avoid (drivers agree it's closed now), or nothing.
 * `myLast`: this driver's own last answer for this exit (kept on the phone).
 */
export function decideExit(o: {
  site: Site | null;
  exit: Gate | null;
  doc: ExitDoc | null;
  myLast: ExitAnswer | null;
  nowMs: number;
  bucket: string;
}): ExitDecision {
  if (!o.site || !o.exit) return { kind: "none" };
  const p = patternFor(o.doc?.answers, o.bucket, o.nowMs);
  if (p.state === "closed") return { kind: "avoid", exit: o.exit };
  if (p.state === "open") return { kind: "none" };
  if (o.myLast && o.nowMs - o.myLast.atMs < MY_ANSWER_FRESH_MS && o.myLast.bucket === o.bucket) return { kind: "none" };
  return { kind: "ask", exit: o.exit };
}

/** Whether the question may show now: only stopped or crawling (under 10 km/h). */
export function canAskNow(speedKmh: number | null | undefined): boolean {
  return speedKmh == null || speedKmh < ASK_MAX_KMH;
}

/**
 * Another way out of the site: a gate that isn't the closed one and isn't itself known closed at
 * this time; open-by-pattern first, then the nearest to `from`. null = no other exit.
 */
export function alternativeExit(gates: Gate[], closedId: string, docs: Record<string, ExitDoc | null>, from: LatLng, bucket: string, nowMs: number): Gate | null {
  const candidates = gates
    .filter((g) => g.id !== closedId && g.access !== "no")
    .map((g) => ({ g, p: patternFor(docs[g.id]?.answers, bucket, nowMs).state }))
    .filter((c) => c.p !== "closed");
  candidates.sort((a, b) => (a.p === "open" ? 0 : 1) - (b.p === "open" ? 0 : 1) || metres(from, a.g.point) - metres(from, b.g.point));
  return candidates[0]?.g ?? null;
}

/** How the question names the exit: the road it opens onto, else the side of the site. */
export function exitLabel(exit: Gate, site: Site, roadName: string | null): string {
  if (roadName) return roadName;
  const c = site.polygon.reduce((acc, p) => ({ latitude: acc.latitude + p.latitude / site.polygon.length, longitude: acc.longitude + p.longitude / site.polygon.length }), { latitude: 0, longitude: 0 });
  const [x, y] = toXY(c, exit.point);
  const side = Math.abs(y) >= Math.abs(x) ? (y >= 0 ? "north" : "south") : x >= 0 ? "east" : "west";
  return `the ${side} side`;
}

export function exitQuestion(label: string): string {
  return `Is the exit on ${label} open?`;
}

export type ExitAnswerPlan = { action: "keep" } | { action: "reroute"; via: Gate[]; say: string } | { action: "noOtherExit"; say: string };

/** What happens when the driver answers: Open -> keep; Closed -> out another exit (or say there's none). */
export function exitAnswerPlan(
  open: boolean,
  q: { exit: Gate; gates: Gate[]; docs: Record<string, ExitDoc | null>; from: LatLng; bucket: string; arrivalVia: Gate | null },
  nowMs: number
): ExitAnswerPlan {
  if (open) return { action: "keep" };
  const alt = alternativeExit(q.gates, q.exit.id, q.docs, q.from, q.bucket, nowMs);
  if (!alt) return { action: "noOtherExit", say: "No other exit found" };
  return { action: "reroute", via: [alt, ...(q.arrivalVia ? [q.arrivalVia] : [])], say: "Using another exit" };
}
