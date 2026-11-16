// "Alert while driving": warns once as the driver approaches a camera, crossing, incident or any
// other report item that has its alert switched on (settings/reportCatalog.ts). Pure; MapScreen
// feeds it features + position each fix and shows/speaks whatever it returns.
//
//   ahead       navigating: on the route ahead (within ROUTE_CORRIDOR_M of the line);
//               otherwise: within ±CONE_DEG of the heading
//   how far     speed x LOOKAHEAD_S, between MIN_M and MAX_M (more warning at higher speed)
//   when        moving at least MIN_SPEED_KMH (no alerts while parked or walking)
//   how often   once per feature; forgotten after FORGET_MS (so a second pass alerts again)
//   at once     one alert per fix -- the nearest

import type { ReportItemId } from "@/settings/reportCatalog";

export const LOOKAHEAD_S = 25;
export const MIN_M = 250;
export const MAX_M = 800;
export const CONE_DEG = 30;
export const ROUTE_CORRIDOR_M = 35;
export const MIN_SPEED_KMH = 15;
export const FORGET_MS = 15 * 60_000;

export interface ApproachFeature {
  /** Unique per real thing, e.g. "osm:railwayCrossing:123", "alert:abc", "ltn:xyz". */
  key: string;
  item: ReportItemId;
  lat: number;
  lng: number;
}

export interface ApproachInput {
  nowMs: number;
  position: { latitude: number; longitude: number };
  headingDeg: number;
  speedKmh: number | null;
  /** While navigating: the route line and how far along it the car is (metres). */
  route?: { polyline: { latitude: number; longitude: number }[]; alongM: number } | null;
}

export interface ApproachAlert {
  key: string;
  item: ReportItemId;
  distanceM: number;
}

export type ApproachMemory = Readonly<Record<string, number>>;

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearing(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const y = Math.sin(toRad(b.longitude - a.longitude)) * Math.cos(toRad(b.latitude));
  const x = Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) - Math.sin(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.cos(toRad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleOff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** How far ahead to warn at this speed. */
export function lookaheadMetres(speedKmh: number | null): number {
  const mps = Math.max(0, (speedKmh ?? 0) / 3.6);
  return Math.min(MAX_M, Math.max(MIN_M, mps * LOOKAHEAD_S));
}

/** The point's distance along the polyline and its distance off it (local flat approximation). */
export function projectOnPolyline(polyline: { latitude: number; longitude: number }[], p: { latitude: number; longitude: number }): { alongM: number; offM: number } | null {
  if (polyline.length < 2) return null;
  const lat0 = toRad(p.latitude);
  const xy = (q: { latitude: number; longitude: number }) => ({ x: toRad(q.longitude - p.longitude) * Math.cos(lat0) * R, y: toRad(q.latitude - p.latitude) * R });
  let best: { alongM: number; offM: number } | null = null;
  let acc = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = xy(polyline[i]);
    const b = xy(polyline[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const off = Math.sqrt(px * px + py * py);
    if (!best || off < best.offM) best = { alongM: acc + t * len, offM: off };
    acc += len;
  }
  return best;
}

/**
 * The features to warn about now (at most one, the nearest), and the updated memory.
 * `features` must already be filtered to items with "Alert while driving" on.
 */
export function nextApproachAlert(features: readonly ApproachFeature[], input: ApproachInput, memory: ApproachMemory): { alert: ApproachAlert | null; memory: ApproachMemory } {
  // Forget old alerts.
  const kept: Record<string, number> = {};
  for (const [k, t] of Object.entries(memory)) if (input.nowMs - t < FORGET_MS) kept[k] = t;
  if ((input.speedKmh ?? 0) < MIN_SPEED_KMH) return { alert: null, memory: kept };
  const reach = lookaheadMetres(input.speedKmh);
  let best: ApproachAlert | null = null;
  for (const f of features) {
    if (kept[f.key] !== undefined) continue;
    const p = { latitude: f.lat, longitude: f.lng };
    let distance: number;
    if (input.route && input.route.polyline.length >= 2) {
      const proj = projectOnPolyline(input.route.polyline, p);
      if (!proj || proj.offM > ROUTE_CORRIDOR_M) continue;
      distance = proj.alongM - input.route.alongM;
      if (distance <= 0) continue;
    } else {
      distance = metresBetween(input.position, p);
      if (angleOff(bearing(input.position, p), input.headingDeg) > CONE_DEG) continue;
    }
    if (distance > reach) continue;
    if (!best || distance < best.distanceM) best = { key: f.key, item: f.item, distanceM: Math.round(distance) };
  }
  if (best) kept[best.key] = input.nowMs;
  return { alert: best, memory: kept };
}
