// The pure rules behind the route-selection screen: which of Google's routes are worth showing,
// what each one is called, how its traffic is described, and where its time bubble sits on the
// map. Nothing here fetches or renders -- see services/directions.ts (getRouteChoices) for the
// request and components/RouteSelection.tsx for the screen. Checked in scripts/test-ui-logic.ts.
import type { LatLng } from "@/utils/polyline";

/** The parts of a route these rules look at -- a services/directions.ts Route satisfies it. */
export interface ChoiceRoute {
  polyline: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  durationInTrafficSeconds?: number;
  steps?: { maneuver?: string }[];
  tollEstimate?: { hasToll: boolean };
}

/** The time the driver will actually see: live-traffic time when Google gave one. */
export function routeSeconds(route: ChoiceRoute): number {
  return route.durationInTrafficSeconds ?? route.durationSeconds;
}

// ---------------------------------------------------------------------------------------------
// Distinct routes

const EARTH_RADIUS_M = 6_371_000;

// Local flat projection (metres) around a reference latitude. Over the few tens of kilometres a
// route spans, the error is far below the 30m tolerance below.
function project(p: LatLng, refLat: number): { x: number; y: number } {
  const toRad = Math.PI / 180;
  return {
    x: p.longitude * toRad * EARTH_RADIUS_M * Math.cos(refLat * toRad),
    y: p.latitude * toRad * EARTH_RADIUS_M,
  };
}

function pointToSegmentMeters(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Distance in metres from a point to the nearest part of a polyline. */
export function distanceToPolylineMeters(point: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  const refLat = point.latitude;
  const p = project(point, refLat);
  if (line.length === 1) {
    const only = project(line[0], refLat);
    return Math.hypot(p.x - only.x, p.y - only.y);
  }
  let best = Infinity;
  let prev = project(line[0], refLat);
  for (let i = 1; i < line.length; i++) {
    const next = project(line[i], refLat);
    const d = pointToSegmentMeters(p, prev, next);
    if (d < best) best = d;
    prev = next;
  }
  return best;
}

/** Evenly spaced points along a polyline (by distance), at most `count` of them, ends included. */
export function samplePolyline(line: LatLng[], count: number): LatLng[] {
  if (line.length <= 2 || count <= 2) return line.slice();
  const refLat = line[0].latitude;
  const pts = line.map((p) => project(p, refLat));
  const cumulative = [0];
  for (let i = 1; i < pts.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cumulative[cumulative.length - 1];
  if (total === 0) return [line[0]];
  const out: LatLng[] = [];
  let seg = 1;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    while (seg < cumulative.length - 1 && cumulative[seg] < target) seg++;
    const span = cumulative[seg] - cumulative[seg - 1];
    const t = span === 0 ? 0 : (target - cumulative[seg - 1]) / span;
    const a = line[seg - 1];
    const b = line[seg];
    out.push({ latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t });
  }
  return out;
}

// Two roads side by side (a motorway and its service road) are still different routes, so the
// tolerance is tight: GPS-grade polylines of the same road sit within a few metres of each other.
export const SAME_ROAD_TOLERANCE_M = 30;
export const MAX_SHARED_PATH = 0.85;
export const MAX_ROUTE_CHOICES = 3;

/** Share (0-1) of route `a`'s length that runs along route `b`. */
export function sharedPathFraction(a: LatLng[], b: LatLng[], toleranceM = SAME_ROAD_TOLERANCE_M): number {
  const samples = samplePolyline(a, 200);
  if (samples.length === 0 || b.length === 0) return 0;
  let shared = 0;
  for (const p of samples) if (distanceToPolylineMeters(p, b) <= toleranceM) shared++;
  return shared / samples.length;
}

/** Same time and same distance -- Google re-sending one route with a different encoding. */
export function sameTimeAndDistance(a: ChoiceRoute, b: ChoiceRoute): boolean {
  return Math.abs(a.distanceMeters - b.distanceMeters) < 20 && Math.abs(routeSeconds(a) - routeSeconds(b)) < 15;
}

/**
 * The routes worth offering, best first: Google's first route always stays, and each further
 * one is dropped when it is the same time and distance as one already kept, or when more than
 * 85% of its path is a road already kept. At most `max` (3) are returned.
 */
export function distinctRoutes<T extends ChoiceRoute>(routes: T[], max = MAX_ROUTE_CHOICES): T[] {
  const kept: T[] = [];
  for (const route of routes) {
    if (kept.length >= max) break;
    const duplicate = kept.some(
      (k) => sameTimeAndDistance(route, k) || sharedPathFraction(route.polyline, k.polyline) > MAX_SHARED_PATH
    );
    if (!duplicate) kept.push(route);
  }
  return kept;
}

// ---------------------------------------------------------------------------------------------
// Avoid options

export interface RouteAvoidPrefs {
  tolls: boolean;
  motorways: boolean;
  ferries: boolean;
  unpaved: boolean;
  difficultIntersections: boolean;
  uturns: boolean;
}

export type RouteAvoidKey = keyof RouteAvoidPrefs;

export const DEFAULT_ROUTE_AVOID: RouteAvoidPrefs = {
  tolls: false,
  motorways: false,
  ferries: false,
  unpaved: false,
  difficultIntersections: false,
  uturns: false,
};

export const ROUTE_AVOID_ORDER: RouteAvoidKey[] = [
  "tolls",
  "motorways",
  "ferries",
  "unpaved",
  "difficultIntersections",
  "uturns",
];

export const ROUTE_AVOID_LABELS: Record<RouteAvoidKey, string> = {
  tolls: "Toll roads",
  motorways: "Motorways",
  ferries: "Ferries",
  unpaved: "Unpaved roads",
  difficultIntersections: "Difficult intersections",
  uturns: "U-turns",
};

// Google's routing has no setting for unpaved roads or for difficult intersections, so those two
// can't change a route. They're listed (greyed, with this reason) rather than offered as switches
// that would quietly do nothing.
export const ROUTE_AVOID_UNSUPPORTED: Partial<Record<RouteAvoidKey, string>> = {
  unpaved: "Our routing provider can't avoid unpaved roads yet",
  difficultIntersections: "Our routing provider can't avoid difficult intersections yet",
};

export function isAvoidSupported(key: RouteAvoidKey): boolean {
  return ROUTE_AVOID_UNSUPPORTED[key] === undefined;
}

/** Fills in any option missing from a stored value (older settings, or a corrupt one). */
export function normalizeRouteAvoid(stored: unknown): RouteAvoidPrefs {
  const out: RouteAvoidPrefs = { ...DEFAULT_ROUTE_AVOID };
  if (stored && typeof stored === "object") {
    for (const key of ROUTE_AVOID_ORDER) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === "boolean") out[key] = value && isAvoidSupported(key);
    }
  }
  return out;
}

/** How many options are switched on -- the number in the "Avoid · 2" pill. */
export function avoidCount(prefs: RouteAvoidPrefs): number {
  return ROUTE_AVOID_ORDER.filter((key) => prefs[key] && isAvoidSupported(key)).length;
}

export function avoidPillLabel(prefs: RouteAvoidPrefs): string {
  const n = avoidCount(prefs);
  return n > 0 ? `Avoid · ${n}` : "Avoid";
}

/** The avoid options as Google routing flags. U-turns are handled after the fact (withoutUturns). */
export function avoidRouteOptions(prefs: RouteAvoidPrefs): { avoidTolls: boolean; avoidHighways: boolean; avoidFerries: boolean } {
  return { avoidTolls: prefs.tolls, avoidHighways: prefs.motorways, avoidFerries: prefs.ferries };
}

export function routeHasUturn(route: ChoiceRoute): boolean {
  return (route.steps ?? []).some((s) => typeof s.maneuver === "string" && s.maneuver.startsWith("uturn"));
}

/**
 * With "U-turns" switched on, routes that contain one are dropped. If every route Google offered
 * has one, they're all kept -- an honest route with a U-turn beats no route -- and `allHaveUturns`
 * says so, so the screen can tell the driver.
 */
export function withoutUturns<T extends ChoiceRoute>(routes: T[]): { routes: T[]; allHaveUturns: boolean } {
  const clean = routes.filter((r) => !routeHasUturn(r));
  if (clean.length > 0 || routes.length === 0) return { routes: clean, allHaveUturns: false };
  return { routes, allHaveUturns: true };
}

// ---------------------------------------------------------------------------------------------
// Labels

export type TrafficLevel = "light" | "typical" | "heavy";

// Live time against the free-flow time for the same route: up to 5% slower is light, up to 25%
// is the usual stop-start, beyond that is heavy.
export const LIGHT_TRAFFIC_MAX_RATIO = 1.05;
export const TYPICAL_TRAFFIC_MAX_RATIO = 1.25;

/** null when Google gave no live-traffic time (nothing honest to say). */
export function trafficLevel(route: ChoiceRoute): TrafficLevel | null {
  if (route.durationInTrafficSeconds == null || route.durationSeconds <= 0) return null;
  const ratio = route.durationInTrafficSeconds / route.durationSeconds;
  if (ratio <= LIGHT_TRAFFIC_MAX_RATIO) return "light";
  if (ratio <= TYPICAL_TRAFFIC_MAX_RATIO) return "typical";
  return "heavy";
}

export const TRAFFIC_LEVEL_LABELS: Record<TrafficLevel, string> = {
  light: "Light traffic",
  typical: "Typical traffic",
  heavy: "Heavy traffic",
};

export type RouteTag = "Best" | "Fastest" | "No tolls";

// An alternative only earns "Fastest" if it's a real minute quicker than the best route.
const FASTEST_MARGIN_S = 60;

/** The word under each route's time: the first route is "Best"; others say what they're for. */
export function routeTags(routes: ChoiceRoute[]): (RouteTag | null)[] {
  if (routes.length === 0) return [];
  const best = routes[0];
  const bestHasToll = best.tollEstimate?.hasToll === true;
  let quickest = 0;
  routes.forEach((r, i) => {
    if (routeSeconds(r) < routeSeconds(routes[quickest])) quickest = i;
  });
  return routes.map((r, i) => {
    if (i === 0) return "Best";
    if (i === quickest && routeSeconds(r) <= routeSeconds(best) - FASTEST_MARGIN_S) return "Fastest";
    if (bestHasToll && r.tollEstimate && !r.tollEstimate.hasToll) return "No tolls";
    return null;
  });
}

/** "Best route, Typical traffic · Toll" -- the grey line under "Via …". */
export function routeSummaryLine(tag: RouteTag | null, level: TrafficLevel | null, hasToll: boolean): string {
  const lead = tag === "Best" ? "Best route" : tag === "Fastest" ? "Fastest route" : tag === "No tolls" ? "No tolls" : "Alternative route";
  const parts = [lead];
  if (level) parts.push(TRAFFIC_LEVEL_LABELS[level]);
  return parts.join(", ") + (hasToll ? " · Toll" : "");
}

/** "Via M2" from Google's own route description, or null when it didn't give one. */
export function viaRoadLabel(description: string | undefined): string | null {
  const road = description?.replace(/^\s*via\s+/i, "").trim();
  return road ? `Via ${road}` : null;
}

/** "10 min", "1 h 5 min", "2 h". */
export function formatRouteDuration(seconds: number): string {
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * The road a Routes API step turns onto, from its English sentence ("Turn left onto George St"
 * -> "George St"). The classic Directions API marks this in bold; the Routes API doesn't, so for
 * English this reads it out of the sentence and for other languages it returns undefined (the
 * instruction card then shows the whole sentence, as it always has for such steps).
 */
export function roadFromInstruction(instruction: string, language: string): string | undefined {
  if (!language.toLowerCase().startsWith("en")) return undefined;
  const firstLine = instruction.split("\n")[0] ?? "";
  const match = /\b(?:onto|on to|on)\s+(.+?)\s*(?:\b(?:toward|towards|for|at|then|and)\b.*)?$/i.exec(firstLine);
  const road = match?.[1]?.split(",")[0]?.replace(/[.;]+$/, "").trim();
  return road ? road : undefined;
}

// ---------------------------------------------------------------------------------------------
// Traffic on the selected route

export type SpeedCategory = "NORMAL" | "SLOW" | "TRAFFIC_JAM";

export interface SpeedInterval {
  startIndex: number;
  endIndex: number;
  speed: SpeedCategory;
}

export interface TrafficStretch {
  coordinates: LatLng[];
  speed: "SLOW" | "TRAFFIC_JAM";
}

/** The slow and jammed stretches of a route, as their own lines to draw over the route. */
export function trafficStretches(polyline: LatLng[], intervals: SpeedInterval[] | undefined): TrafficStretch[] {
  if (!intervals) return [];
  const out: TrafficStretch[] = [];
  for (const interval of intervals) {
    if (interval.speed !== "SLOW" && interval.speed !== "TRAFFIC_JAM") continue;
    const start = Math.max(0, interval.startIndex);
    const end = Math.min(polyline.length - 1, interval.endIndex);
    if (end <= start) continue;
    out.push({ coordinates: polyline.slice(start, end + 1), speed: interval.speed });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Where each time bubble sits

/**
 * One point per route for its time bubble, chosen from the middle stretch of the route (10-90%)
 * as far as possible from every other route and from the bubbles already placed -- so the
 * bubble sits where its own line is clearly separate and two bubbles never land together.
 * The selected route is placed first.
 */
export function bubbleAnchors(polylines: LatLng[][], selectedIndex: number): (LatLng | null)[] {
  const order = [selectedIndex, ...polylines.map((_, i) => i).filter((i) => i !== selectedIndex)];
  const placed: LatLng[] = [];
  const result: (LatLng | null)[] = polylines.map(() => null);
  for (const i of order) {
    const line = polylines[i];
    if (!line || line.length === 0) continue;
    const samples = samplePolyline(line, 41).slice(4, -4);
    const candidates = samples.length > 0 ? samples : [line[Math.floor(line.length / 2)]];
    const others = polylines.filter((_, j) => j !== i);
    if (others.length === 0 && placed.length === 0) {
      // A single route: its bubble goes at the middle of the line.
      const middle = candidates[Math.floor(candidates.length / 2)];
      placed.push(middle);
      result[i] = middle;
      continue;
    }
    let best = candidates[Math.floor(candidates.length / 2)];
    let bestScore = -1;
    for (const c of candidates) {
      const fromRoutes = others.length ? Math.min(...others.map((o) => distanceToPolylineMeters(c, o))) : 0;
      const fromBubbles = placed.length ? Math.min(...placed.map((p) => distanceToPolylineMeters(c, [p]))) : Infinity;
      const score = Math.min(fromRoutes, fromBubbles);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    placed.push(best);
    result[i] = best;
  }
  return result;
}

/** Bounds of every route, for fitting them all on screen. */
export function routesBounds(polylines: LatLng[][]): { north: number; south: number; east: number; west: number } | null {
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const line of polylines) {
    for (const p of line) {
      if (p.latitude > north) north = p.latitude;
      if (p.latitude < south) south = p.latitude;
      if (p.longitude > east) east = p.longitude;
      if (p.longitude < west) west = p.longitude;
    }
  }
  return Number.isFinite(north) ? { north, south, east, west } : null;
}

// ---------------------------------------------------------------------------------------------
// Go now countdown

export const GO_NOW_COUNTDOWN_MS = 10_000;
