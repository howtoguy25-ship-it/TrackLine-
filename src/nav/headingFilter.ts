// Which way the map faces -- decided here, never straight from a sensor, so it can't flip,
// spin at the lights or follow a phone mount's magnet. Pure state machine; MapScreen feeds it
// each GPS fix (and compass reading) and uses `heading` for the camera and the arrow.
//
// Sources, by speed (km/h):
//   navigating + on the route      -> the route's own road direction at the matched point
//   > 10                           -> GPS course (direction of travel); compass ignored
//   3 - 10                         -> blend, 80% GPS course / 20% compass (when compass is good)
//   < 3 or stopped                 -> FREEZE the last good heading
//   walking, or before the first movement -> compass, only when its accuracy is under 25° and it
//                                     hasn't just jumped (a magnetic mount makes big sudden jumps)
// Guards:
//   a change of more than 90° in under 1 s is not taken at once: it needs 3 consecutive fixes
//   agreeing, and -- because only a real U-turn reverses direction -- 5 s and 30 m of movement
//   that way; after a gap (tunnel, app resume, GPS jump) the old heading holds until 3
//   consistent fixes agree.
// Output is smoothed with a 300 ms time constant, always the shortest way round (359° -> 1° is
// +2°, never -358°).

export const MOVING_KMH = 10;
export const CREEP_KMH = 3;
export const COMPASS_MAX_ACCURACY_DEG = 25;
/** A compass reading that moves more than this within a second is magnet noise. */
export const COMPASS_JUMP_DEG = 45;
export const FLIP_DEG = 90;
/** Compass readings closer together than this are compared for magnet jumps. */
export const FLIP_WINDOW_MS = 1000;
export const CONFIRM_FIXES = 3;
/** Fixes agreeing with each other to within this. */
export const AGREE_DEG = 30;
export const UTURN_MS = 5000;
export const UTURN_METERS = 30;
/** No fix for longer than this is a gap (tunnel, background, signal loss). */
export const GAP_MS = 3000;
export const SMOOTH_TAU_MS = 300;
export const BLEND_GPS_WEIGHT = 0.8;

export interface HeadingFix {
  timeMs: number;
  speedKmh: number | null;
  /** GPS course over ground, degrees; null when the OS has none. */
  gpsCourse: number | null;
  /** Bearing between this fix and the previous one (movement direction), when it moved ≥3 m. */
  movementBearing: number | null;
  /** Metres moved since the previous fix. */
  movedMeters: number;
  /** Route-matched road direction, when navigating and on the route. */
  roadBearing: number | null;
  walking?: boolean;
}

export interface CompassReading {
  timeMs: number;
  heading: number;
  /** iOS headingAccuracy in degrees; null/negative when unknown. */
  accuracyDeg: number | null;
}

export interface HeadingState {
  /** The accepted heading (before smoothing). */
  target: number | null;
  /** What's drawn (smoothed). */
  shown: number | null;
  lastFixMs: number | null;
  lastAcceptMs: number | null;
  hasMoved: boolean;
  /** A big change waiting for confirmation. */
  pending: { heading: number; fixes: number; sinceMs: number; meters: number } | null;
  /** After a gap: hold until this many consistent fixes. */
  reacquire: { heading: number | null; fixes: number } | null;
  lastCompass: CompassReading | null;
  compassTrusted: boolean;
}

export function initialHeadingState(): HeadingState {
  return { target: null, shown: null, lastFixMs: null, lastAcceptMs: null, hasMoved: false, pending: null, reacquire: null, lastCompass: null, compassTrusted: false };
}

export function normalize(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Signed shortest change from a to b, in (-180, 180]. 359 -> 1 is +2. */
export function shortestDelta(a: number, b: number): number {
  let d = normalize(b) - normalize(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Exponential smoothing toward target along the shortest arc. */
export function smoothHeading(prev: number | null, target: number, dtMs: number, tauMs = SMOOTH_TAU_MS): number {
  if (prev === null || !Number.isFinite(prev)) return normalize(target);
  const alpha = dtMs <= 0 ? 0 : 1 - Math.exp(-dtMs / tauMs);
  return normalize(prev + shortestDelta(prev, target) * alpha);
}

/** Weighted mean of two headings on the circle. */
export function blendHeadings(a: number, b: number, weightA: number): number {
  return normalize(a + shortestDelta(a, b) * (1 - weightA));
}

/** A compass reading: is it usable (accurate, and not a magnet-style jump)? */
export function stepCompass(state: HeadingState, reading: CompassReading): HeadingState {
  const accurate = reading.accuracyDeg !== null && reading.accuracyDeg >= 0 && reading.accuracyDeg < COMPASS_MAX_ACCURACY_DEG;
  const prev = state.lastCompass;
  const jumped = !!prev && reading.timeMs - prev.timeMs < FLIP_WINDOW_MS && Math.abs(shortestDelta(prev.heading, reading.heading)) > COMPASS_JUMP_DEG;
  return { ...state, lastCompass: reading, compassTrusted: accurate && !jumped };
}

/** Is the compass allowed to steer right now? (walking, or not yet moved, and slow) */
export function compassAllowed(state: HeadingState, fix: Pick<HeadingFix, "speedKmh" | "walking">): boolean {
  const slow = (fix.speedKmh ?? 0) < CREEP_KMH;
  return state.compassTrusted && (!!fix.walking || (!state.hasMoved && slow));
}

function candidateFor(state: HeadingState, fix: HeadingFix): number | null {
  const speed = fix.speedKmh ?? 0;
  if (fix.roadBearing !== null && !fix.walking) return fix.roadBearing;
  const course = fix.gpsCourse ?? fix.movementBearing;
  if (fix.walking) {
    if (state.compassTrusted && state.lastCompass) return state.lastCompass.heading;
    return speed >= CREEP_KMH ? course : null;
  }
  if (speed > MOVING_KMH) return course;
  if (speed >= CREEP_KMH) {
    if (course === null) return null;
    return state.compassTrusted && state.lastCompass ? blendHeadings(course, state.lastCompass.heading, BLEND_GPS_WEIGHT) : course;
  }
  // Below 3 km/h: freeze -- unless we've never moved and the compass is good.
  if (!state.hasMoved && state.compassTrusted && state.lastCompass) return state.lastCompass.heading;
  return null;
}

/** One GPS fix in; the next state out. */
export function stepHeading(state: HeadingState, fix: HeadingFix): HeadingState {
  const speed = fix.speedKmh ?? 0;
  const gap = state.lastFixMs !== null && fix.timeMs - state.lastFixMs > GAP_MS;
  const dt = state.lastFixMs === null ? 0 : fix.timeMs - state.lastFixMs;
  let next: HeadingState = { ...state, lastFixMs: fix.timeMs, hasMoved: state.hasMoved || speed >= CREEP_KMH };
  if (gap && next.target !== null) next = { ...next, reacquire: { heading: null, fixes: 0 }, pending: null };

  const candidate = candidateFor(state, fix);
  if (candidate === null) {
    // Frozen: nothing to steer by (stopped, or no course yet). Keep what's shown.
    return { ...next, shown: next.target === null ? null : smoothHeading(next.shown, next.target, dt) };
  }

  // Reacquiring after a gap: hold until 3 consistent fixes agree.
  if (next.reacquire) {
    const r = next.reacquire;
    const agrees = r.heading !== null && Math.abs(shortestDelta(r.heading, candidate)) <= AGREE_DEG;
    const fixes = agrees ? r.fixes + 1 : 1;
    if (fixes < CONFIRM_FIXES) {
      return { ...next, reacquire: { heading: candidate, fixes }, shown: next.target === null ? null : smoothHeading(next.shown, next.target, dt) };
    }
    next = { ...next, reacquire: null };
    // The 3 fixes agree: accept what they say, unless it reverses direction (that's a U-turn,
    // which the flip guard below decides).
  }

  if (next.target === null) {
    return { ...next, target: candidate, shown: normalize(candidate), lastAcceptMs: fix.timeMs, pending: null };
  }

  const change = Math.abs(shortestDelta(next.target, candidate));
  // The route's own road direction is geometry, not a sensor: always taken. Anything else that
  // swings more than 90° from the current heading at once is held: a real turn never does that
  // between two fixes (the heading follows it fix by fix), a GPS glitch or a reversal does.
  const fromRoad = fix.roadBearing !== null && !fix.walking;
  if (!fromRoad && change > FLIP_DEG) {
    const p = next.pending;
    const consistent = p !== null && Math.abs(shortestDelta(p.heading, candidate)) <= AGREE_DEG;
    const pending = consistent
      ? { heading: candidate, fixes: p!.fixes + 1, sinceMs: p!.sinceMs, meters: p!.meters + fix.movedMeters }
      : { heading: candidate, fixes: 1, sinceMs: fix.timeMs, meters: fix.movedMeters };
    // Accepted only as a real U-turn: 3+ agreeing fixes over 5 s and 30 m, while moving.
    const confirmed =
      pending.fixes >= CONFIRM_FIXES && fix.timeMs - pending.sinceMs >= UTURN_MS && pending.meters >= UTURN_METERS && speed >= CREEP_KMH;
    if (!confirmed) return { ...next, pending, shown: smoothHeading(next.shown, next.target, dt) };
  }

  return { ...next, target: candidate, pending: null, lastAcceptMs: fix.timeMs, shown: smoothHeading(next.shown, candidate, dt) };
}
