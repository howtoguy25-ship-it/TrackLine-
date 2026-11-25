// The Routes button while driving: other ways to the destination from here, drawn on the map with
// how much longer or shorter each is than the route being driven ("+2 min"). Pure, tested in
// __tests__/nav/navControls.test.tsx.
import { sharedPathFraction } from "@/map/routeChoices";
import type { LatLng } from "@/utils/polyline";

/** An alternative this similar to the current route isn't really a different way. */
export const SAME_ROUTE_SHARE = 0.9;
export const MAX_ALTERNATIVES = 2;

export function altDeltaLabel(altSeconds: number, currentSeconds: number): string {
  const d = Math.round((altSeconds - currentSeconds) / 60);
  if (d === 0) return "Same time";
  return d > 0 ? `+${d} min` : `−${-d} min`;
}

export function pickAlternatives<T extends { polyline: LatLng[] }>(candidates: T[], current: LatLng[]): T[] {
  return candidates.filter((c) => sharedPathFraction(c.polyline, current) < SAME_ROUTE_SHARE).slice(0, MAX_ALTERNATIVES);
}
