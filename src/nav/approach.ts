// Following each manoeuvre through, as a small state machine. Every turn and exit is followed
// ("approach") to taken or missed; exits, merges, splits, roundabouts, lane changes and complex
// turns also get the close-up camera ("zoomed"):
//
//   normal --(within 200 m, or 400 m above 90 km/h, of an exit/merge/split/roundabout/lane
//            change/complex turn)--> approach
//   approach --(on the next road for 3 s or 50 m)--> confirm --(2 s)--> normal
//   approach --(more than 30 m off the route for 3 s)--> missed --(rerouted / failed)--> normal
//   anything --(user pans, reroute, arrival, new route)--> normal
//
// It never touches the map itself: each event returns the new state plus "effects" (zoom in,
// restore the camera, show the chip, reroute) that MapScreen carries out. So the rules are
// unit-tested without a map (__tests__/nav/approach.test.ts), and it can't get stuck zoomed in --
// every exit path emits a restore.

import type { LatLng } from "@/utils/polyline";
import type { RouteStep, ManeuverType } from "@/services/directions";
import { approachTriggerMeters, confirmationText, shouldTrack, shouldZoomFor, type ManoeuvreKind } from "@/nav/manoeuvre";

export type ApproachPhase = "normal" | "approach" | "confirm" | "missed";

export interface ApproachState {
  phase: ApproachPhase;
  /** Whether the camera is in the close-up view (only for exits, merges, splits...). */
  zoomed: boolean;
  /** The step whose manoeuvre is being approached (it ends at the manoeuvre point). */
  stepIndex: number | null;
  enteredAtMs: number;
  onNextSinceMs: number | null;
  offRouteSinceMs: number | null;
  confirmUntilMs: number | null;
  /** The last manoeuvre already resolved (taken), so each one is followed once, in order. */
  resolvedUpTo: number;
}

export const INITIAL_APPROACH: ApproachState = {
  phase: "normal",
  zoomed: false,
  stepIndex: null,
  enteredAtMs: 0,
  onNextSinceMs: null,
  offRouteSinceMs: null,
  confirmUntilMs: null,
  resolvedUpTo: -1,
};

/** Within this of the next road counts as on it. */
export const ON_ROAD_METERS = 20;
/**
 * Right after a split the exit ramp and the road carrying straight on run side by side (on the
 * real M4 at Silverwater they're 9 m apart 60 m past the split), so "near the exit road" alone
 * can't tell them apart. The driver also has to be clearly nearer the exit road than the
 * straight-on continuation, by this much.
 */
export const SEPARATION_MARGIN_METERS = 5;
export const CONTINUATION_METERS = 500;
/**
 * When the road after the split IS the road straight on (a slight bend), being near it proves
 * nothing until the alternatives would have parted: so then it's taken once the car is this far
 * past the split and still tightly on the route.
 */
export const UNAMBIGUOUS_PAST_METERS = 200;
export const TIGHT_ON_ROAD_METERS = 8;
/** Reaching the end of the NEXT step while on the route also proves the manoeuvre was taken. */
export const ON_ROUTE_METERS = 15;
/** Past the split by this much before "on the next road" can mean anything. */
export const PAST_SPLIT_METERS = 15;
export const CONFIRM_HOLD_MS = 3000;
export const CONFIRM_DISTANCE_METERS = 50;
export const MISSED_OFF_ROUTE_METERS = 30;
export const MISSED_HOLD_MS = 3000;
export const CHIP_MS = 2000;
/**
 * If nothing resolves in 3 min (parked by the road, stuck in a jam at the exit), give the camera
 * back anyway. Not sooner: slow traffic through a run of roundabouts, or a shallow fork that
 * drifts apart a metre every few metres, really does take over a minute to tell, and giving up
 * early would leave those turns without their "taken" -- or blame a miss on the next turn. Lost
 * GPS (a tunnel) sends no fixes at all, so it can't resolve anything wrongly meanwhile.
 */
export const APPROACH_GIVE_UP_MS = 180_000;

export const APPROACH_CAMERA = {
  /** Mapbox z18 (the camera calls take the Google scale, one higher; see map-v2/geo.ts). */
  zoom: 19,
  pitch: 60,
  durationMs: 1200,
};
export const RESTORE_MS = 1500;
export const RESTORE_FAST_MS = 600;

export type ApproachEffect =
  | { kind: "zoomIn"; stepIndex: number; center: LatLng; heading: number }
  | { kind: "restore"; durationMs: number }
  | { kind: "confirmed"; stepIndex: number; text: string }
  | { kind: "missed"; stepIndex: number };

export interface TickInput {
  nowMs: number;
  position: LatLng;
  speedKmh: number | null;
  activeStepIndex: number;
  steps: RouteStep[];
  /** Metres along the road to the end of the active step. */
  metersToManoeuvre: number;
  /** How far the driver is from the route line. */
  offRouteMeters: number;
}

export type ApproachEvent =
  | ({ type: "tick" } & TickInput)
  | { type: "panned" }
  | { type: "rerouted" }
  | { type: "rerouteFailed" }
  | { type: "arrived" }
  | { type: "routeChanged" };

/** The manoeuvre kind of a step: Mapbox says; Google routes are read from the manoeuvre code. */
export function kindOfStep(step: Pick<RouteStep, "maneuverKind" | "maneuver" | "lanes">): ManoeuvreKind | undefined {
  if (step.maneuverKind) return step.maneuverKind;
  const m: ManeuverType = step.maneuver;
  if (!m) return undefined;
  if (m.startsWith("ramp")) return "exit";
  if (m.startsWith("fork")) return "fork";
  if (m === "merge") return "merge";
  if (m.startsWith("roundabout")) return "roundabout";
  return m === "straight" ? "continue" : "turn";
}

// ---- geometry (equirectangular; plenty at these distances) ----

function metersXY(p: LatLng, refLat: number): [number, number] {
  const k = 111_320;
  return [p.longitude * k * Math.cos((refLat * Math.PI) / 180), p.latitude * k];
}

export function metersBetween(a: LatLng, b: LatLng): number {
  const [ax, ay] = metersXY(a, a.latitude);
  const [bx, by] = metersXY(b, a.latitude);
  return Math.hypot(ax - bx, ay - by);
}

export function distanceToLineMeters(p: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return metersBetween(p, line[0]);
  const [px, py] = metersXY(p, p.latitude);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = metersXY(line[i], p.latitude);
    const [bx, by] = metersXY(line[i + 1], p.latitude);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

export function bearingBetween(a: LatLng, b: LatLng): number {
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Where the approach road would go if the driver carried straight on past the split. */
export function continuationOf(line: LatLng[], lengthMeters = CONTINUATION_METERS): LatLng[] {
  if (line.length < 2) return line;
  const end = line[line.length - 1];
  // Bearing over the last ~40 m, so a last tiny segment doesn't skew it.
  let i = line.length - 2;
  while (i > 0 && metersBetween(line[i], end) < 40) i--;
  const bearing = (bearingBetween(line[i], end) * Math.PI) / 180;
  const dLat = (lengthMeters * Math.cos(bearing)) / 111_320;
  const dLng = (lengthMeters * Math.sin(bearing)) / (111_320 * Math.cos((end.latitude * Math.PI) / 180));
  return [end, { latitude: end.latitude + dLat, longitude: end.longitude + dLng }];
}

/** Centre the approach view a little ahead: between the car and the split, nearer the split. */
export function approachCenter(position: LatLng, manoeuvrePoint: LatLng): LatLng {
  const t = 0.65;
  return {
    latitude: position.latitude + (manoeuvrePoint.latitude - position.latitude) * t,
    longitude: position.longitude + (manoeuvrePoint.longitude - position.longitude) * t,
  };
}

// ---- the machine ----

function restoreIf(zoomed: boolean, durationMs: number): ApproachEffect[] {
  return zoomed ? [{ kind: "restore", durationMs }] : [];
}

function toNormal(from: ApproachState, effects: ApproachEffect[], durationMs: number): { state: ApproachState; effects: ApproachEffect[] } {
  return { state: INITIAL_APPROACH, effects: [...effects, ...restoreIf(from.zoomed, durationMs)] };
}

/** The next manoeuvre to follow after `after`: a turn or exit, with road after it. */
export function nextManoeuvre(steps: RouteStep[], after: number): number | null {
  for (let j = Math.max(0, after + 1); j < steps.length - 1; j++) {
    if (shouldTrack(kindOfStep(steps[j]))) return j;
  }
  return null;
}

/** Road distance from the car to the split at the end of step j. */
function metersToSplit(event: TickInput, j: number): number {
  if (j < event.activeStepIndex) return 0; // guidance has already reached it
  let m = event.metersToManoeuvre;
  for (let i = event.activeStepIndex + 1; i <= j; i++) m += event.steps[i]?.distanceMeters ?? 0;
  return m;
}

/** The route just after the split at the end of step j (up to `meters`), across short steps. */
export function roadAfterSplit(steps: RouteStep[], j: number, meters = 400): LatLng[] {
  const out: LatLng[] = [];
  let acc = 0;
  for (let i = j + 1; i < steps.length && acc < meters; i++) {
    const line = steps[i].polyline;
    for (let k = 0; k < line.length && acc < meters; k++) {
      if (out.length) acc += metersBetween(out[out.length - 1], line[k]);
      out.push(line[k]);
    }
  }
  return out;
}

/** The nearest point on a line, and how far along the line it is (metres). */
function projectOnto(p: LatLng, line: LatLng[]): { distance: number; along: number } {
  let best = { distance: Infinity, along: 0 };
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const seg = metersBetween(line[i], line[i + 1]);
    const d = distanceToLineMeters(p, [line[i], line[i + 1]]);
    if (d < best.distance) {
      // Pythagoras: distance from the segment start to the foot of the perpendicular.
      const foot = Math.sqrt(Math.max(0, metersBetween(line[i], p) ** 2 - d * d));
      best = { distance: d, along: acc + Math.min(seg, foot) };
    }
    acc += seg;
  }
  return best;
}

/**
 * How far past the split at the end of step j the car is, measured ALONG the route (negative =
 * still before it). Guidance moves to the next step a little before each split, and short city
 * steps come in runs, so the active step alone can't say which side of a split the car is on.
 */
export function metersPastSplit(position: LatLng, steps: RouteStep[], j: number): number {
  const before = steps[j]?.polyline ?? [];
  const after = roadAfterSplit(steps, j, 600);
  const b = before.length >= 2 ? projectOnto(position, before) : { distance: Infinity, along: 0 };
  const a = after.length >= 2 ? projectOnto(position, after) : { distance: Infinity, along: 0 };
  if (a.distance <= b.distance) return a.along;
  let length = 0;
  for (let i = 0; i < before.length - 1; i++) length += metersBetween(before[i], before[i + 1]);
  return b.along - length;
}

/**
 * Start following the next unresolved manoeuvre if it's close enough. Manoeuvres the car is
 * already well past (navigation started mid-route, a GPS gap) are skipped quietly.
 */
function startTracking(state: ApproachState, event: { type: "tick" } & TickInput): { state: ApproachState; effects: ApproachEffect[] } | null {
  const { steps, nowMs } = event;
  let resolvedUpTo = state.resolvedUpTo;
  let j = nextManoeuvre(steps, resolvedUpTo);
  // Guidance can run a step or two ahead through very short steps, so "behind" needs the car to
  // really be past that split (or nowhere near it).
  const behind = (k: number) =>
    k < event.activeStepIndex - 1 &&
    (metersPastSplit(event.position, steps, k) > PAST_SPLIT_METERS * 2 || metersBetween(event.position, steps[k].endLocation) > 300);
  while (j !== null && behind(j)) {
    resolvedUpTo = j;
    j = nextManoeuvre(steps, resolvedUpTo);
  }
  if (j === null) return null;
  const toSplit = metersToSplit(event, j);
  if (toSplit > approachTriggerMeters(event.speedKmh)) {
    return resolvedUpTo !== state.resolvedUpTo ? { state: { ...state, resolvedUpTo }, effects: [] } : null;
  }
  const step = steps[j];
  const zoom = shouldZoomFor(kindOfStep(step));
  return {
    state: { ...INITIAL_APPROACH, phase: "approach", zoomed: zoom, stepIndex: j, enteredAtMs: nowMs, resolvedUpTo },
    effects: zoom
      ? [
          {
            kind: "zoomIn",
            stepIndex: j,
            center: approachCenter(event.position, step.endLocation),
            heading: bearingBetween(event.position, step.endLocation),
          },
        ]
      : [],
  };
}

export function reduceApproach(state: ApproachState, event: ApproachEvent): { state: ApproachState; effects: ApproachEffect[] } {
  if (event.type !== "tick") {
    if (state.phase === "normal" && state.resolvedUpTo < 0) return { state, effects: [] };
    if (state.phase === "normal") return { state: INITIAL_APPROACH, effects: [] };
    // Any outside change gives the camera back. A reroute that answers a miss restores fast.
    const fast = state.phase === "missed" || event.type === "panned";
    return toNormal(state, [], fast ? RESTORE_FAST_MS : RESTORE_MS);
  }

  const { nowMs, steps } = event;

  if (state.phase === "normal" || state.phase === "confirm") {
    // The next manoeuvre can come right after the last one (city turns): follow it at once.
    const next = startTracking(state, event);
    if (next && next.state.phase === "approach") {
      const backOut = state.phase === "confirm" && state.zoomed && !next.state.zoomed ? restoreIf(true, RESTORE_MS) : [];
      return { state: next.state, effects: [...backOut, ...next.effects] };
    }
    const base = next ? next.state : state;
    if (state.phase === "confirm" && state.confirmUntilMs !== null && nowMs >= state.confirmUntilMs) {
      return { state: { ...INITIAL_APPROACH, resolvedUpTo: base.resolvedUpTo }, effects: restoreIf(state.zoomed, RESTORE_MS) };
    }
    return { state: base, effects: [] };
  }

  if (state.phase === "missed") {
    // Waiting for the reroute; MapScreen sends "rerouted" / "rerouteFailed".
    if (nowMs - state.enteredAtMs > APPROACH_GIVE_UP_MS) return toNormal(state, [], RESTORE_FAST_MS);
    return { state, effects: [] };
  }

  // phase === "approach"
  const index = state.stepIndex ?? event.activeStepIndex;
  const step = steps[index];
  const next = steps[index + 1];
  if (!step || !next || nowMs - state.enteredAtMs > APPROACH_GIVE_UP_MS) {
    return { state: { ...INITIAL_APPROACH, resolvedUpTo: index }, effects: restoreIf(state.zoomed, RESTORE_MS) };
  }

  // Missed: well off the route for a few seconds.
  let offRouteSinceMs = state.offRouteSinceMs;
  if (event.offRouteMeters > MISSED_OFF_ROUTE_METERS) {
    offRouteSinceMs ??= nowMs;
    if (nowMs - offRouteSinceMs >= MISSED_HOLD_MS) {
      return {
        state: { ...INITIAL_APPROACH, phase: "missed", stepIndex: index, enteredAtMs: nowMs, resolvedUpTo: state.resolvedUpTo },
        effects: [...restoreIf(state.zoomed, RESTORE_FAST_MS), { kind: "missed", stepIndex: index }],
      };
    }
  } else {
    offRouteSinceMs = null;
  }

  // Taken: past the split, on the road after it and clearly not on the road carrying straight
  // on, for 3 s or 50 m.
  // "Past" means along the route, not just distance: 70 m before a turn is as far from the split
  // as 70 m after it.
  const pastSplit = Math.max(0, metersPastSplit(event.position, steps, index));
  const toNext = distanceToLineMeters(event.position, roadAfterSplit(steps, index));
  const toStraightOn = distanceToLineMeters(event.position, continuationOf(step.polyline));
  // On the road after the split and clearly apart from the straight-on road...
  const apart = pastSplit >= PAST_SPLIT_METERS && toNext + SEPARATION_MARGIN_METERS < toStraightOn;
  const separated = apart && toNext <= ON_ROAD_METERS;
  // ...or far enough past it that any other road would have parted, still tightly on the route...
  const unambiguous = pastSplit >= UNAMBIGUOUS_PAST_METERS && toNext <= TIGHT_ON_ROAD_METERS;
  // ...and with the next manoeuvre already close (short city steps in a row), the same evidence
  // without waiting out the hold, so the next one isn't followed late.
  const wellPast =
    event.activeStepIndex >= index + 2 && event.offRouteMeters <= ON_ROUTE_METERS && apart && toNext <= TIGHT_ON_ROAD_METERS;
  const onNext = separated || unambiguous;
  let onNextSinceMs = state.onNextSinceMs;
  if (onNext || wellPast) {
    onNextSinceMs ??= nowMs;
    if (wellPast || nowMs - onNextSinceMs >= CONFIRM_HOLD_MS || pastSplit >= CONFIRM_DISTANCE_METERS) {
      const confirmed: ApproachState = {
        ...INITIAL_APPROACH,
        phase: "confirm",
        zoomed: state.zoomed,
        stepIndex: index,
        enteredAtMs: nowMs,
        confirmUntilMs: nowMs + CHIP_MS,
        resolvedUpTo: index,
      };
      const effects: ApproachEffect[] = [{ kind: "confirmed", stepIndex: index, text: confirmationText(kindOfStep(step)) }];
      // A manoeuvre straight after this one is followed from this same tick.
      const handover = startTracking(confirmed, event);
      if (handover && handover.state.phase === "approach") {
        const backOut = confirmed.zoomed && !handover.state.zoomed ? restoreIf(true, RESTORE_MS) : [];
        return { state: handover.state, effects: [...effects, ...backOut, ...handover.effects] };
      }
      return { state: confirmed, effects };
    }
  } else {
    onNextSinceMs = null;
  }

  return { state: { ...state, onNextSinceMs, offRouteSinceMs }, effects: [] };
}

/** The bit of route through the manoeuvre (for the wider, brighter line) and the road taken. */
export function manoeuvreHighlight(
  steps: RouteStep[],
  stepIndex: number,
  beforeMeters = 120,
  afterMeters = 160
): { through: LatLng[]; exitSide: LatLng[] } | null {
  const step = steps[stepIndex];
  const next = steps[stepIndex + 1];
  if (!step || !next || step.polyline.length < 2 || next.polyline.length < 2) return null;
  const tail: LatLng[] = [];
  let acc = 0;
  for (let i = step.polyline.length - 1; i > 0 && acc < beforeMeters; i--) {
    tail.unshift(step.polyline[i]);
    acc += metersBetween(step.polyline[i], step.polyline[i - 1]);
  }
  tail.unshift(step.polyline[Math.max(0, step.polyline.length - 1 - tail.length)]);
  const head: LatLng[] = [next.polyline[0]];
  acc = 0;
  for (let i = 1; i < next.polyline.length && acc < afterMeters; i++) {
    acc += metersBetween(next.polyline[i - 1], next.polyline[i]);
    head.push(next.polyline[i]);
  }
  return { through: [...tail, ...head.slice(1)], exitSide: head };
}
