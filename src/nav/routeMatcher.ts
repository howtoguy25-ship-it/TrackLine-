// Where on the route the car is: progress in metres along it, matched by distance-along-route
// AND direction of travel, not just "the nearest bit of line". Pure functions, no React, so every
// rule is unit-tested (__tests__/nav/routeMatcher.test.ts, __tests__/nav/robustness.test.ts).
//
// Why: a nearest-point match snaps to the wrong part of the route wherever the route comes back
// near itself -- the U of a car-park exit, a roundabout, a cloverleaf ramp passing under the road
// it left, a service road beside the motorway -- and one bad GPS fix could jump guidance a whole
// step ahead or mark a turn done/missed. Here:
//   - progress only moves forward continuously: a fix may advance it by at most
//     speed x time x 1.5 + 30 m; a bigger jump is held until 3 consistent fixes confirm it;
//   - candidates must point the way the car is going (within 60 deg) when the heading is known;
//   - progress never goes backwards unless the car has really turned round (heading reversed
//     against the route for 5 s+);
//   - when the GPS is poor (accuracy worse than 30 m) the off-route distance is not trusted;
//   - when fixes stop (a tunnel) progress is dead-reckoned at the last speed for up to 30 s.

import type { LatLng } from "@/utils/polyline";
import type { RouteStep } from "@/services/directions";

export interface RouteGeometry {
  points: LatLng[];
  /** Distance along the route at each point. */
  cum: number[];
  /** Bearing of each segment (points[i] -> points[i+1]). */
  bearing: number[];
  /** Distance along the route at the END of each step (its manoeuvre point). */
  stepEnds: number[];
  length: number;
}

export interface MatchFix {
  latitude: number;
  longitude: number;
  timeMs: number;
  /** m/s from the GPS, when it reports one. */
  speedMps?: number | null;
  /** Course over ground, degrees, when the GPS reports one. */
  headingDeg?: number | null;
  /** Horizontal accuracy, metres. */
  accuracyM?: number | null;
}

export type MatchStatus = "matched" | "off" | "jumpHeld" | "lowAccuracy" | "deadReckoning" | "wrongWay" | "noFix";

export interface MatchState {
  /** Best estimate of progress (metres along the route). */
  along: number;
  /** Progress last confirmed by a real, matched fix -- the floor estimates are corrected to. */
  confirmedAlong: number;
  lastFix: MatchFix | null;
  speedMps: number;
  /** A forward jump waiting for confirmation. */
  pending: { along: number; count: number; timeMs: number } | null;
  /** Since when the car has been heading against the route. */
  reverseSinceMs: number | null;
  /** Dead reckoning started at this time (no fixes). */
  deadReckonSinceMs: number | null;
  /** The car's direction of travel at the last fix (null while it's unknown). */
  heading: number | null;
  /** Recent fixes (newest last), for a direction of travel at walking pace in a car park. */
  trail: LatLng[];
}

export interface MatchResult {
  status: MatchStatus;
  along: number;
  /** Distance from the route where it matters; null when it can't be trusted (bad GPS, no fix). */
  offRouteMeters: number | null;
  /** On the route, going its way, with trustworthy GPS. */
  onRoute: boolean;
  stepIndex: number;
  /** Metres along the route to the end of the current step. */
  metersToStepEnd: number;
  /** The matched point on the route. */
  snapped: LatLng;
}

// ---- tuning ----
export const ADVANCE_FACTOR = 1.5;
export const ADVANCE_SLACK_METERS = 30;
/** How far behind current progress a candidate may lie (GPS noise along the road). */
export const BACK_WINDOW_METERS = 25;
export const HEADING_TOLERANCE_DEG = 60;
/** Below this the GPS heading is noise. */
export const HEADING_MIN_SPEED_MPS = 3;
export const JUMP_CONFIRM_FIXES = 3;
/** A held jump's fixes must agree to within this (beyond the distance driven between them). */
export const JUMP_AGREE_METERS = 25;
/** A held-jump candidate must be this close to the route. */
export const JUMP_MAX_OFF_METERS = 15;
export const POOR_ACCURACY_METERS = 30;
export const ON_ROUTE_METERS = 20;
export const DEAD_RECKON_MAX_MS = 30_000;
/** No fix for this long and progress is dead-reckoned. */
export const FIX_STALE_MS = 1500;
export const REVERSE_HOLD_MS = 5000;
/** Heading this far from the route's direction counts as driving against it. */
export const REVERSE_DEG = 120;

// ---- geometry (equirectangular; plenty at these distances) ----

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

function meters(a: LatLng, b: LatLng): number {
  const x = rad(b.longitude - a.longitude) * Math.cos(rad((a.latitude + b.latitude) / 2));
  const y = rad(b.latitude - a.latitude);
  return Math.hypot(x, y) * R;
}

function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Projection of p onto segment ab: distance and fraction along it. */
function projectOnSegment(p: LatLng, a: LatLng, b: LatLng): { d: number; t: number } {
  const k = Math.cos(rad(p.latitude)) * R;
  const ax = rad(a.longitude) * k, ay = rad(a.latitude) * R;
  const bx = rad(b.longitude) * k, by = rad(b.latitude) * R;
  const px = rad(p.longitude) * k, py = rad(p.latitude) * R;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

/** The route as one line made of its steps, with each step's end marked. */
export function buildRouteGeometry(steps: RouteStep[], fallback: LatLng[] = []): RouteGeometry {
  const points: LatLng[] = [];
  const stepEnds: number[] = [];
  const cum: number[] = [];
  let acc = 0;
  const push = (p: LatLng) => {
    if (points.length) {
      const d = meters(points[points.length - 1], p);
      if (d < 0.01) return;
      acc += d;
    }
    points.push(p);
    cum.push(acc);
  };
  for (const s of steps) {
    const line = s.polyline && s.polyline.length >= 2 ? s.polyline : [s.startLocation, s.endLocation];
    for (const p of line) push(p);
    stepEnds.push(acc);
  }
  if (points.length < 2) for (const p of fallback) push(p);
  const bearings = points.slice(0, -1).map((p, i) => bearing(p, points[i + 1]));
  return { points, cum, bearing: bearings, stepEnds, length: acc };
}

/** Index of the step whose stretch of road contains `along`. */
export function stepIndexAt(geo: RouteGeometry, along: number): number {
  for (let i = 0; i < geo.stepEnds.length; i++) if (along < geo.stepEnds[i]) return i;
  return Math.max(0, geo.stepEnds.length - 1);
}

/** The point at `along` on the route. */
export function pointAt(geo: RouteGeometry, along: number): LatLng {
  const { points, cum } = geo;
  if (points.length === 0) return { latitude: 0, longitude: 0 };
  if (along <= 0) return points[0];
  for (let i = 0; i < points.length - 1; i++) {
    if (along <= cum[i + 1]) {
      const seg = cum[i + 1] - cum[i];
      const t = seg > 0 ? (along - cum[i]) / seg : 0;
      return {
        latitude: points[i].latitude + (points[i + 1].latitude - points[i].latitude) * t,
        longitude: points[i].longitude + (points[i + 1].longitude - points[i].longitude) * t,
      };
    }
  }
  return points[points.length - 1];
}

/** Direction of the route at `along`. */
export function routeBearingAt(geo: RouteGeometry, along: number): number | null {
  if (geo.bearing.length === 0) return null;
  for (let i = 0; i < geo.points.length - 1; i++) if (along <= geo.cum[i + 1]) return geo.bearing[i];
  return geo.bearing[geo.bearing.length - 1];
}

interface Candidate {
  along: number;
  d: number;
  bearing: number;
  /** The nearest point is really beyond the window's far end (a jump, not progress). */
  beyond: boolean;
}

/**
 * How much an unexpected amount of progress counts against a candidate, per metre. The car moved
 * so far since the last fix; a candidate that would put it 30 m further along the route than
 * that (the far side of a U, the next loop of a ramp) is a poor match even if it's near.
 */
export const PROGRESS_MISMATCH_WEIGHT = 0.5;

/**
 * Progress may only move across road the car's motion agrees with: every stretch of route longer
 * than PATH_CHECK_MIN_METERS in total between the old progress and the new one must point within
 * PATH_HEADING_DEG of where the car was heading at this fix or the last one. (Going straight on
 * past a U-shaped exit can't "arrive" on the far leg of the U: the car never drove the bend.)
 * Skipped after a gap in fixes, when the car could genuinely have driven a bend unseen.
 */
export const PATH_CHECK_MIN_METERS = 8;
export const PATH_HEADING_DEG = 60;
/** Below GPS-course speeds, direction comes from where the car has moved over this distance. */
export const TRAIL_HEADING_METERS = 8;
export const TRAIL_LENGTH = 12;
export const PATH_CHECK_MAX_GAP_S = 3;

function pathConsistent(geo: RouteGeometry, from: number, to: number, headings: number[]): boolean {
  if (headings.length === 0 || to <= from) return true;
  let against = 0; // metres of road pointing somewhere the car wasn't going
  for (let i = 0; i < geo.points.length - 1; i++) {
    const a = Math.max(from, geo.cum[i]);
    const b = Math.min(to, geo.cum[i + 1]);
    if (b <= a) continue;
    if (!headings.some((h) => angleDiff(h, geo.bearing[i]) <= PATH_HEADING_DEG)) against += b - a;
    if (against > PATH_CHECK_MIN_METERS) return false;
  }
  return true;
}

/**
 * Best match on the route between `from` and `to` metres along it. `any` is simply the nearest
 * point; `aligned` points the car's way and, when `expectAlong` is given, best agrees with how far
 * the car has actually moved (distance + weight x progress mismatch).
 */
function bestBetween(
  geo: RouteGeometry,
  p: LatLng,
  from: number,
  to: number,
  heading: number | null,
  expectAlong: number | null = null,
  allowed: (along: number) => boolean = () => true
): { any: Candidate | null; aligned: Candidate | null } {
  let any: Candidate | null = null;
  let aligned: Candidate | null = null;
  let alignedCost = Infinity;
  for (let i = 0; i < geo.points.length - 1; i++) {
    if (geo.cum[i + 1] < from || geo.cum[i] > to) continue;
    const { d, t } = projectOnSegment(p, geo.points[i], geo.points[i + 1]);
    const a = geo.cum[i] + t * (geo.cum[i + 1] - geo.cum[i]);
    const along = Math.max(from, Math.min(to, a));
    const c = { along, d, bearing: geo.bearing[i], beyond: a > to + 1 };
    if (!any || d < any.d) any = c;
    if ((heading === null || angleDiff(heading, geo.bearing[i]) <= HEADING_TOLERANCE_DEG) && allowed(along)) {
      const cost = d + (expectAlong === null ? 0 : PROGRESS_MISMATCH_WEIGHT * Math.abs(along - expectAlong));
      if (cost < alignedCost) {
        aligned = c;
        alignedCost = cost;
      }
    }
  }
  return { any, aligned };
}

export function createMatchState(): MatchState {
  return { along: 0, confirmedAlong: 0, lastFix: null, speedMps: 0, pending: null, reverseSinceMs: null, deadReckonSinceMs: null, heading: null, trail: [] };
}

function result(geo: RouteGeometry, along: number, status: MatchStatus, offRouteMeters: number | null): MatchResult {
  const stepIndex = stepIndexAt(geo, along);
  const end = geo.stepEnds[stepIndex] ?? geo.length;
  return {
    status,
    along,
    offRouteMeters,
    onRoute: status === "matched" && offRouteMeters !== null && offRouteMeters <= ON_ROUTE_METERS,
    stepIndex,
    metersToStepEnd: Math.max(0, end - along),
    snapped: pointAt(geo, along),
  };
}

/** Matches one GPS fix. Returns the new state (the old one is not changed). */
export function matchFix(geo: RouteGeometry, prev: MatchState, fix: MatchFix): { state: MatchState; result: MatchResult } {
  const p = { latitude: fix.latitude, longitude: fix.longitude };
  const last = prev.lastFix;
  const dt = last ? Math.max(0.2, (fix.timeMs - last.timeMs) / 1000) : 1;
  const moved = last ? meters(last, p) : 0;
  const speed =
    fix.speedMps != null && fix.speedMps >= 0 ? fix.speedMps : last ? Math.min(moved / dt, 70) : prev.speedMps;
  let heading: number | null = null;
  if (fix.headingDeg != null && fix.headingDeg >= 0 && speed >= HEADING_MIN_SPEED_MPS) heading = fix.headingDeg;
  else if (last && moved >= 5 && speed >= HEADING_MIN_SPEED_MPS) heading = bearing(last, p);
  else {
    // Slow (a car park, a queue): the GPS course is noise, but where the car has got to over the
    // last several metres is not.
    // The baseline has to be well beyond the GPS error, or the "direction" is just the noise.
    const baseline = Math.max(TRAIL_HEADING_METERS, 2 * (fix.accuracyM ?? 5));
    for (let i = prev.trail.length - 1; i >= 0; i--) {
      if (meters(prev.trail[i], p) >= baseline) {
        heading = bearing(prev.trail[i], p);
        break;
      }
    }
  }
  const trail = [...prev.trail, p].slice(-TRAIL_LENGTH);
  const poor = fix.accuracyM != null && fix.accuracyM > POOR_ACCURACY_METERS;

  // The first fix: anywhere on the route that points the right way, preferring the start.
  if (!last) {
    const { any, aligned } = bestBetween(geo, p, 0, geo.length, heading);
    const c = aligned ?? any;
    const along = c ? c.along : 0;
    const state: MatchState = { ...prev, along, confirmedAlong: along, lastFix: fix, speedMps: speed, deadReckonSinceMs: null, heading, trail };
    return { state, result: result(geo, along, c && c.d <= ON_ROUTE_METERS ? "matched" : "off", poor || !c ? null : c.d) };
  }

  // Where the car may be now: from a little behind the last confirmed progress (noise along the
  // road) up to as far as it could have driven. After dead reckoning the estimate may be ahead
  // of the truth, so the window opens from the last CONFIRMED progress.
  const base = prev.deadReckonSinceMs !== null ? prev.confirmedAlong : prev.along;
  const reach = Math.max(speed, prev.speedMps) * dt * ADVANCE_FACTOR + ADVANCE_SLACK_METERS;
  const ahead = prev.deadReckonSinceMs !== null ? Math.max(prev.along - prev.confirmedAlong, 0) + reach : reach;
  const from = Math.max(0, base - BACK_WINDOW_METERS);
  const to = Math.min(geo.length, base + ahead);
  // Where it should be if it stayed on the road: as far along as it actually moved.
  const expectAlong = prev.deadReckonSinceMs !== null ? prev.along : base + moved;
  const headings = [heading, prev.heading].filter((h): h is number => h !== null);
  const checkPath = dt <= PATH_CHECK_MAX_GAP_S && prev.deadReckonSinceMs === null;
  const allowed = (along: number) => !checkPath || pathConsistent(geo, base, along, headings);
  const { any, aligned } = bestBetween(geo, p, from, to, heading, expectAlong, allowed);

  // Turned round? Heading against the route right here, held for 5 s.
  const routeDir = routeBearingAt(geo, prev.along);
  // Turning round is only judged from the GPS's own course (reliable once moving), not from the
  // slow-speed trail estimate.
  const course = fix.headingDeg != null && fix.headingDeg >= 0 && speed >= HEADING_MIN_SPEED_MPS ? fix.headingDeg : null;
  const against = course !== null && routeDir !== null && angleDiff(course, routeDir) >= REVERSE_DEG && (any?.d ?? Infinity) <= ON_ROUTE_METERS;
  const reverseSinceMs = against ? prev.reverseSinceMs ?? fix.timeMs : null;
  const wrongWay = reverseSinceMs !== null && fix.timeMs - reverseSinceMs >= REVERSE_HOLD_MS;

  const next: MatchState = { ...prev, lastFix: fix, speedMps: speed, reverseSinceMs, deadReckonSinceMs: null, heading: heading ?? prev.heading, trail };

  if (wrongWay && any) {
    // Really turned round: progress follows the car back along the route.
    next.along = any.along;
    next.confirmedAlong = any.along;
    next.pending = null;
    return { state: next, result: result(geo, next.along, "wrongWay", poor ? null : any.d) };
  }

  if (aligned && !aligned.beyond && aligned.d <= ON_ROUTE_METERS * 2) {
    // Progress moves forward only (noise behind it is ignored).
    // Never backwards: after dead reckoning the estimate may be a little ahead of the fix; it
    // holds until the car catches up (confirmed progress follows the fix).
    const along = Math.max(prev.along, base, aligned.along);
    next.along = along;
    next.confirmedAlong = Math.max(base, aligned.along);
    next.pending = null;
    if (poor) return { state: next, result: result(geo, along, "lowAccuracy", null) };
    return { state: next, result: result(geo, along, aligned.d <= ON_ROUTE_METERS ? "matched" : "off", aligned.d) };
  }

  // Nothing near within reach. A real forward jump (a GPS gap, a missed stretch) shows up as
  // a match further ahead that holds over several fixes; one wild fix doesn't.
  const far = bestBetween(geo, p, to, geo.length, heading).aligned;
  if (far && far.d <= JUMP_MAX_OFF_METERS && !poor) {
    const pend = prev.pending;
    const expected = pend ? pend.along + speed * ((fix.timeMs - pend.timeMs) / 1000) : null;
    const agrees = pend !== null && expected !== null && Math.abs(far.along - expected) <= JUMP_AGREE_METERS + speed * dt * 0.5;
    const count = agrees ? pend!.count + 1 : 1;
    if (count >= JUMP_CONFIRM_FIXES) {
      next.along = far.along;
      next.confirmedAlong = far.along;
      next.pending = null;
      return { state: next, result: result(geo, far.along, "matched", far.d) };
    }
    next.pending = { along: far.along, count, timeMs: fix.timeMs };
    return { state: next, result: result(geo, prev.along, "jumpHeld", null) };
  }

  // Off the route: progress stays where the car left it; distance from the road it should be on.
  next.pending = null;
  next.along = base;
  const off = aligned?.d ?? any?.d ?? null;
  return { state: next, result: result(geo, base, poor ? "lowAccuracy" : "off", poor ? null : off) };
}

/**
 * No fix has arrived for a while (a tunnel): carry progress on at the last speed, for up to 30 s,
 * then hold it until fixes return. Off-route is unknown meanwhile.
 */
export function deadReckon(geo: RouteGeometry, prev: MatchState, nowMs: number): { state: MatchState; result: MatchResult } | null {
  const last = prev.lastFix;
  if (!last || nowMs - last.timeMs < FIX_STALE_MS) return null;
  const since = prev.deadReckonSinceMs ?? last.timeMs;
  const elapsed = Math.min(nowMs - last.timeMs, DEAD_RECKON_MAX_MS) / 1000;
  const along = Math.min(geo.length, prev.confirmedAlong + prev.speedMps * elapsed);
  const state: MatchState = { ...prev, along, deadReckonSinceMs: since };
  const status: MatchStatus = nowMs - last.timeMs > DEAD_RECKON_MAX_MS ? "noFix" : "deadReckoning";
  return { state, result: result(geo, along, status, null) };
}
