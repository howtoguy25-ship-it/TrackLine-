// Drive time from you to every place in a list in ONE request (Google Routes "route matrix"),
// with live traffic. A place Google can't route to gets no time, never an estimate.
import { env } from "@/config/env";
import { netFetch } from "@/services/netFetch";
import type { LatLng } from "@/utils/polyline";

export const MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
/** Google's limit for one origin with traffic-aware routing. */
export const MAX_DESTINATIONS = 25;

/** Parse the matrix answer (a JSON array of elements) into seconds per destination index. */
export function parseMatrix(json: unknown, count: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: count }, () => null);
  if (!Array.isArray(json)) return out;
  for (const el of json) {
    const i = (el as { destinationIndex?: number })?.destinationIndex;
    const d = (el as { duration?: string })?.duration;
    const cond = (el as { condition?: string })?.condition;
    if (typeof i !== "number" || i < 0 || i >= count) continue;
    if (cond && cond !== "ROUTE_EXISTS") continue;
    const secs = typeof d === "string" ? parseInt(d, 10) : NaN;
    if (Number.isFinite(secs)) out[i] = secs;
  }
  return out;
}

export async function driveTimesTo(origin: LatLng, destinations: LatLng[]): Promise<(number | null)[]> {
  const dests = destinations.slice(0, MAX_DESTINATIONS);
  if (dests.length === 0) return [];
  const wp = (p: LatLng) => ({ waypoint: { location: { latLng: { latitude: p.latitude, longitude: p.longitude } } } });
  const res = await netFetch("routes", MATRIX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.googleDirectionsApiKey,
      "X-Goog-FieldMask": "originIndex,destinationIndex,duration,condition",
    },
    body: JSON.stringify({ origins: [wp(origin)], destinations: dests.map(wp), travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE" }),
  });
  if (!res.ok) throw new Error(`Drive times: HTTP ${res.status}`);
  const times = parseMatrix(await res.json(), dests.length);
  return [...times, ...Array.from({ length: destinations.length - dests.length }, () => null)];
}
