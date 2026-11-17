// Turning one GPS fix into a speed for the speedometer. Pure, so it's tested directly
// (__tests__/gpsSpeed.test.ts).
//
// The 3253 km/h reading: when a fix had no Doppler speed, speed was worked out as distance /
// time since the previous fix. Two fixes a few milliseconds apart (or a jump between a stale and
// a fresh position) divided a few metres by almost nothing. Now: the OS speed is used only when
// it's a real number >= 0; the distance fallback only across at least 0.5 s; and anything above
// a car's possible speed is treated as a bad fix, not shown.

export const MAX_PLAUSIBLE_KMH = 300;
const MIN_FALLBACK_SECONDS = 0.5;
const MS_TO_KMH = 3.6;

export interface FixPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
}

function metersBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * km/h for this fix, or null when it can't be trusted (skip it: don't show it, don't smooth it).
 * `speedMs` is the OS's speed in metres per second (iOS/Android report -1 or null when unknown).
 */
export function rawSpeedKmh(speedMs: number | null | undefined, here: FixPoint, last: FixPoint | null): number | null {
  if (typeof speedMs === "number" && Number.isFinite(speedMs) && speedMs >= 0) {
    const kmh = speedMs * MS_TO_KMH;
    return kmh <= MAX_PLAUSIBLE_KMH ? kmh : null;
  }
  if (!last) return 0;
  const dt = (here.timestamp - last.timestamp) / 1000;
  if (!Number.isFinite(dt) || dt < MIN_FALLBACK_SECONDS) return null;
  const kmh = (metersBetween(last, here) / dt) * MS_TO_KMH;
  return Number.isFinite(kmh) && kmh <= MAX_PLAUSIBLE_KMH ? kmh : null;
}

/** What the dial shows: a whole number from 0 to 300, 0 for anything invalid. */
export function displayKmh(kmh: number | null | undefined): number {
  if (typeof kmh !== "number" || !Number.isFinite(kmh) || kmh < 0) return 0;
  return Math.round(Math.min(MAX_PLAUSIBLE_KMH, kmh));
}
