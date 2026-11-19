// 30 minutes without a click, key press or scroll signs the dashboard out.
export const IDLE_LIMIT_MS = 30 * 60 * 1000;

export function isIdleExpired(lastActivityMs: number, nowMs: number, limitMs = IDLE_LIMIT_MS): boolean {
  return nowMs - lastActivityMs >= limitMs;
}

/** Minutes left, for the "signing out in N min" hint. */
export function minutesLeft(lastActivityMs: number, nowMs: number, limitMs = IDLE_LIMIT_MS): number {
  return Math.max(0, Math.ceil((limitMs - (nowMs - lastActivityMs)) / 60000));
}
