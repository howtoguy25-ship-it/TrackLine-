// The driver's arrow between GPS fixes (permanent fix §1). One stream of fixes goes in; at every
// frame the arrow's position and heading come out, eased from where it's drawn now to the newest
// fix over the gap between fixes (at most 1 s), so it glides instead of jumping. Out-of-order and
// stale fixes are dropped. No heading yet keeps the last one (or north) -- the same arrow, never
// a different shape. Pure; tested in __tests__/map/userArrow.test.ts.

export const MAX_EASE_MS = 1000;
/** A fix older than this (by its own timestamp) than the newest one seen is stale. */
export const STALE_MS = 5000;
/** Farther than this in one fix is a teleport (GPS replay jump, a new drive): snap, don't glide. */
export const SNAP_METERS = 500;

export interface Fix {
  latitude: number;
  longitude: number;
  /** Degrees, or null when the phone has no heading yet. */
  heading: number | null;
  timeMs: number;
}

export interface Pose {
  latitude: number;
  longitude: number;
  heading: number;
}

function wrap(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Shortest turn from a to b, degrees in (-180, 180]. */
export function turn(a: number, b: number): number {
  let d = wrap(b) - wrap(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function metres(a: Pose, b: { latitude: number; longitude: number }): number {
  const R = 6371000;
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : 1 - (1 - t) * (1 - t));

export class MotionSmoother {
  private from: Pose | null = null;
  private to: Pose | null = null;
  private startMs = 0;
  private durMs = 0;
  private lastFixMs = -Infinity;

  /** A new fix. Returns false when it was dropped (older than one already used, or stale). */
  push(f: Fix, nowMs: number): boolean {
    if (f.timeMs <= this.lastFixMs || this.lastFixMs - f.timeMs > STALE_MS) return false;
    const gap = Number.isFinite(this.lastFixMs) ? f.timeMs - this.lastFixMs : 0;
    this.lastFixMs = f.timeMs;
    const current = this.at(nowMs);
    const heading = f.heading != null && Number.isFinite(f.heading) ? wrap(f.heading) : current?.heading ?? 0;
    const target = { latitude: f.latitude, longitude: f.longitude, heading };
    if (!current || metres(current, target) > SNAP_METERS) {
      this.from = target;
      this.to = target;
      this.durMs = 0;
      this.startMs = nowMs;
      return true;
    }
    this.from = current;
    this.to = target;
    this.startMs = nowMs;
    this.durMs = Math.max(0, Math.min(MAX_EASE_MS, gap));
    return true;
  }

  /** Where to draw the arrow at `nowMs` (null before the first fix). */
  at(nowMs: number): Pose | null {
    if (!this.from || !this.to) return null;
    const t = this.durMs > 0 ? ease((nowMs - this.startMs) / this.durMs) : 1;
    return {
      latitude: this.from.latitude + (this.to.latitude - this.from.latitude) * t,
      longitude: this.from.longitude + (this.to.longitude - this.from.longitude) * t,
      heading: wrap(this.from.heading + turn(this.from.heading, this.to.heading) * t),
    };
  }

  /** True while the arrow is still easing (keep drawing frames). */
  moving(nowMs: number): boolean {
    return !!this.from && this.durMs > 0 && nowMs - this.startMs < this.durMs;
  }
}
