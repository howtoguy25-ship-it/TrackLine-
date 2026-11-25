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

// ---- Fix pass 5 §8: the options/ETA sheet never covers the guidance, and the best-time chart.

/** The sheet never comes closer than this under the turn instruction bar. */
export const SHEET_GAP_BELOW_BAR = 120;

/**
 * Snap heights (pt): half, and full = screen - (status bar + instruction bar) - 120, so the
 * instruction and the road just under it always stay in view. Content scrolls inside.
 */
export function optionsSheetHeights(screenHeight: number, topBarBottom: number): { half: number; full: number } {
  const full = Math.max(240, Math.round(screenHeight - topBarBottom - SHEET_GAP_BELOW_BAR));
  const half = Math.min(full, Math.round(screenHeight * 0.45));
  return { half, full };
}

export const LEAVE_TIMEOUT_MS = 10_000;
export const LEAVE_ERROR_TEXT = "Couldn't load traffic predictions — tap to retry";

/** Rejects after `ms` (the request may still finish; its answer is then ignored). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export interface LeaveBar {
  departMs: number;
  /** One line, short: "Now", "9:15", "10:45". */
  label: string;
  minutes: number | null;
  /** Bar height (pt). Every bar has the same width. */
  height: number;
  best: boolean;
  slow: boolean;
}

/** "9:15 am" -> "9:15": the slots are 15 minutes apart, so the label fits on one line. */
export function shortClock(text: string): string {
  return text.replace(/\s*[ap]\.?m\.?$/i, "").trim();
}

/** Bars from Google's real predictions only; a slot with no prediction gets a stub, no number. */
export function leaveChartBars(predictions: LeavePrediction[], chartHeight: number, clock: (ms: number) => string): LeaveBar[] {
  const known = predictions.filter((p) => p.durationSeconds != null).map((p) => p.durationSeconds as number);
  const max = Math.max(...known);
  const min = Math.min(...known);
  const best = quickestSlot(predictions);
  return predictions.map((p, i) => {
    const label = i === 0 ? "Now" : shortClock(clock(p.departMs));
    if (p.durationSeconds == null) return { departMs: p.departMs, label, minutes: null, height: 8, best: false, slow: false };
    const h = max === min ? chartHeight * 0.6 : chartHeight * (0.3 + (0.7 * (p.durationSeconds - min)) / (max - min));
    return { departMs: p.departMs, label, minutes: Math.round(p.durationSeconds / 60), height: Math.round(h), best: best?.departMs === p.departMs, slow: p.durationSeconds > (min + max) / 2 };
  });
}
