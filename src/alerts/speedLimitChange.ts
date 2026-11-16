// Settings > Reports > Speed limit changes: one spoken limit when the posted limit on the road
// changes while driving. A new limit has to hold for CONFIRM_MS first, so a fix that briefly
// matches a side street at an intersection doesn't announce anything. The first limit after
// starting is never announced (it isn't a change), and nothing is said below MIN_SPEED_KMH.
export const CONFIRM_MS = 3000;
export const MIN_SPEED_KMH = 15;

export interface LimitChangeState {
  /** The limit the driver was last told about (or started on). */
  confirmed: number | null;
  candidate: number | null;
  candidateSinceMs: number;
}

export const INITIAL_LIMIT_CHANGE: LimitChangeState = { confirmed: null, candidate: null, candidateSinceMs: 0 };

export function stepLimitChange(state: LimitChangeState, limitKmh: number | null, nowMs: number, speedKmh: number | null): { state: LimitChangeState; announce: number | null } {
  if (limitKmh == null) return { state: { ...state, candidate: null }, announce: null };
  if (state.confirmed == null) return { state: { confirmed: limitKmh, candidate: null, candidateSinceMs: nowMs }, announce: null };
  if (limitKmh === state.confirmed) return { state: { ...state, candidate: null }, announce: null };
  if (limitKmh !== state.candidate) return { state: { ...state, candidate: limitKmh, candidateSinceMs: nowMs }, announce: null };
  if (nowMs - state.candidateSinceMs < CONFIRM_MS) return { state, announce: null };
  const next: LimitChangeState = { confirmed: limitKmh, candidate: null, candidateSinceMs: nowMs };
  return { state: next, announce: (speedKmh ?? 0) >= MIN_SPEED_KMH ? limitKmh : null };
}
