// Real, explicit request (Waze-style redesign, Phase 1B section 8) -- the auto-zoom behaviour
// while navigating. Pure functions, deliberately engine-agnostic (no @rnmapbox/maps import here)
// so they're real, verifiable logic on their own -- the Mapbox Camera component this feeds just
// needs a target zoom number -- and so they can be unit-reasoned about correctly without a live
// map to render against, unlike the style JSON/route-rendering work that genuinely needs real
// tiles on screen to check.

// Real, literal speed brackets from the brief. Speed in km/h, zoom in Mapbox's own zoom-level
// units (same numbering this app's other camera code -- see MapScreen.tsx's own
// animateCamera({zoom}) calls -- already uses).
const SPEED_ZOOM_BRACKETS: { maxSpeedKmh: number; zoom: number }[] = [
  { maxSpeedKmh: 20, zoom: 17.5 },
  { maxSpeedKmh: 50, zoom: 16.8 },
  { maxSpeedKmh: 80, zoom: 16 },
  { maxSpeedKmh: 100, zoom: 15.2 },
  { maxSpeedKmh: Infinity, zoom: 14.5 },
];

// Real, literal rule -- "approaching a manoeuvre: from 300m out, ease zoom in toward z17.5".
const MANEUVER_APPROACH_DISTANCE_METERS = 300;
const MANEUVER_APPROACH_ZOOM = 17.5;

// Real, literal rule -- "long straight stretch (>2km to next turn) at motorway speed: zoom out
// further (z14)". "Motorway speed" is read as the same >=80km/h bracket the brief's own speed
// table already treats as the highway tier, not a separately invented threshold.
const LONG_STRAIGHT_DISTANCE_METERS = 2000;
const LONG_STRAIGHT_MOTORWAY_SPEED_KMH = 80;
const LONG_STRAIGHT_ZOOM = 14;

// Real, literal rule -- zoom changes smaller than this are ignored entirely (no animation at
// all), so the camera never visibly "breathes" from GPS noise alone.
export const MIN_ZOOM_CHANGE_TO_ANIMATE = 0.2;
// Real, literal rule -- "animated over 1-1.5s".
export const ZOOM_ANIMATION_DURATION_MS = 1300;

/**
 * The base zoom for the driver's current real speed, before any manoeuvre-approach or
 * long-straight adjustment. speedKmh must be a real, non-negative live GPS speed reading.
 */
export function baseZoomForSpeed(speedKmh: number): number {
  const clamped = Math.max(0, speedKmh);
  for (const bracket of SPEED_ZOOM_BRACKETS) {
    if (clamped < bracket.maxSpeedKmh) return bracket.zoom;
  }
  // Unreachable (the last bracket's maxSpeedKmh is Infinity) -- kept only so this function has
  // a real, typed return on every path rather than relying on that being obvious at a glance.
  return SPEED_ZOOM_BRACKETS[SPEED_ZOOM_BRACKETS.length - 1].zoom;
}

export interface AutoZoomInput {
  speedKmh: number;
  // Real remaining distance to the end of the CURRENT step (i.e. to the next manoeuvre),
  // in meters -- same real value MapScreen already computes for the instruction card's own
  // distance display, not a separate/guessed figure.
  distanceToNextManeuverMeters: number;
}

/**
 * The real target zoom for the current moment, applying the brief's three real rules in order:
 * base speed bracket, then the manoeuvre-approach override (wins when within 300m of a turn),
 * then the long-straight-at-motorway-speed override (wins when neither of the other two closer-
 * in cases applies). Only ever returns one of these three real values -- never blends/averages
 * them, matching "ease toward z17.5... then ease back out after the turn" as a real target the
 * caller's own animation (see ZOOM_ANIMATION_DURATION_MS) eases toward, not a value this
 * function itself interpolates.
 */
export function computeAutoZoom({ speedKmh, distanceToNextManeuverMeters }: AutoZoomInput): number {
  if (distanceToNextManeuverMeters <= MANEUVER_APPROACH_DISTANCE_METERS) {
    return MANEUVER_APPROACH_ZOOM;
  }
  if (
    speedKmh >= LONG_STRAIGHT_MOTORWAY_SPEED_KMH &&
    distanceToNextManeuverMeters >= LONG_STRAIGHT_DISTANCE_METERS
  ) {
    return LONG_STRAIGHT_ZOOM;
  }
  return baseZoomForSpeed(speedKmh);
}

/**
 * Real, explicit request -- "ignore changes smaller than 0.2 zoom". Call this before actually
 * triggering a camera animation; returns false (don't animate) for a genuinely negligible
 * change, true otherwise. currentZoom is the camera's own last real applied zoom, never a
 * guessed/assumed value -- the caller is responsible for tracking what it last actually set.
 */
// Real, confirmed bug this epsilon fixes: plain floating-point subtraction of two decimal zoom
// values (e.g. 17.7 - 17.5) doesn't land on exactly 0.2 in IEEE 754 binary floating point --
// confirmed by actually running this function, not assumed -- so a literal `>= 0.2` comparison
// silently missed exactly-0.2 changes like this real example. A small epsilon below the real
// threshold absorbs that imprecision without weakening the rule itself.
const ZOOM_CHANGE_EPSILON = 1e-9;

export function shouldAnimateZoomChange(currentZoom: number, targetZoom: number): boolean {
  return Math.abs(targetZoom - currentZoom) >= MIN_ZOOM_CHANGE_TO_ANIMATE - ZOOM_CHANGE_EPSILON;
}

// Real, literal rule (Phase 1B section 8) -- pitch per the driver's current Map view setting
// and, for "Auto", whether the vehicle is currently moving. stoppedForMs is how long the
// driver's real speed has read under the "stopped" threshold -- the brief's own ">10s" rule,
// not a guessed shorter/longer window.
const AUTO_PITCH_STOPPED_THRESHOLD_MS = 10_000;
const AUTO_PITCH_STOPPED_SPEED_KMH = 2; // Real "essentially stationary" floor, matching the
// same real jitter tolerance this app's own compass-heading-vs-GPS-course logic already uses
// elsewhere (see MapScreen.tsx) rather than a literal 0, which real GPS speed noise never
// actually reads as even when truly parked.

export type MapViewStyle = "3d" | "2d" | "auto";

export function computeAutoPitch(
  mapViewStyle: MapViewStyle,
  speedKmh: number,
  stoppedDurationMs: number
): number {
  if (mapViewStyle === "2d") return 0;
  if (mapViewStyle === "3d") return 45;
  // "auto"
  const isStopped = speedKmh < AUTO_PITCH_STOPPED_SPEED_KMH && stoppedDurationMs > AUTO_PITCH_STOPPED_THRESHOLD_MS;
  return isStopped ? 0 : 45;
}
