// Real popularity for the badges (firebase/functions/poiPopularity.js): Google Places rating
// count and business status, and anonymous opted-in arrival counts. Cached for the session so
// each place is asked about once; the server caches for 30 days.
import type { Popularity } from "@/map/poiRanking";

const cache = new Map<string, Popularity | null>();
const inFlight = new Set<string>();

async function call<T>(name: string, data: unknown): Promise<T> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { httpsCallable } = require("@firebase/functions") as typeof import("@firebase/functions");
  const { functions } = require("@/services/firebase") as typeof import("@/services/firebase");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return (await httpsCallable(functions, name)(data)).data as T;
}

export function cachedPopularity(): Record<string, Popularity> {
  const out: Record<string, Popularity> = {};
  cache.forEach((v, k) => {
    if (v) out[k] = v;
  });
  return out;
}

/** Ask for the places not asked about yet. Resolves true when anything new came back. */
export async function loadPopularity(places: { key: string; name: string; lat: number; lng: number }[]): Promise<boolean> {
  const missing = places.filter((p) => !cache.has(p.key) && !inFlight.has(p.key)).slice(0, 40);
  if (missing.length === 0) return false;
  missing.forEach((p) => inFlight.add(p.key));
  try {
    const r = await call<{ popularity: Record<string, Popularity> }>("poiPopularity", { places: missing });
    missing.forEach((p) => cache.set(p.key, r.popularity[p.key] ?? null));
    return Object.keys(r.popularity).length > 0;
  } catch {
    // Not deployed yet / offline: rank on what the map itself knows.
    missing.forEach((p) => cache.set(p.key, null));
    return false;
  } finally {
    missing.forEach((p) => inFlight.delete(p.key));
  }
}

/** Settings > Privacy > "Share arrivals": an anonymous +1 for the place you arrived at. */
export async function recordArrival(place: { key: string; name: string; lat: number; lng: number }): Promise<void> {
  await call("recordArrival", { place }).catch(() => {});
}

/** For tests. */
export function resetPopularityCache(): void {
  cache.clear();
  inFlight.clear();
}
