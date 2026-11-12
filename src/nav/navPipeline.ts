// One GPS fix through the whole navigation pipeline, in the same order MapScreen runs it:
//   route matcher (progress along the route, heading-aware) -> guidance (active step, what to
//   say) -> approach machine (zoom, taken / missed).
// Pure: the tests drive real recorded routes through exactly this (__tests__/nav/*), and
// MapScreen calls the same three functions with the same inputs.

import type { Route } from "@/services/directions";
import { createGuidanceState, evaluateGuidance, type GuidanceAnnouncement, type GuidanceState } from "@/services/navigationGuidance";
import {
  buildRouteGeometry,
  createMatchState,
  deadReckon,
  matchFix,
  type MatchFix,
  type MatchResult,
  type MatchState,
  type RouteGeometry,
} from "@/nav/routeMatcher";
import { INITIAL_APPROACH, reduceApproach, type ApproachEffect, type ApproachState } from "@/nav/approach";

export interface NavPipeline {
  geo: RouteGeometry;
  match: MatchState;
  guidance: GuidanceState;
  approach: ApproachState;
}

export function createNavPipeline(route: Route): NavPipeline {
  return {
    geo: buildRouteGeometry(route.steps, route.polyline),
    match: createMatchState(),
    guidance: createGuidanceState(),
    approach: INITIAL_APPROACH,
  };
}

export interface NavTick {
  match: MatchResult;
  activeStepIndex: number;
  announcement: GuidanceAnnouncement | null;
  arrived: boolean;
  effects: ApproachEffect[];
}

/** The approach machine's tick for a match (exported so MapScreen builds it the same way). */
export function approachTick(route: Route, geo: RouteGeometry, m: MatchResult, activeStepIndex: number, nowMs: number, speedKmh: number | null, position: { latitude: number; longitude: number }) {
  return {
    type: "tick" as const,
    nowMs,
    position,
    speedKmh,
    activeStepIndex,
    steps: route.steps,
    alongMeters: m.along,
    stepEndsAlong: geo.stepEnds,
    offRouteMeters: m.offRouteMeters,
  };
}

function run(p: NavPipeline, route: Route, m: MatchResult, nowMs: number, speedKmh: number | null, position: { latitude: number; longitude: number }, earlyThresholds: number[]): NavTick {
  const g = evaluateGuidance(p.guidance, route.steps, position.latitude, position.longitude, earlyThresholds, m);
  const effects: ApproachEffect[] = [];
  const a = reduceApproach(p.approach, approachTick(route, p.geo, m, g.activeStepIndex, nowMs, speedKmh, position));
  p.approach = a.state;
  effects.push(...a.effects);
  if (g.arrived) {
    const done = reduceApproach(p.approach, { type: "arrived", steps: route.steps });
    p.approach = done.state;
    effects.push(...done.effects);
  }
  return { match: m, activeStepIndex: g.activeStepIndex, announcement: g.announcement, arrived: g.arrived, effects };
}

/** A real GPS fix. Mutates the pipeline (it's per-drive state). */
export function navFix(p: NavPipeline, route: Route, fix: MatchFix, earlyThresholds: number[] = []): NavTick {
  const { state, result } = matchFix(p.geo, p.match, fix);
  p.match = state;
  const kmh = state.speedMps * 3.6;
  return run(p, route, result, fix.timeMs, kmh, { latitude: fix.latitude, longitude: fix.longitude }, earlyThresholds);
}

/** No fix this second (a tunnel): dead-reckon along the route. Null when a fix is fresh. */
export function navNoFix(p: NavPipeline, route: Route, nowMs: number): NavTick | null {
  const dr = deadReckon(p.geo, p.match, nowMs);
  if (!dr) return null;
  p.match = dr.state;
  return run(p, route, dr.result, nowMs, dr.state.speedMps * 3.6, dr.result.snapped, []);
}
