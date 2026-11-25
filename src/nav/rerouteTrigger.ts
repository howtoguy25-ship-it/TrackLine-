// When to reroute, from the route matcher's verdicts. Pure; MapScreen runs it on every fix and
// the tests run it on every simulated second (__tests__/support/navDrive.ts).
//
//   - off the road the route takes by more than 35 m, for 3 s or 50 m driven, over at least 3
//     fixes (one bad fix -- a 70 m GPS jump -- is never a reroute);
//   - fixes the phone itself says are poor (accuracy worse than 30 m), and dead-reckoned seconds
//     in a tunnel, neither count nor reset it;
//   - driving against the route for 5 s (the matcher's "wrongWay");
//   - a missed turn/exit from the approach machine (it has already waited out its own evidence);
//   - while a turn/exit is being judged, its own "missed" verdict comes first (up to 6 s);
//   - debounced: after a reroute, off-route reasons wait 15 s; a missed turn waits only 3 s.

import type { LatLng } from "@/utils/polyline";
import type { MatchResult } from "@/nav/routeMatcher";

export type RerouteReason = "distance" | "wrong-way" | "missed-turn";

export interface RerouteTriggerState {
  offSinceMs: number | null;
  offFixes: number;
  offTravelled: number;
  lastPosition: LatLng | null;
  lastRerouteMs: number | null;
}

export const INITIAL_REROUTE_TRIGGER: RerouteTriggerState = {
  offSinceMs: null,
  offFixes: 0,
  offTravelled: 0,
  lastPosition: null,
  lastRerouteMs: null,
};

export const OFF_ROUTE_METERS = 35;
export const OFF_ROUTE_HOLD_MS = 3000;
export const OFF_ROUTE_HOLD_METERS = 50;
export const OFF_ROUTE_MIN_FIXES = 3;
export const REROUTE_COOLDOWN_MS = 15_000;
export const MISSED_REROUTE_GAP_MS = 3000;
/**
 * While the approach machine is judging a turn/exit it names the miss itself (within ~3 s); the
 * plain off-route reroute waits for that verdict, but never longer than this.
 */
export const JUDGING_WAIT_MS = 6000;

function meters(a: LatLng, b: LatLng): number {
  const k = Math.PI / 180;
  const x = (b.longitude - a.longitude) * k * Math.cos(((a.latitude + b.latitude) / 2) * k);
  const y = (b.latitude - a.latitude) * k;
  return Math.hypot(x, y) * 6_371_000;
}

export function rerouteTrigger(
  state: RerouteTriggerState,
  input: { nowMs: number; match: MatchResult; position: LatLng; missedManoeuvre: boolean; judging?: boolean }
): { state: RerouteTriggerState; reason: RerouteReason | null } {
  const { nowMs, match, position } = input;
  const next: RerouteTriggerState = { ...state, lastPosition: position };
  const sinceLast = state.lastRerouteMs === null ? Infinity : nowMs - state.lastRerouteMs;

  if (input.missedManoeuvre && sinceLast >= MISSED_REROUTE_GAP_MS) {
    return { state: { ...INITIAL_REROUTE_TRIGGER, lastRerouteMs: nowMs }, reason: "missed-turn" };
  }

  const off = match.offRouteMeters;
  if (off !== null) {
    if (off > OFF_ROUTE_METERS) {
      next.offSinceMs ??= nowMs;
      next.offFixes += 1;
      if (state.lastPosition && state.offSinceMs !== null) next.offTravelled += meters(state.lastPosition, position);
    } else {
      next.offSinceMs = null;
      next.offFixes = 0;
      next.offTravelled = 0;
    }
  }

  let reason: RerouteReason | null = null;
  if (match.status === "wrongWay") reason = "wrong-way";
  else if (
    next.offSinceMs !== null &&
    next.offFixes >= OFF_ROUTE_MIN_FIXES &&
    (nowMs - next.offSinceMs >= OFF_ROUTE_HOLD_MS || next.offTravelled >= OFF_ROUTE_HOLD_METERS)
  ) {
    reason = "distance";
    if (input.judging && nowMs - next.offSinceMs < JUDGING_WAIT_MS) reason = null;
  }
  if (!reason || sinceLast < REROUTE_COOLDOWN_MS) return { state: next, reason: null };
  return { state: { ...INITIAL_REROUTE_TRIGGER, lastRerouteMs: nowMs }, reason };
}
