// Report items computed from real data rather than reported:
//
//   Sudden slowdown  TrackLine drivers just ahead on your route crawling (their own, already
//                    privacy-delayed presence paths): at least SLOW_TRACKYS of them within
//                    AHEAD_M ahead, on the route, below SLOW_KMH -- while you're still moving.
//   Crash history    recorded crashes (Live Traffic NSW + confirmed driver crash reports, kept
//                    3 years server-side) grouped by place: CLUSTER_MIN or more within
//                    CLUSTER_M is a crash-history spot.
//   Lane ending      from the route's own lane counts (nav/laneEndings.ts, per route step).
import type { ApproachFeature } from "@/alerts/approachAlerts";
import { projectOnPolyline } from "@/alerts/approachAlerts";
import type { LatLng } from "@/utils/polyline";

export const SLOW_KMH = 15;
export const SLOW_TRACKYS = 2;
export const AHEAD_M = 1500;
export const ON_ROUTE_M = 30;
export const FRESH_MS = 90_000;

export interface PresenceLike {
  uid: string;
  path: readonly { lat: number; lng: number; t: number }[];
}

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A driver's speed from the last two points of their path (km/h), or null if not fresh. */
export function pathSpeedKmh(path: PresenceLike["path"], nowServerMs: number): number | null {
  if (path.length < 2) return null;
  const a = path[path.length - 2];
  const b = path[path.length - 1];
  if (nowServerMs - b.t > FRESH_MS || b.t <= a.t) return null;
  return (metres(a, b) / ((b.t - a.t) / 1000)) * 3.6;
}

/** Trackys crawling just ahead on the route: where the slowdown starts, or null. */
export function trackySlowdownAhead(presences: readonly PresenceLike[], route: { polyline: LatLng[]; alongM: number }, nowServerMs: number): LatLng | null {
  const slow: { along: number; at: LatLng }[] = [];
  for (const p of presences) {
    const v = pathSpeedKmh(p.path, nowServerMs);
    if (v === null || v >= SLOW_KMH) continue;
    const last = p.path[p.path.length - 1];
    const at = { latitude: last.lat, longitude: last.lng };
    const proj = projectOnPolyline(route.polyline, at);
    if (!proj || proj.offM > ON_ROUTE_M) continue;
    const ahead = proj.alongM - route.alongM;
    if (ahead <= 0 || ahead > AHEAD_M) continue;
    slow.push({ along: proj.alongM, at });
  }
  if (slow.length < SLOW_TRACKYS) return null;
  slow.sort((a, b) => a.along - b.along);
  return slow[0].at;
}

export const CLUSTER_M = 150;
export const CLUSTER_MIN = 2;

/** Crash records -> crash-history spots (one per cluster, at its centre). */
export function crashHistorySpots(records: readonly { id: string; lat: number; lng: number }[]): ApproachFeature[] {
  const left = [...records];
  const spots: ApproachFeature[] = [];
  while (left.length) {
    const seed = left.shift()!;
    const group = [seed, ...left.filter((r) => metres(seed, r) <= CLUSTER_M)];
    for (const g of group.slice(1)) left.splice(left.indexOf(g), 1);
    if (group.length < CLUSTER_MIN) continue;
    const lat = group.reduce((s, r) => s + r.lat, 0) / group.length;
    const lng = group.reduce((s, r) => s + r.lng, 0) / group.length;
    spots.push({ key: `crashHistory:${group.map((g) => g.id).sort()[0]}`, item: "crashHistory", lat, lng });
  }
  return spots;
}

/** Lane endings along the route still ahead, as alert features. */
export function laneEndingFeatures(steps: readonly { laneEndings?: LatLng[] }[]): ApproachFeature[] {
  const out: ApproachFeature[] = [];
  steps.forEach((s, i) => (s.laneEndings ?? []).forEach((p, j) => out.push({ key: `laneEnding:${i}:${j}`, item: "laneEnding", lat: p.latitude, lng: p.longitude })));
  return out;
}
