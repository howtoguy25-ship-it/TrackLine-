// Street and back-lane shortcuts while driving: is there a genuinely different road that gets
// you there sooner than the one you're on, right now, by enough to be worth a tap?
//
// Root causes of "shortcuts almost never show" (all fixed here and in MapScreen):
//  1. It only looked after a jam was found in the next 1 km. A shortcut around a jam 3 km ahead,
//     or around slow streets that never count as a "jam", was never looked for.
//  2. The only alternative it asked for was "avoid highways". In suburbs with no motorway that
//     comes back as the same road, so nothing was ever offered. Google's own alternative routes
//     (where most back-street shortcuts are) were never asked for.
//  3. It compared the alternative with Google's best route NOW, not the road you are actually on.
//     When Google's best route already was the shortcut, the saving came out as 0.
//  4. A fixed 3-minute minimum: a 2-minute saving on a 12-minute drive was never shown.
// Now: every check asks for the live time of YOUR road (forced along it with pass-through
// points), Google's alternatives and the side-streets route, and offers the best one that leaves
// your road and saves at least minSavingFor(remaining). All times are Google's live traffic.
// Pure; tested in __tests__/nav/shortcuts.test.ts.
import { samplePolyline, sharedPathFraction, routeSeconds, type ChoiceRoute, type SpeedInterval } from "@/map/routeChoices";
import { routeAheadOf, metersBetween } from "@/map-v2/geo";
import type { LatLng } from "@/utils/polyline";

/** Pass-through points along the road ahead that pin a request to it. */
export const VIA_POINTS = 6;
/** A route sharing more than this share of your road ahead is the same road, not a shortcut. */
export const SAME_PATH_SHARE = 0.85;
/** The smallest saving worth interrupting for: 10% of what's left, between 1 and 3 minutes. */
export function minSavingFor(remainingSeconds: number): number {
  return Math.min(180, Math.max(60, Math.round(remainingSeconds * 0.1)));
}

export interface ThroughPoint {
  point: LatLng;
  /** true: just pass through (pins the road). false: a real stop. */
  via: boolean;
}

/**
 * Points along the road still ahead (from `at`), evenly spaced, ends excluded, so a request
 * through them follows the road you're on. A stop on the route stays a real stop, in order.
 */
export function throughPointsAhead(line: LatLng[], at: LatLng | null, stops: LatLng | readonly LatLng[] | null, count = VIA_POINTS): ThroughPoint[] {
  const list: LatLng[] = !stops ? [] : Array.isArray(stops) ? [...stops] : [stops as LatLng];
  const ahead = routeAheadOf(line, at);
  if (ahead.length < 2) return list.map((point) => ({ point, via: false }));
  const samples = samplePolyline(ahead, count + 2).slice(1, -1);
  let out: ThroughPoint[] = samples.map((point) => ({ point, via: true }));
  // Each stop goes where it falls along the road, in the trip's order.
  for (const stop of list) out = withStopAt(out, ahead, stop);
  return out;
}

function withStopAt(out: ThroughPoint[], ahead: LatLng[], stop: LatLng): ThroughPoint[] {
  // Put the stop where it falls along the road: before the first via point further along.
  const along = (p: LatLng) => {
    let best = 0;
    let bestD = Infinity;
    ahead.forEach((q, i) => {
      const d = metersBetween(p, q);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  const stopAt = along(stop);
  const idx = out.findIndex((t) => along(t.point) > stopAt);
  const withStop = out.slice();
  withStop.splice(idx < 0 ? withStop.length : idx, 0, { point: stop, via: false });
  // A via point within 150 m of the stop adds nothing and can make a U-turn.
  return withStop.filter((t) => !t.via || metersBetween(t.point, stop) > 150);
}

export type ShortcutKind = "backLane" | "sideStreets" | "alternative";

export interface ShortcutRoute extends ChoiceRoute {
  summary?: string;
  steps?: { maneuver?: string; targetStreetName?: string; polyline?: LatLng[]; distanceMeters?: number }[];
  viaSideStreets?: boolean;
}

export interface Shortcut<R extends ShortcutRoute> {
  route: R;
  savedSeconds: number;
  kind: ShortcutKind;
  /** The road it leaves yours for ("Smith Ln"), when Google named it. */
  road: string | null;
}

const LANE = /\b(lane|ln|la|laneway|alley|mews)\b\.?$/i;

/** "Smith Lane", "Smith Ln", "Rear Lane": a back lane. */
export function isBackLane(name: string | null | undefined): boolean {
  return !!name && LANE.test(name.trim());
}

/** The named roads of the steps that leave `currentAhead` (first first). */
export function roadsOffYourRoad(route: ShortcutRoute, currentAhead: LatLng[]): string[] {
  const out: string[] = [];
  for (const s of route.steps ?? []) {
    const name = s.targetStreetName?.trim();
    if (!name || !s.polyline || s.polyline.length < 2) continue;
    if (sharedPathFraction(s.polyline, currentAhead) < 0.5 && !out.includes(name)) out.push(name);
  }
  return out;
}

/** What kind of shortcut it is: through a back lane, side streets, or just another road. */
export function shortcutKind(route: ShortcutRoute, offRoads: string[]): ShortcutKind {
  if (offRoads.some(isBackLane)) return "backLane";
  if (route.viaSideStreets) return "sideStreets";
  return "alternative";
}

/**
 * The best shortcut: a candidate that leaves your road (shares under SAME_PATH_SHARE of it),
 * saves at least minSavingFor(currentSeconds) against your road's live time, the biggest saving
 * winning. null when none does (nothing is shown: no guessed "faster" route).
 */
export function pickShortcut<R extends ShortcutRoute>(opts: { currentSeconds: number; currentAhead: LatLng[]; candidates: R[] }): Shortcut<R> | null {
  const { currentSeconds, currentAhead, candidates } = opts;
  if (!(currentSeconds > 0) || currentAhead.length < 2) return null;
  const need = minSavingFor(currentSeconds);
  let best: Shortcut<R> | null = null;
  for (const route of candidates) {
    if (!route?.polyline || route.polyline.length < 2) continue;
    const saved = currentSeconds - routeSeconds(route);
    if (saved < need) continue;
    if (sharedPathFraction(route.polyline, currentAhead) > SAME_PATH_SHARE) continue;
    if (best && saved <= best.savedSeconds) continue;
    const roads = roadsOffYourRoad(route, currentAhead);
    best = { route, savedSeconds: saved, kind: shortcutKind(route, roads), road: roads.find(isBackLane) ?? roads[0] ?? null };
  }
  return best;
}

/** The banner's title and line. */
export function shortcutText(s: { kind: ShortcutKind; road: string | null; savedSeconds: number }, arriveText: string): { title: string; body: string } {
  const mins = Math.max(1, Math.round(s.savedSeconds / 60));
  const title = s.kind === "backLane" ? "Back-lane shortcut" : s.kind === "sideStreets" ? "Side-street shortcut" : "Faster route found";
  const via = s.road ? `via ${s.road}` : s.kind === "sideStreets" ? "via side streets" : "on another road";
  return { title, body: `Save ${mins} min ${via} — arrive ${arriveText}` };
}

/** Whether there's slow or jammed traffic within `withinM` of the start of `line`. */
export function slowTrafficAhead(line: LatLng[], intervals: SpeedInterval[] | undefined, withinM = 1000): boolean {
  if (!intervals?.length || line.length < 2) return false;
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + metersBetween(line[i - 1], line[i]));
  return intervals.some((iv) => (iv.speed === "SLOW" || iv.speed === "TRAFFIC_JAM") && (cum[Math.max(0, Math.min(iv.startIndex, cum.length - 1))] ?? Infinity) <= withinM);
}

/**
 * For the route preview: add the side-streets route when it is a genuinely different road and
 * better than the slowest alternative already listed (or there's room). Never replaces the first.
 */
export function withSideStreets<R extends ChoiceRoute>(choices: R[], side: R | null, max = 3): R[] {
  if (!side || choices.length === 0) return side && choices.length === 0 ? [side] : choices;
  const distinct = choices.every(
    (c) =>
      !(Math.abs(c.distanceMeters - side.distanceMeters) < 20 && Math.abs(routeSeconds(c) - routeSeconds(side)) < 15) &&
      sharedPathFraction(side.polyline, c.polyline) <= SAME_PATH_SHARE
  );
  if (!distinct) return choices;
  if (choices.length < max) return [...choices, side];
  let slowest = 1;
  for (let i = 2; i < choices.length; i++) if (routeSeconds(choices[i]) > routeSeconds(choices[slowest])) slowest = i;
  if (routeSeconds(side) >= routeSeconds(choices[slowest])) return choices;
  const out = choices.slice();
  out[slowest] = side;
  return out;
}
