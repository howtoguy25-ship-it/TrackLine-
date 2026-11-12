// The approach view around a manoeuvre, as a small state machine:
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
import { approachTriggerMeters, confirmationText, shouldZoomFor, type ManoeuvreKind } from "@/nav/manoeuvre";

export type ApproachPhase = "normal" | "approach" | "confirm" | "missed";

export interface ApproachState {
  phase: ApproachPhase;
  /** The step whose manoeuvre is being approached (it ends at the manoeuvre point). */
  stepIndex: number | null;
  enteredAtMs: number;
  onNextSinceMs: number | null;
  offRouteSinceMs: number | null;
  confirmUntilMs: number | null;
}

export const INITIAL_APPROACH: ApproachState = {
  phase: "normal",
  stepIndex: null,
  enteredAtMs: 0,
  onNextSinceMs: null,
  offRouteSinceMs: null,
  confirmUntilMs: null,
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
/** Past the split by this much before "on the next road" can mean anything. */
export const PAST_SPLIT_METERS = 15;
export const CONFIRM_HOLD_MS = 3000;
export const CONFIRM_DISTANCE_METERS = 50;
export const MISSED_OFF_ROUTE_METERS = 30;
export const MISSED_HOLD_MS = 3000;
export const CHIP_MS = 2000;
/** If nothing resolves (GPS lost in a tunnel...), give the camera back anyway. */
export const APPROACH_GIVE_UP_MS = 45_000;

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
  | { kind: "confirmed"; text: string }
  | { kind: "missed" };

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

function toNormal(effects: ApproachEffect[], durationMs: number): { state: ApproachState; effects: ApproachEffect[] } {
  return { state: INITIAL_APPROACH, effects: [...effects, { kind: "restore", durationMs }] };
}

export function reduceApproach(state: ApproachState, event: ApproachEvent): { state: ApproachState; effects: ApproachEffect[] } {
  if (event.type !== "tick") {
    if (state.phase === "normal") return { state, effects: [] };
    // Any outside change gives the camera back. A reroute that answers a miss restores fast.
    const fast = state.phase === "missed" || event.type === "panned";
    return toNormal([], fast ? RESTORE_FAST_MS : RESTORE_MS);
  }

  const { nowMs, steps, activeStepIndex } = event;

  if (state.phase === "normal") {
    const step = steps[activeStepIndex];
    const next = steps[activeStepIndex + 1];
    if (!step || !next) return { state, effects: [] };
    if (!shouldZoomFor(kindOfStep(step))) return { state, effects: [] };
    if (event.metersToManoeuvre < 0 || event.metersToManoeuvre > approachTriggerMeters(event.speedKmh)) {
      return { state, effects: [] };
    }
    return {
      state: { ...INITIAL_APPROACH, phase: "approach", stepIndex: activeStepIndex, enteredAtMs: nowMs },
      effects: [
        {
          kind: "zoomIn",
          stepIndex: activeStepIndex,
          center: approachCenter(event.position, step.endLocation),
          heading: bearingBetween(event.position, step.endLocation),
        },
      ],
    };
  }

  if (state.phase === "confirm") {
    if (state.confirmUntilMs !== null && nowMs >= state.confirmUntilMs) return toNormal([], RESTORE_MS);
    return { state, effects: [] };
  }

  if (state.phase === "missed") {
    // Waiting for the reroute; MapScreen sends "rerouted" / "rerouteFailed".
    if (nowMs - state.enteredAtMs > APPROACH_GIVE_UP_MS) return toNormal([], RESTORE_FAST_MS);
    return { state, effects: [] };
  }

  // phase === "approach"
  const index = state.stepIndex ?? activeStepIndex;
  const step = steps[index];
  const next = steps[index + 1];
  if (!step || !next || nowMs - state.enteredAtMs > APPROACH_GIVE_UP_MS) return toNormal([], RESTORE_MS);

  // Missed: well off the route for a few seconds.
  let offRouteSinceMs = state.offRouteSinceMs;
  if (event.offRouteMeters > MISSED_OFF_ROUTE_METERS) {
    offRouteSinceMs ??= nowMs;
    if (nowMs - offRouteSinceMs >= MISSED_HOLD_MS) {
      return {
        state: { ...INITIAL_APPROACH, phase: "missed", stepIndex: index, enteredAtMs: nowMs },
        effects: [{ kind: "restore", durationMs: RESTORE_FAST_MS }, { kind: "missed" }],
      };
    }
  } else {
    offRouteSinceMs = null;
  }

  // Correct: past the split, on the next road and clearly not on the road carrying straight on,
  // for 3 s or 50 m.
  const pastSplit = metersBetween(event.position, step.endLocation);
  const toNext = distanceToLineMeters(event.position, next.polyline);
  const toStraightOn = distanceToLineMeters(event.position, continuationOf(step.polyline));
  const onNext =
    pastSplit >= PAST_SPLIT_METERS && toNext <= ON_ROAD_METERS && toNext + SEPARATION_MARGIN_METERS < toStraightOn;
  let onNextSinceMs = state.onNextSinceMs;
  if (onNext) {
    onNextSinceMs ??= nowMs;
    if (nowMs - onNextSinceMs >= CONFIRM_HOLD_MS || pastSplit >= CONFIRM_DISTANCE_METERS) {
      return {
        state: { ...INITIAL_APPROACH, phase: "confirm", stepIndex: index, enteredAtMs: nowMs, confirmUntilMs: nowMs + CHIP_MS },
        effects: [{ kind: "confirmed", text: confirmationText(kindOfStep(step)) }],
      };
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
