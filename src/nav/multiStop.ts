// Gap item 13: trips with several stops. An ordered list (up to MAX_STOPS); the route goes
// through every stop not yet reached, then the destination. While driving: each stop's distance
// and arrival time from the live pace (the same way "On your route" times its rows), "Arriving at
// stop 1, Coles" said once ARRIVING_M before it, and the stop counts as reached within REACHED_M
// -- after that it's left out of reroutes, so a new route never sends you back to it.
// Reorder and remove are in the trip sheet (and before starting, in the route picker).
// Pure; tested in __tests__/gap/multiStop.test.ts.
import { projectOnPolyline } from "@/alerts/approachAlerts";

export const MAX_STOPS = 5;
export const ARRIVING_M = 300;
export const REACHED_M = 40;

type LatLng = { latitude: number; longitude: number };

export interface TripStop {
  id: string;
  name: string;
  location: LatLng;
  reached?: boolean;
  announced?: boolean;
}

export function addStop(stops: readonly TripStop[], place: { placeId: string; name: string; location: LatLng }): TripStop[] {
  if (stops.filter((s) => !s.reached).length >= MAX_STOPS) return [...stops];
  return [...stops, { id: `${place.placeId}:${stops.length}`, name: place.name || "Stop", location: place.location }];
}

export function removeStop(stops: readonly TripStop[], id: string): TripStop[] {
  return stops.filter((s) => s.id !== id);
}

/** Moves a stop one place earlier (-1) or later (+1) among the stops still to come. */
export function moveStop(stops: readonly TripStop[], id: string, dir: -1 | 1): TripStop[] {
  const reached = stops.filter((s) => s.reached);
  const ahead = stops.filter((s) => !s.reached);
  const i = ahead.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ahead.length) return [...stops];
  const next = ahead.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return [...reached, ...next];
}

/** The points a route request goes through: the stops not yet reached, in order. */
export function stopPoints(stops: readonly TripStop[]): LatLng[] {
  return stops.filter((s) => !s.reached).map((s) => s.location);
}

export interface StopRow {
  id: string;
  /** "Stop 1" counts only the stops still to come. */
  number: number;
  name: string;
  aheadM: number;
  etaSeconds: number | null;
  first: boolean;
  last: boolean;
}

/** Each stop still to come along the route, in route order, with its distance and time from the car. */
export function stopRows(stops: readonly TripStop[], polyline: readonly LatLng[], carAlongM: number, paceSecPerM: number | null): StopRow[] {
  const ahead = stops.filter((s) => !s.reached);
  return ahead.map((s, i) => {
    const proj = polyline.length >= 2 ? projectOnPolyline(polyline as LatLng[], s.location) : null;
    const aheadM = proj ? Math.max(0, proj.alongM - carAlongM) : 0;
    return { id: s.id, number: i + 1, name: s.name, aheadM, etaSeconds: paceSecPerM != null ? Math.round(aheadM * paceSecPerM) : null, first: i === 0, last: i === ahead.length - 1 };
  });
}

export type StopEvent = { kind: "arriving"; id: string; number: number; name: string } | { kind: "reached"; id: string };

/** What to do on this fix for the next stop: say it's coming, or mark it reached. */
export function nextStopEvent(stops: readonly TripStop[], rows: readonly StopRow[]): StopEvent | null {
  const row = rows[0];
  if (!row) return null;
  const stop = stops.find((s) => s.id === row.id);
  if (!stop) return null;
  if (row.aheadM <= REACHED_M) return { kind: "reached", id: stop.id };
  if (row.aheadM <= ARRIVING_M && !stop.announced) return { kind: "arriving", id: stop.id, number: row.number, name: stop.name };
  return null;
}

export function markStop(stops: readonly TripStop[], id: string, patch: Pick<TripStop, "reached"> | Pick<TripStop, "announced">): TripStop[] {
  return stops.map((s) => (s.id === id ? { ...s, ...patch } : s));
}
