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
  /** Progress along the route when the "taken" evidence began (for the 50 m rule). */
  evidenceAlong: number | null;
  /** Fixes in a row WITHOUT the evidence (one noisy fix doesn't reset it; two do). */
  evidenceMisses: number;
  /** Fixes in a row well off the route (a single wild fix never counts as a miss). */
  offRouteFixes: number;
  /** When the close-up camera went in (it never stays in longer than ZOOM_MAX_MS). */
  zoomedAtMs: number | null;
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
  evidenceAlong: null,
  evidenceMisses: 0,
  offRouteFixes: 0,
  zoomedAtMs: null,
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
/** ...and at least this many fixes: one wild fix, or two, is never a miss. */
export const MISSED_MIN_FIXES = 3;
/** The close-up camera gives way after this long, whatever is happening (tracking carries on). */
export const ZOOM_MAX_MS = 20_000;
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
  /** Progress along the route (metres), from the route matcher -- continuous, never backwards. */
  alongMeters: number;
  /** Distance along the route at the end of each step (the matcher's RouteGeometry.stepEnds). */
  stepEndsAlong: number[];
  /**
   * How far the driver is from the road the route takes here (heading-aware, from the matcher);
   * null when it can't be trusted (GPS accuracy worse than 30 m, no fix, dead reckoning).
   */
  offRouteMeters: number | null;
}

export type ApproachEvent =
  | ({ type: "tick" } & TickInput)
  | { type: "panned" }
  | { type: "rerouted" }
  | { type: "rerouteFailed" }
  | { type: "arrived"; steps?: RouteStep[] }
  | { type: "routeChanged" }
  /** The app came back to the foreground. */
  | { type: "resumed" };

/** The manoeuvre kind of a step: Mapbox says; Google routes are read from the manoeuvre code. */
export function kindOfStep(step: Pick<RouteStep, "maneuverKind" | "maneuver" | "lanes">): ManoeuvreKind | undefined {
  if (step.maneuverKind) return step.maneuverKind;
  const m: ManeuverType = step.maneuver;
  if (!m) return undefined;
  if (m.startsWith("ramp")) return "exit";
  if (m.startsWith("fork") || (m as string).startsWith("keep")) return "fork";
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

/** Road distance from the car to the split at the end of step j (negative once past it). */
function metersToSplit(event: TickInput, j: number): number {
  return (event.stepEndsAlong[j] ?? Infinity) - event.alongMeters;
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

/**
 * Start following the next unresolved manoeuvre if it's close enough. Manoeuvres the car is
 * already well past along the route (navigation started mid-route, a GPS gap) are skipped.
 */
function startTracking(state: ApproachState, event: { type: "tick" } & TickInput): { state: ApproachState; effects: ApproachEffect[] } | null {
  const { steps, nowMs } = event;
  let resolvedUpTo = state.resolvedUpTo;
  let j = nextManoeuvre(steps, resolvedUpTo);
  while (j !== null && metersToSplit(event, j) < -PAST_SPLIT_METERS * 2) {
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
    state: { ...INITIAL_APPROACH, phase: "approach", zoomed: zoom, zoomedAtMs: zoom ? nowMs : null, stepIndex: j, enteredAtMs: nowMs, resolvedUpTo },
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

/**
 * Taken: `index` and any later manoeuvres the car has already driven through on the route
 * (a run of short city steps resolves together). Then the next one is followed at once.
 */
function confirmTaken(state: ApproachState, event: { type: "tick" } & TickInput, index: number): { state: ApproachState; effects: ApproachEffect[] } {
  const { steps, nowMs } = event;
  const effects: ApproachEffect[] = [{ kind: "confirmed", stepIndex: index, text: confirmationText(kindOfStep(steps[index])) }];
  let resolvedUpTo = index;
  // Later ones only with the same weight of evidence: 50 m past their split, still on the route.
  const onRoute = event.offRouteMeters !== null && event.offRouteMeters <= ON_ROAD_METERS;
  for (let k = nextManoeuvre(steps, index); onRoute && k !== null && metersToSplit(event, k) <= -CONFIRM_DISTANCE_METERS; k = nextManoeuvre(steps, k)) {
    effects.push({ kind: "confirmed", stepIndex: k, text: confirmationText(kindOfStep(steps[k])) });
    resolvedUpTo = k;
  }
  const confirmed: ApproachState = {
    ...INITIAL_APPROACH,
    phase: "confirm",
    zoomed: state.zoomed,
    zoomedAtMs: state.zoomedAtMs,
    stepIndex: resolvedUpTo,
    enteredAtMs: nowMs,
    confirmUntilMs: nowMs + CHIP_MS,
    resolvedUpTo,
  };
  const handover = startTracking(confirmed, event);
  if (handover && handover.state.phase === "approach") {
    const backOut = confirmed.zoomed && !handover.state.zoomed ? restoreIf(true, RESTORE_MS) : [];
    return { state: handover.state, effects: [...effects, ...backOut, ...handover.effects] };
  }
  return { state: confirmed, effects };
}

export function reduceApproach(state: ApproachState, event: ApproachEvent): { state: ApproachState; effects: ApproachEffect[] } {
  if (event.type === "resumed") {
    // Back in the app: the camera starts from the normal view; following carries on.
    return state.zoomed ? { state: { ...state, zoomed: false, zoomedAtMs: null }, effects: restoreIf(true, RESTORE_FAST_MS) } : { state, effects: [] };
  }
  if (event.type === "arrived" && state.phase === "approach" && state.stepIndex !== null && state.onNextSinceMs !== null) {
    // The last turn before the destination: arriving is the rest of the evidence.
    const index = state.stepIndex;
    return {
      state: INITIAL_APPROACH,
      effects: [{ kind: "confirmed", stepIndex: index, text: confirmationText(event.steps?.[index] ? kindOfStep(event.steps[index]) : undefined) }, ...restoreIf(state.zoomed, RESTORE_MS)],
    };
  }
  if (event.type !== "tick") {
    if (state.phase === "normal" && state.resolvedUpTo < 0) return { state, effects: [] };
    if (state.phase === "normal") return { state: INITIAL_APPROACH, effects: [] };
    // Any outside change gives the camera back. A reroute that answers a miss restores fast.
    const fast = state.phase === "missed" || event.type === "panned";
    return toNormal(state, [], fast ? RESTORE_FAST_MS : RESTORE_MS);
  }

  const { nowMs, steps } = event;

  // The close-up never lasts more than 20 s: the camera goes back, the following carries on.
  if (state.zoomed && state.zoomedAtMs !== null && nowMs - state.zoomedAtMs >= ZOOM_MAX_MS) {
    const out = reduceApproach({ ...state, zoomed: false, zoomedAtMs: null }, event);
    return { state: out.state, effects: [{ kind: "restore", durationMs: RESTORE_MS }, ...out.effects.filter((e) => e.kind !== "restore")] };
  }

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

  // Progress past the split, along the route (from the matcher, so it can't jump across a bend).
  const pastSplit = Math.max(0, -metersToSplit(event, index));

  // Missed: well off the road the route takes, for 3 s and at least 3 fixes in a row. Fixes the
  // GPS itself isn't sure of (accuracy worse than 30 m) neither count nor reset it.
  let offRouteSinceMs = state.offRouteSinceMs;
  let offRouteFixes = state.offRouteFixes;
  if (event.offRouteMeters !== null) {
    if (event.offRouteMeters > MISSED_OFF_ROUTE_METERS) {
      offRouteSinceMs ??= nowMs;
      offRouteFixes += 1;
      if (nowMs - offRouteSinceMs >= MISSED_HOLD_MS && offRouteFixes >= MISSED_MIN_FIXES) {
        // Which manoeuvre was missed: where the car left the route (progress stops there). A
        // run of short steps can be driven through on the route and left at a later split.
        const missedIndex = manoeuvreLeftAt(steps, index, event.alongMeters, event.stepEndsAlong);
        return {
          state: { ...INITIAL_APPROACH, phase: "missed", stepIndex: missedIndex, enteredAtMs: nowMs, resolvedUpTo: state.resolvedUpTo },
          effects: [...restoreIf(state.zoomed, RESTORE_FAST_MS), { kind: "missed", stepIndex: missedIndex }],
        };
      }
    } else {
      offRouteSinceMs = null;
      offRouteFixes = 0;
    }
  }

  // Taken: past the split, on the road after it and clearly not on the road carrying straight
  // on -- held for 3 s or 50 m of progress (one fix never decides it).
  const toNext = distanceToLineMeters(event.position, roadAfterSplit(steps, index));
  const toStraightOn = distanceToLineMeters(event.position, continuationOf(step.polyline));
  // Untrusted fixes (poor accuracy, dead reckoning in a tunnel) neither add evidence nor take it
  // away: nothing is decided on a guess.
  const trusted = event.offRouteMeters !== null;
  const onRoad = trusted && event.offRouteMeters! <= ON_ROAD_METERS;
  // On the road after the split and clearly apart from the straight-on road...
  const separated =
    onRoad && pastSplit >= PAST_SPLIT_METERS && toNext <= ON_ROAD_METERS && toNext + SEPARATION_MARGIN_METERS < toStraightOn;
  // ...or far enough past it that any other road would have parted, still tightly on the route.
  const unambiguous = onRoad && pastSplit >= UNAMBIGUOUS_PAST_METERS && toNext <= TIGHT_ON_ROAD_METERS;
  let onNextSinceMs = state.onNextSinceMs;
  let evidenceAlong = state.evidenceAlong;
  let evidenceMisses = state.evidenceMisses;
  if (separated || unambiguous) {
    onNextSinceMs ??= nowMs;
    evidenceAlong ??= event.alongMeters;
    evidenceMisses = 0;
    if (nowMs - onNextSinceMs >= CONFIRM_HOLD_MS || event.alongMeters - evidenceAlong >= CONFIRM_DISTANCE_METERS) {
      return confirmTaken(state, event, index);
    }
  } else if (trusted && onNextSinceMs !== null && ++evidenceMisses >= 2) {
    onNextSinceMs = null;
    evidenceAlong = null;
    evidenceMisses = 0;
  }

  return { state: { ...state, onNextSinceMs, offRouteSinceMs, offRouteFixes, evidenceAlong, evidenceMisses }, effects: [] };
}

/**
 * The manoeuvre the car left the route at, given its progress along the route when it left:
 * `index` itself, or a later tracked one whose split it had already driven through.
 */
export function manoeuvreLeftAt(steps: RouteStep[], index: number, alongMeters: number, stepEndsAlong: number[]): number {
  let missed = index;
  for (let k = nextManoeuvre(steps, index); k !== null && (stepEndsAlong[k] ?? Infinity) + PAST_SPLIT_METERS <= alongMeters; k = nextManoeuvre(steps, k)) {
    missed = k;
  }
  return missed;
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
