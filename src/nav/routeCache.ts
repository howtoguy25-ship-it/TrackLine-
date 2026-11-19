// Starting a drive without internet. Every route set fetched (and every route a drive actually
// starts on) is kept on the phone. With no connection, the route screen offers the saved route to
// the same place, if it was planned from near where you are now: real directions from Google /
// Mapbox, just not live traffic, and the screen says so. Navigation itself already runs on the
// phone (GPS matching, turn-by-turn, voice), so once started it carries on offline.
// The matching rules are pure and tested (__tests__/nav/routeCache.test.ts).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Route } from "@/services/directions";
import type { LatLng } from "@/utils/polyline";
import { distanceKm } from "@/utils/geo";

const KEY = "trackline.routeCache.v1";
export const MAX_ENTRIES = 12;
/** A saved route counts as "to the same place" within this distance of its end. */
export const SAME_DESTINATION_M = 200;
/** ...and as usable from here when you're within this distance of where it was planned from. */
export const NEAR_START_M = 600;
/** Saved routes older than this are dropped (roads and closures change). */
export const MAX_AGE_MS = 30 * 24 * 3_600_000;

export interface CachedRouteSet {
  savedAt: number;
  origin: LatLng;
  destination: LatLng;
  destinationName: string;
  routes: Route[];
}

const meters = (a: LatLng, b: LatLng) => distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;

/** Add a route set, newest first, replacing an older one for the same trip. */
export function addEntry(list: CachedRouteSet[], entry: CachedRouteSet, nowMs = Date.now()): CachedRouteSet[] {
  const others = list.filter(
    (e) => nowMs - e.savedAt < MAX_AGE_MS && !(meters(e.destination, entry.destination) < SAME_DESTINATION_M && meters(e.origin, entry.origin) < NEAR_START_M)
  );
  return [entry, ...others].slice(0, MAX_ENTRIES);
}

/** The newest saved route set to this destination that was planned from near `here`. */
export function findEntry(list: CachedRouteSet[], here: LatLng, destination: LatLng, nowMs = Date.now()): CachedRouteSet | null {
  for (const e of list) {
    if (nowMs - e.savedAt >= MAX_AGE_MS) continue;
    if (meters(e.destination, destination) >= SAME_DESTINATION_M) continue;
    if (meters(e.origin, here) >= NEAR_START_M) continue;
    if (e.routes.length) return e;
  }
  return null;
}

/** "Saved 3 days ago" / "Saved today at 8:10 am" style age for the offline note. */
export function savedAgo(savedAt: number, nowMs = Date.now()): string {
  const days = Math.floor((nowMs - savedAt) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

async function readAll(): Promise<CachedRouteSet[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Keep a fetched route set (at most the first 3 routes) for offline use. Never throws. */
export async function rememberRoutes(origin: LatLng, destination: LatLng, destinationName: string, routes: Route[]): Promise<void> {
  if (!routes.length) return;
  try {
    const list = await readAll();
    const next = addEntry(list, { savedAt: Date.now(), origin, destination, destinationName, routes: routes.slice(0, 3) });
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable: offline start just won't have this trip.
  }
}

export async function savedRoutesFor(here: LatLng, destination: LatLng): Promise<CachedRouteSet | null> {
  return findEntry(await readAll(), here, destination);
}
