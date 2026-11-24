// Startup §4: the arrow turns like a tank turret -- smooth, never twitchy, never the wrong way.
//
// Which way it points (targetHeading):
//   moving > 8 km/h  -> the GPS course (map-matched to the road by the heading filter)
//   under 3 km/h     -> the phone's compass (true heading): the way the person is facing
//   3 - 8 km/h       -> a smooth blend from compass to course (no snapping)
// The compass is cleaned first (CompassFilter):
//   * poor accuracy (iOS headingAccuracy / Android calibration) -> keep the last good heading
//   * a change of more than 60° within 0.5 s (a magnetic mount, the car's metal) is ignored
//     unless the new direction holds for 1 s
//   * a low-pass filter, and changes under 4° ignored
// How it turns (HeadingTurret): toward the target along the shortest arc, accelerating and easing
// off (ease-in-out), never faster than 90°/s. Pure; tested with simulated compass + GPS streams in
// __tests__/startup/headingTurret.test.ts.
import { blendHeadings, normalize, shortestDelta } from "@/nav/headingFilter";

export const GPS_FULL_KMH = 8;
export const COMPASS_FULL_KMH = 3;
export const TURRET_MAX_DEG_S = 90;
export const TURRET_ACCEL_DEG_S2 = 300;
export const DEADBAND_DEG = 4;
export const SPIKE_DEG = 60;
export const SPIKE_WINDOW_MS = 500;
export const SPIKE_CONFIRM_MS = 1000;
export const SPIKE_AGREE_DEG = 20;
export const COMPASS_MAX_ACCURACY_DEG = 30;
export const COMPASS_LOWPASS = 0.25;

export interface CompassSample {
  timeMs: number;
  heading: number;
  /** Degrees of uncertainty (iOS headingAccuracy); null/negative = unknown. */
  accuracyDeg: number | null;
}

/** The compass, cleaned: accuracy-gated, spike-rejected, low-passed. */
export class CompassFilter {
  good: number | null = null;
  private lastTime: number | null = null;
  private pending: { heading: number; since: number } | null = null;

  push(s: CompassSample): number | null {
    const accurate = s.accuracyDeg !== null && s.accuracyDeg >= 0 && s.accuracyDeg <= COMPASS_MAX_ACCURACY_DEG;
    const dt = this.lastTime === null ? Infinity : s.timeMs - this.lastTime;
    this.lastTime = s.timeMs;
    if (!accurate) return this.good; // poor accuracy: keep the last good heading
    const h = normalize(s.heading);
    if (this.good === null) {
      this.good = h;
      return h;
    }
    const jump = Math.abs(shortestDelta(this.good, h));
    if (jump > SPIKE_DEG && (dt < SPIKE_WINDOW_MS || this.pending)) {
      // A sudden big change: hold it as a candidate; take it only if it stays put for 1 s.
      if (!this.pending || Math.abs(shortestDelta(this.pending.heading, h)) > SPIKE_AGREE_DEG) {
        this.pending = { heading: h, since: s.timeMs };
        return this.good;
      }
      if (s.timeMs - this.pending.since < SPIKE_CONFIRM_MS) return this.good;
      this.good = h;
      this.pending = null;
      return h;
    }
    this.pending = null;
    if (jump < DEADBAND_DEG) return this.good;
    this.good = normalize(this.good + shortestDelta(this.good, h) * COMPASS_LOWPASS);
    return this.good;
  }
}

/** Compass when slow, GPS course when moving, blended smoothly between 3 and 8 km/h. */
export function targetHeading(o: { speedKmh: number | null; gps: number | null; compass: number | null }): number | null {
  const v = o.speedKmh ?? 0;
  if (o.gps === null) return o.compass;
  if (o.compass === null) return o.gps;
  if (v >= GPS_FULL_KMH) return o.gps;
  if (v <= COMPASS_FULL_KMH) return o.compass;
  const w = (v - COMPASS_FULL_KMH) / (GPS_FULL_KMH - COMPASS_FULL_KMH);
  return blendHeadings(o.gps, o.compass, w);
}

/** Turns toward the target: ease in, cruise at most 90°/s, ease out; small changes ignored. */
export class HeadingTurret {
  heading: number | null = null;
  private target: number | null = null;
  private velocity = 0; // deg/s, signed
  private lastMs: number | null = null;
  private listeners = new Set<() => void>();

  /** Called whenever there's somewhere new to turn to (the arrow starts its frame loop). */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** At rest on the target: nothing to animate. */
  settled(): boolean {
    return this.velocity === 0 && this.heading !== null && this.heading === this.target;
  }

  setTarget(t: number | null): void {
    if (t === null || !Number.isFinite(t)) return;
    const n = normalize(t);
    if (this.heading === null) {
      this.heading = n;
      this.target = n;
      this.listeners.forEach((l) => l());
      return;
    }
    // Ignore jitter: a target within the deadband of where we're already pointing.
    if (this.velocity === 0 && Math.abs(shortestDelta(this.heading, n)) < DEADBAND_DEG) return;
    if (this.target === n) return;
    this.target = n;
    this.listeners.forEach((l) => l());
  }

  /** Advance to `nowMs`; returns the heading to draw. */
  step(nowMs: number): number | null {
    if (this.heading === null || this.target === null) {
      this.lastMs = nowMs;
      return this.heading;
    }
    const dt = this.lastMs === null ? 0 : Math.min(0.25, Math.max(0, (nowMs - this.lastMs) / 1000));
    this.lastMs = nowMs;
    if (dt === 0) return this.heading;
    const remaining = shortestDelta(this.heading, this.target);
    const dir = Math.sign(remaining);
    const brakeDist = (this.velocity * this.velocity) / (2 * TURRET_ACCEL_DEG_S2);
    let v = this.velocity;
    if (Math.abs(remaining) <= Math.max(brakeDist, 0.05) || Math.sign(v) === -dir) {
      // Ease out (or reverse): decelerate toward 0.
      const dv = TURRET_ACCEL_DEG_S2 * dt;
      v = Math.abs(v) <= dv ? 0 : v - Math.sign(v) * dv;
    } else {
      v = v + dir * TURRET_ACCEL_DEG_S2 * dt;
      v = Math.max(-TURRET_MAX_DEG_S, Math.min(TURRET_MAX_DEG_S, v));
    }
    let move = v * dt;
    // Never overshoot the target.
    if (Math.abs(move) > Math.abs(remaining) && Math.sign(move) === dir) {
      move = remaining;
      v = 0;
    }
    if (v === 0 && Math.abs(remaining) > 0 && Math.abs(move) === 0) {
      // Stopped short (decelerated to rest): start again next step toward what's left.
      v = dir * Math.min(TURRET_MAX_DEG_S, TURRET_ACCEL_DEG_S2 * dt);
      move = Math.sign(remaining) * Math.min(Math.abs(remaining), Math.abs(v) * dt);
    }
    this.velocity = v;
    this.heading = normalize(this.heading + move);
    if (Math.abs(shortestDelta(this.heading, this.target)) < 0.05) {
      this.heading = this.target;
      this.velocity = 0;
    }
    return this.heading;
  }
}
