// The ETA sheet's numbers (tap the arrival time on the bottom bar while driving):
//  - which reports and live incidents sit on the road still ahead, and how far along it;
//  - the drive time if you left now or at the next 15-minute marks, from Google's own
//    traffic predictions (Directions departure_time). A slot whose request failed has no
//    figure at all; nothing is filled in or guessed.
// Pure apart from the injected request function, so it is tested directly.
import type { LatLng } from "@/utils/polyline";
import { distanceKm } from "@/utils/geo";

export interface RoutePoint {
  id: string;
  kind: "report" | "incident";
  label: string;
  lat: number;
  lng: number;
}

export interface RouteEvent extends RoutePoint {
  /** Metres from the start of the remaining route. */
  alongMeters: number;
  /** 0..1 along the remaining route, for the bar. */
  fraction: number;
}

/** How far a report can sit from the line and still count as on the route. */
export const ON_ROUTE_METERS = 60;

const metersBetween = (a: LatLng, b: LatLng) => distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;

/** Nearest point on segment a-b to p, in a flat local frame (fine at segment length). */
function projectOnSegment(p: LatLng, a: LatLng, b: LatLng): { t: number; point: LatLng } {
  const kx = Math.cos((a.latitude * Math.PI) / 180);
  const ax = a.longitude * kx;
  const bx = b.longitude * kx;
  const px = p.longitude * kx;
  const dx = bx - ax;
  const dy = b.latitude - a.latitude;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (p.latitude - a.latitude) * dy) / len2));
  return { t, point: { latitude: a.latitude + dy * t, longitude: a.longitude + (b.longitude - a.longitude) * t } };
}

/** The points that lie on the remaining route, in driving order. */
export function eventsAlongRoute(polyline: LatLng[], points: RoutePoint[], maxOffset = ON_ROUTE_METERS): RouteEvent[] {
  if (polyline.length < 2) return [];
  const cumulative = [0];
  for (let i = 1; i < polyline.length; i++) cumulative.push(cumulative[i - 1] + metersBetween(polyline[i - 1], polyline[i]));
  const total = cumulative[cumulative.length - 1];
  if (total <= 0) return [];

  const out: RouteEvent[] = [];
  for (const pt of points) {
    const p = { latitude: pt.lat, longitude: pt.lng };
    let best = { off: Infinity, along: 0 };
    for (let i = 0; i < polyline.length - 1; i++) {
      const { t, point } = projectOnSegment(p, polyline[i], polyline[i + 1]);
      const off = metersBetween(p, point);
      if (off < best.off) best = { off, along: cumulative[i] + (cumulative[i + 1] - cumulative[i]) * t };
    }
    if (best.off <= maxOffset) out.push({ ...pt, alongMeters: best.along, fraction: best.along / total });
  }
  return out.sort((a, b) => a.alongMeters - b.alongMeters);
}

export const SLOT_MINUTES = 15;
export const SLOT_COUNT = 6;

/** Now, then the next 15-minute marks on the clock (e.g. 9:07 → 9:07, 9:15, 9:30 …). */
export function departureSlots(nowMs: number, count = SLOT_COUNT, stepMinutes = SLOT_MINUTES): number[] {
  const step = stepMinutes * 60_000;
  const firstMark = Math.ceil((nowMs + 1) / step) * step;
  const slots = [nowMs];
  for (let i = 0; slots.length < count; i++) slots.push(firstMark + i * step);
  return slots;
}

export interface LeavePrediction {
  departMs: number;
  /** Google's predicted drive time for leaving at departMs, or null if that request failed. */
  durationSeconds: number | null;
}

/** Ask for each slot's predicted drive time. `predict` returns seconds for a Unix-seconds departure. */
export async function predictLeaveTimes(
  slots: number[],
  predict: (departUnixSeconds: number | "now") => Promise<number | undefined>
): Promise<LeavePrediction[]> {
  const settled = await Promise.allSettled(slots.map((ms, i) => predict(i === 0 ? "now" : Math.round(ms / 1000))));
  return settled.map((r, i) => ({
    departMs: slots[i],
    durationSeconds: r.status === "fulfilled" && typeof r.value === "number" && Number.isFinite(r.value) ? r.value : null,
  }));
}

/** The slot that arrives soonest after leaving, or null when none have a figure. */
export function quickestSlot(predictions: LeavePrediction[]): LeavePrediction | null {
  let best: LeavePrediction | null = null;
  for (const p of predictions) {
    if (p.durationSeconds == null) continue;
    if (!best || p.durationSeconds < (best.durationSeconds as number)) best = p;
  }
  return best;
}
