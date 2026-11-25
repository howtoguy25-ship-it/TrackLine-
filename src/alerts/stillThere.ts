// When to ask "Still there?" about a report (AlertStillHereCard). One report at a time, never
// the driver's own, only once it's old enough for its type (and that long since anyone last
// said "Still here"), only when driving towards it within STILL_THERE_RADIUS_M, never twice
// about the same report, and never while the screen is busy with a turn (the card would
// cover the manoeuvre view or the turn chip).
import type { AlertDoc } from "@/types/alert";
import { stillThereWindow } from "@/types/alertPolicy";

export const STILL_THERE_RADIUS_M = 300;
export const STILL_THERE_MIN_SPEED_KMH = 5;
export const STILL_THERE_HEADING_TOLERANCE_DEG = 70;

export interface StillThereInput {
  nowMs: number;
  uid: string | null | undefined;
  position: { latitude: number; longitude: number };
  headingDeg: number;
  speedKmh: number | null;
  /** A manoeuvre close-up, turn chip or other nav prompt is on screen. */
  navBusy: boolean;
  alreadyAsked: ReadonlySet<string>;
}

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
function metres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function stillThereCandidate(alerts: readonly AlertDoc[], input: StillThereInput): AlertDoc | null {
  if (input.navBusy) return null;
  if (input.speedKmh === null || input.speedKmh < STILL_THERE_MIN_SPEED_KMH) return null;
  let best: { alert: AlertDoc; d: number } | null = null;
  for (const alert of alerts) {
    if (input.alreadyAsked.has(alert.id)) continue;
    if (input.uid && alert.createdBy === input.uid) continue;
    const w = stillThereWindow(alert.type);
    const since = Math.max(alert.createdAt, alert.lastConfirmedAt ?? 0);
    if (input.nowMs - since < w.askAfterMs) continue;
    if (alert.expiresAt <= input.nowMs) continue;
    const d = metres(input.position, { latitude: alert.lat, longitude: alert.lng });
    if (d > STILL_THERE_RADIUS_M) continue;
    const off = Math.abs(((bearing(input.position, { latitude: alert.lat, longitude: alert.lng }) - input.headingDeg + 540) % 360) - 180);
    if (off > STILL_THERE_HEADING_TOLERANCE_DEG) continue;
    if (!best || d < best.d) best = { alert, d };
  }
  return best?.alert ?? null;
}
