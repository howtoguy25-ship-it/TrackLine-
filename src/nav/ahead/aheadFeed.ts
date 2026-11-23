// ONE list of everything ahead on the active route: driver reports, Live Traffic NSW, live traffic
// from the route's own speed annotations, and mapped road features. Pure; the map screen gathers
// the sources and calls buildAheadFeed on every matched fix (cheap: one projection per source).
//
//   on the route    within CORRIDOR_M (30 m) of the route line
//   my direction    a source that knows its direction of travel (bearingDeg) must match the
//                   route's own direction there within HEADING_TOLERANCE_DEG; one that doesn't is
//                   taken as applying to the road (point features, reports, incidents)
//   ahead           further along the route than the car
//   one per thing   within DEDUP_M of the same kind: official > confirmed report > report > map
//   merged          a crash inside a jam (or within DEDUP_M of its start) is one alert,
//                   "Crash causing heavy traffic"
// Tested in __tests__/nav/aheadAlerts.test.ts.
import { projectOnPolyline } from "@/alerts/approachAlerts";
import { CRITICAL_KINDS, KIND_TIER, MINOR_KINDS, titleFor, type AheadKind } from "@/nav/ahead/aheadKinds";
import type { ReportItemId } from "@/settings/reportCatalog";

export const CORRIDOR_M = 30;
export const HEADING_TOLERANCE_DEG = 60;
export const DEDUP_M = 50;

export type AheadSourceKind = "official" | "community" | "traffic" | "map";

export interface AheadSource {
  /** Unique per real thing: "alert:abc", "ltn:123", "osm:speedBump:9", "traffic:0". */
  key: string;
  kind: AheadKind;
  item: ReportItemId | null;
  source: AheadSourceKind;
  lat: number;
  lng: number;
  /** Direction of travel it applies to, when known (traffic, directional reports). */
  bearingDeg?: number | null;
  /** Community: drivers who confirmed it (the reporter not counted). */
  confirmCount?: number;
  /** Community: when it was reported (ms). */
  createdAt?: number | null;
  /** Community: "by Sam" when the reporter allows it. */
  reporterName?: string | null;
  /** Community doc id, for Still there / Not there and the full card. */
  alertId?: string;
  /** Official: Live Traffic NSW id, its short text and advice. */
  incidentId?: string;
  officialText?: string | null;
  /** Live traffic: how long the slow stretch is, and how much time it costs, when known. */
  lengthM?: number | null;
  delaySeconds?: number | null;
}

export interface AheadAlert extends AheadSource {
  /** Distance of the thing along the whole route (m). */
  alongM: number;
  /** Distance from the car, along the route (m). */
  aheadM: number;
  tier: number;
  critical: boolean;
  minor: boolean;
  title: string;
  /** Merged with a jam at the same spot ("Crash causing heavy traffic"). */
  mergedTraffic?: "heavyTraffic" | "standstill";
}

const SOURCE_RANK = (s: AheadSource): number =>
  s.source === "official" ? 3 : s.source === "community" ? ((s.confirmCount ?? 0) > 0 ? 2 : 1) : s.source === "traffic" ? 2 : 0;

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
function bearing(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const angleOff = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/** The route's own direction of travel at a distance along it. */
export function routeBearingAt(polyline: { latitude: number; longitude: number }[], alongM: number): number | null {
  let acc = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const lat0 = rad(a.latitude);
    const len = Math.hypot(rad(b.longitude - a.longitude) * Math.cos(lat0) * R, rad(b.latitude - a.latitude) * R);
    if (acc + len >= alongM && len > 0) return bearing(a, b);
    acc += len;
  }
  return polyline.length >= 2 ? bearing(polyline[polyline.length - 2], polyline[polyline.length - 1]) : null;
}

const TRAFFIC_KINDS: ReadonlySet<AheadKind> = new Set(["heavyTraffic", "standstill"]);
/** Kinds that de-duplicate against each other (a report of police and an incident of police...). */
const dedupGroup = (k: AheadKind) => (TRAFFIC_KINDS.has(k) || k === "slowdown" ? "traffic" : k);

/**
 * Everything on the route ahead of the car, nearest first. `log` hears about any source that was
 * skipped for bad data (no coordinates, no kind) -- it never reaches a banner.
 */
export function buildAheadFeed(
  sources: readonly AheadSource[],
  polyline: { latitude: number; longitude: number }[],
  carAlongM: number,
  log: (msg: string, key: string) => void = () => {}
): AheadAlert[] {
  return aheadOf(projectFeed(sources, polyline, log), carAlongM);
}

/** The part that changes on every GPS fix: what's still ahead, and how far. Cheap. */
export function aheadOf(projected: readonly AheadAlert[], carAlongM: number): AheadAlert[] {
  const out: AheadAlert[] = [];
  for (const a of projected) {
    const aheadM = a.alongM - carAlongM;
    if (aheadM > 0) out.push({ ...a, aheadM });
  }
  return out;
}

/**
 * The part that only changes with the sources or the route: every source projected onto the
 * route (corridor + direction), de-duplicated and merged, in route order (aheadM = alongM).
 */
export function projectFeed(
  sources: readonly AheadSource[],
  polyline: { latitude: number; longitude: number }[],
  log: (msg: string, key: string) => void = () => {}
): AheadAlert[] {
  const carAlongM = 0;
  if (polyline.length < 2) return [];
  const onRoute: AheadAlert[] = [];
  for (const s of sources) {
    if (!s || !s.key || !s.kind || !Number.isFinite(s.lat) || !Number.isFinite(s.lng) || KIND_TIER[s.kind] === undefined) {
      log("ahead: skipped a source with missing data", s?.key ?? "?");
      continue;
    }
    const p = projectOnPolyline(polyline, { latitude: s.lat, longitude: s.lng });
    if (!p || p.offM > CORRIDOR_M) continue;
    const aheadM = p.alongM - carAlongM;
    if (aheadM < 0) continue;
    if (s.bearingDeg != null && Number.isFinite(s.bearingDeg)) {
      const routeBearing = routeBearingAt(polyline, p.alongM);
      if (routeBearing != null && angleOff(routeBearing, s.bearingDeg) > HEADING_TOLERANCE_DEG) continue;
    }
    onRoute.push({
      ...s,
      alongM: p.alongM,
      aheadM,
      tier: KIND_TIER[s.kind],
      critical: CRITICAL_KINDS.has(s.kind),
      minor: MINOR_KINDS.has(s.kind),
      title: titleFor(s.kind, s.item),
    });
  }
  onRoute.sort((a, b) => a.alongM - b.alongM);

  // One per real thing: the best source wins within DEDUP_M of the same group.
  const kept: AheadAlert[] = [];
  for (const a of onRoute) {
    const twin = kept.find((k) => dedupGroup(k.kind) === dedupGroup(a.kind) && Math.abs(k.alongM - a.alongM) <= DEDUP_M);
    if (!twin) {
      kept.push(a);
      continue;
    }
    const better = SOURCE_RANK(a) > SOURCE_RANK(twin) || (SOURCE_RANK(a) === SOURCE_RANK(twin) && a.tier < twin.tier);
    if (better) kept[kept.indexOf(twin)] = { ...a, confirmCount: Math.max(a.confirmCount ?? 0, twin.confirmCount ?? 0) };
  }

  // A crash inside a jam (or right at its start) is one alert: the crash, causing the traffic.
  const out: AheadAlert[] = [];
  const absorbed = new Set<AheadAlert>();
  for (const a of kept) {
    if (a.kind !== "crash") continue;
    const jam = kept.find(
      (j) => TRAFFIC_KINDS.has(j.kind) && !absorbed.has(j) && a.alongM >= j.alongM - DEDUP_M && a.alongM <= j.alongM + Math.max(DEDUP_M, j.lengthM ?? 0)
    );
    if (jam) {
      absorbed.add(jam);
      const traffic = jam.kind as "heavyTraffic" | "standstill";
      // The warning comes at the start of the slow stretch, whichever is first.
      const startAlong = Math.min(a.alongM, jam.alongM);
      Object.assign(a, {
        mergedTraffic: traffic,
        title: traffic === "standstill" ? "Crash causing standstill traffic" : "Crash causing heavy traffic",
        alongM: startAlong,
        aheadM: startAlong - carAlongM,
        lengthM: jam.lengthM,
        delaySeconds: jam.delaySeconds,
      });
    }
  }
  for (const a of kept) if (!absorbed.has(a)) out.push(a);
  return out.sort((a, b) => a.alongM - b.alongM);
}

/** Live traffic along the route as sources: each slow / stopped stretch from its start. */
export function trafficSources(
  polyline: { latitude: number; longitude: number }[],
  intervals: readonly { startIndex: number; endIndex: number; speed: string }[] | undefined,
  delaySecondsFor?: (startIndex: number, endIndex: number) => number | null
): AheadSource[] {
  if (!intervals || polyline.length < 2) return [];
  const out: AheadSource[] = [];
  for (const iv of intervals) {
    if (iv.speed !== "SLOW" && iv.speed !== "TRAFFIC_JAM") continue;
    const start = Math.max(0, iv.startIndex);
    const end = Math.min(polyline.length - 1, iv.endIndex);
    if (end <= start) continue;
    let lengthM = 0;
    for (let i = start; i < end; i++) {
      const a = polyline[i];
      const b = polyline[i + 1];
      lengthM += Math.hypot(rad(b.longitude - a.longitude) * Math.cos(rad(a.latitude)) * R, rad(b.latitude - a.latitude) * R);
    }
    out.push({
      key: `traffic:${start}-${end}:${iv.speed}`,
      kind: iv.speed === "TRAFFIC_JAM" ? "standstill" : "heavyTraffic",
      item: "traffic",
      source: "traffic",
      lat: polyline[start].latitude,
      lng: polyline[start].longitude,
      bearingDeg: bearing(polyline[start], polyline[start + 1]),
      lengthM,
      delaySeconds: delaySecondsFor?.(start, end) ?? null,
    });
  }
  return out;
}
