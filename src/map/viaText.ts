// Waze-match §2: "Via Wattle St Punchbowl; Punchbowl Rd Lakemba" -- the route's two main named
// roads (the ones it spends the most distance on), in the order you drive them, each with the
// suburb it's in. Built from the route's own steps; the suburb is the nearest official ABS suburb
// centre within 4 km (Australia only -- elsewhere just the road names). Pure; tested in
// __tests__/wazeMatch/routeSheet.test.tsx.
import { auSuburbs, type AuSuburb } from "@/map-v2/auSuburbs";
import type { RouteStep } from "@/services/directions";

export const VIA_MAX_ROADS = 2;
export const SUBURB_MAX_KM = 4;

type StepLike = Pick<RouteStep, "targetStreetName" | "roadRef" | "distanceMeters" | "startLocation" | "endLocation">;

/** The road a step travels along: Mapbox steps name the road at their END (the next road). */
export function travelledRoads(steps: readonly StepLike[], source: "google" | "mapbox" | undefined): (string | null)[] {
  return steps.map((s, i) => {
    const name = source === "mapbox" ? steps[i - 1]?.targetStreetName : s.targetStreetName;
    return name?.trim() || null;
  });
}

let index: Map<string, AuSuburb[]> | null = null;
const cellKey = (lat: number, lng: number) => `${Math.floor(lat * 10)}:${Math.floor(lng * 10)}`;
function suburbIndex(): Map<string, AuSuburb[]> {
  if (index) return index;
  index = new Map();
  for (const s of auSuburbs()) {
    const k = cellKey(s.latitude, s.longitude);
    const list = index.get(k);
    if (list) list.push(s);
    else index.set(k, [s]);
  }
  return index;
}

/** The nearest suburb centre within 4 km, or null (outside Australia, or nothing near). */
export function suburbNear(lat: number, lng: number): string | null {
  const idx = suburbIndex();
  let best: { name: string; d: number } | null = null;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const s of idx.get(cellKey(lat + dy / 10, lng + dx / 10)) ?? []) {
        const d = Math.hypot((s.latitude - lat) * 111, (s.longitude - lng) * 111 * cosLat);
        if (d <= SUBURB_MAX_KM && (!best || d < best.d)) best = { name: s.name, d };
      }
    }
  }
  return best?.name ?? null;
}

/** "Via Wattle St Punchbowl; Punchbowl Rd Lakemba", or null when the steps name no roads. */
export function viaText(steps: readonly StepLike[], source: "google" | "mapbox" | undefined, suburbAt: (lat: number, lng: number) => string | null = suburbNear): string | null {
  const roads = travelledRoads(steps, source);
  const total = new Map<string, { metres: number; first: number; longest: StepLike }>();
  roads.forEach((road, i) => {
    if (!road) return;
    const s = steps[i];
    const t = total.get(road);
    if (!t) total.set(road, { metres: s.distanceMeters, first: i, longest: s });
    else {
      t.metres += s.distanceMeters;
      if (s.distanceMeters > t.longest.distanceMeters) t.longest = s;
    }
  });
  if (total.size === 0) return null;
  const main = [...total.entries()]
    .sort((a, b) => b[1].metres - a[1].metres)
    .slice(0, VIA_MAX_ROADS)
    .sort((a, b) => a[1].first - b[1].first);
  const parts = main.map(([road, t]) => {
    const mid = { lat: (t.longest.startLocation.latitude + t.longest.endLocation.latitude) / 2, lng: (t.longest.startLocation.longitude + t.longest.endLocation.longitude) / 2 };
    const suburb = suburbAt(mid.lat, mid.lng);
    return suburb ? `${road} ${suburb}` : road;
  });
  return `Via ${parts.join("; ")}`;
}
