// Fix pass 7 §2: the arrow is calm when you're still and sharp when you drive.
//
// Root cause of the twitching: the arrow (and the follow camera) drew every raw GPS fix. A parked
// phone's fixes wander 5-15 m and its compass wobbles a few degrees, so the arrow crept about and
// turned every second.
//
// Position (stillLockStep):
//   * still = speed under 1.5 m/s for 3 s (from the start, until the car moves, it's still);
//   * while still the position is LOCKED: fixes inside the deadband -- max(8 m, the fix's
//     accuracy) -- around the locked point are ignored (0 m of movement);
//   * it unlocks when the car really moves: speed at least 1.5 m/s AND outside the deadband, or
//     clearly driving (3 m/s+) -- on TWO fixes in a row at least 1 s apart (fix pass 7 §5: the
//     proof's 60 s parked run, with the odd spurious speed reading a parked phone gives, unlocked on
//     one lone 1.6 m/s fix 14 m off and then drew every raw fix: the arrow moved 14 m). Pulling
//     away costs one GPS second. The arrow then eases from the locked point to the new fix (the
//     arrow's own MotionSmoother), so there is no jump;
//   * moving: every fix goes straight through (60 fps interpolation and route matching happen
//     downstream), so there is no added lag.
// Heading (HeadingHold): while still, the compass is held; a new direction is taken only when the
// phone has turned more than 20° and stayed there for 1 s, then the turret rotates smoothly. While
// moving, the GPS course is used as before.
// Pure; tested in __tests__/fixPass7/calmArrow.test.ts (60 s stationary with ±10 m noise, and a
// drive).
import { distanceKm } from "@/utils/geo";
import { shortestDelta } from "@/nav/headingFilter";

export const STILL_SPEED_MS = 1.5;
export const STILL_CONFIRM_MS = 3000;
export const MIN_DEADBAND_M = 8;
export const CLEARLY_MOVING_MS = 3;
export const HEADING_HOLD_DEG = 20;
export const HEADING_HOLD_MS = 1000;
/** Two "moving" fixes this far apart (or more) unlock the arrow. */
export const MOVE_CONFIRM_MS = 1000;

export interface Fix {
  latitude: number;
  longitude: number;
  /** Metres; null when the fix didn't report one. */
  accuracy: number | null;
  /** m/s; null or negative when unknown. */
  speed: number | null;
  timeMs: number;
}

export interface StillState {
  locked: boolean;
  /** Where the arrow is drawn (the locked point while still). */
  latitude: number;
  longitude: number;
  /** When speed first dropped under the threshold (while moving); null when not slow. */
  slowSince: number | null;
  started: boolean;
  /** While locked: when the current run of "moving" fixes began (null when the last fix wasn't). */
  movingSince?: number | null;
}

export const INITIAL_STILL: StillState = { locked: true, latitude: 0, longitude: 0, slowSince: null, started: false };

const metres = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) =>
  distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;

export function deadbandMeters(accuracy: number | null): number {
  return Math.max(MIN_DEADBAND_M, accuracy != null && Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 0);
}

export function stillLockStep(s: StillState, f: Fix): StillState {
  if (!s.started) return { locked: true, latitude: f.latitude, longitude: f.longitude, slowSince: f.timeMs, started: true };
  const speed = f.speed != null && f.speed >= 0 ? f.speed : null;
  const away = metres(s, f);
  const band = deadbandMeters(f.accuracy);
  if (s.locked) {
    const moving = (speed != null && speed >= CLEARLY_MOVING_MS) || (speed != null && speed >= STILL_SPEED_MS && away > band) || (speed == null && away > band * 2);
    if (!moving) return s.movingSince != null ? { ...s, movingSince: null } : s; // the arrow stays exactly where it is
    const since = s.movingSince ?? f.timeMs;
    if (f.timeMs - since < MOVE_CONFIRM_MS) return { ...s, movingSince: since }; // one fix isn't enough
    return { locked: false, latitude: f.latitude, longitude: f.longitude, slowSince: null, started: true, movingSince: null };
  }
  // Moving: every fix passes straight through.
  const slow = speed != null ? speed < STILL_SPEED_MS : away <= band;
  const slowSince = slow ? (s.slowSince ?? f.timeMs) : null;
  const lock = slowSince != null && f.timeMs - slowSince >= STILL_CONFIRM_MS;
  return { locked: lock, latitude: f.latitude, longitude: f.longitude, slowSince, started: true };
}

/** While still, the compass direction is held until the phone turns > 20° and stays there 1 s. */
export class HeadingHold {
  held: number | null = null;
  private candidate: { heading: number; since: number } | null = null;

  push(heading: number | null, timeMs: number, still: boolean): number | null {
    if (heading == null) return this.held;
    if (!still || this.held == null) {
      this.held = heading;
      this.candidate = null;
      return heading;
    }
    if (Math.abs(shortestDelta(this.held, heading)) <= HEADING_HOLD_DEG) {
      this.candidate = null;
      return this.held;
    }
    if (!this.candidate || Math.abs(shortestDelta(this.candidate.heading, heading)) > HEADING_HOLD_DEG) {
      this.candidate = { heading, since: timeMs };
      return this.held;
    }
    if (timeMs - this.candidate.since >= HEADING_HOLD_MS) {
      this.held = heading;
      this.candidate = null;
    }
    return this.held;
  }
}

/**
 * Driving on the route: the arrow's distance along the route, smoothed (an alpha-beta filter).
 * The matcher's point is on the road, but GPS noise in the direction of travel (±5-6 m) passed
 * straight through, so the arrow surged and dropped back. Here each second's position is
 * predicted from the speed and nudged a quarter of the way toward the measurement: on the road,
 * within ~3 m of the car, every fix, with no lag at a steady speed. A real jump (> 40 m, a
 * reroute or a skipped stretch) is taken at once.
 */
export const ALONG_GAIN = 0.25;
export const ALONG_SPEED_GAIN = 0.1;
export const ALONG_RESET_M = 40;

export interface AlongState {
  along: number;
  /** m/s along the route. */
  rate: number;
  timeMs: number;
}

export function smoothAlong(prev: AlongState | null, measured: number, speedMps: number | null, timeMs: number): AlongState {
  if (!prev || timeMs <= prev.timeMs) return { along: measured, rate: speedMps ?? 0, timeMs };
  const dt = Math.min(5, (timeMs - prev.timeMs) / 1000);
  const rate = speedMps != null && speedMps >= 0 ? speedMps : prev.rate;
  const predicted = prev.along + rate * dt;
  const residual = measured - predicted;
  if (Math.abs(residual) > ALONG_RESET_M) return { along: measured, rate, timeMs };
  return { along: predicted + ALONG_GAIN * residual, rate: rate + (ALONG_SPEED_GAIN * residual) / dt, timeMs };
}
