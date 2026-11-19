// Every size in the UI spec is given in points for a 390pt-wide iPhone. `scaleFor(width)`
// returns the factor to multiply those by on any other screen, clamped so a small phone
// doesn't get cramped controls and a tablet doesn't get comically large ones.
export const DESIGN_WIDTH = 390;
export function scaleFor(screenWidth: number): number {
  if (!Number.isFinite(screenWidth) || screenWidth <= 0) return 1;
  return Math.min(1.25, Math.max(0.85, screenWidth / DESIGN_WIDTH));
}
