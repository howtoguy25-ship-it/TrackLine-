// "Search along route" while driving: places on (or just off) the road still ahead, from Google
// Places (New) Text Search with searchAlongRouteParameters, each with Google's own routing summary
// (you → the place → the end of your route), so the extra time a stop adds ("+3 min") is real,
// not a straight-line guess. Sorted by that detour. Through netFetch: 10 s, one retry, a clear
// error. Pure parts tested in __tests__/nav/searchAlongRoute.test.tsx.
import { env } from "@/config/env";
import { netFetch } from "@/services/netFetch";
import { parsePlace, PlacesNewError, type NearbyResult } from "@/places/nearbyNew";
import type { LatLng } from "@/utils/polyline";

export type AlongCategory = "fuel" | "food" | "coffee" | "parking" | "ev" | "toilets";

export const ALONG_CATEGORIES: { key: AlongCategory; label: string; query: string; type: string }[] = [
  { key: "fuel", label: "Fuel", query: "petrol station", type: "gas_station" },
  { key: "food", label: "Food", query: "restaurant", type: "restaurant" },
  { key: "coffee", label: "Coffee", query: "coffee", type: "cafe" },
  { key: "parking", label: "Parking", query: "parking", type: "parking" },
  { key: "ev", label: "EV", query: "EV charging station", type: "electric_vehicle_charging_station" },
  // Google Places (New) type "public_bathroom" (Table A).
  { key: "toilets", label: "Toilets", query: "public toilet", type: "public_bathroom" },
];

export interface AlongResult extends NearbyResult {
  /** Extra seconds the stop adds to the drive, from Google's routing summary; null if not given. */
  detourSeconds: number | null;
}

/** Google's encoded polyline format (precision 5). */
export function encodePolyline(points: LatLng[]): string {
  let out = "";
  let lastLat = 0;
  let lastLng = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    return s + String.fromCharCode(x + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.latitude * 1e5);
    const lng = Math.round(p.longitude * 1e5);
    out += enc(lat - lastLat) + enc(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

/** Keep at most `max` points (evenly), so a long route's polyline stays a reasonable size. */
export function thinLine(points: LatLng[], max = 300): LatLng[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

const seconds = (d: unknown) => (typeof d === "string" ? parseInt(d, 10) : NaN);

/**
 * Detour = (you → place) + (place → end of route) − the drive you'd do anyway. Google returns
 * the two legs per place in routingSummaries; `remainingSeconds` is the current route's remaining
 * time. Never negative (a place right on the route adds about nothing).
 */
export function detourFrom(summary: any, remainingSeconds: number): number | null {
  const legs = summary?.legs;
  if (!Array.isArray(legs) || legs.length < 2) return null;
  const a = seconds(legs[0]?.duration);
  const b = seconds(legs[1]?.duration);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, a + b - remainingSeconds);
}

export function sortByDetour(results: AlongResult[]): AlongResult[] {
  return results.slice().sort((x, y) => {
    if (x.detourSeconds == null && y.detourSeconds == null) return x.distanceMeters - y.distanceMeters;
    if (x.detourSeconds == null) return 1;
    if (y.detourSeconds == null) return -1;
    return x.detourSeconds - y.detourSeconds || x.distanceMeters - y.distanceMeters;
  });
}

/** "+3 min", or "on your way" for under a minute. */
export function detourText(s: number | null): string | null {
  if (s == null) return null;
  const m = Math.round(s / 60);
  return m < 1 ? "On your way" : `+${m} min`;
}

export async function searchAlongRoute(opts: { query: string; type?: string; route: LatLng[]; origin: LatLng; remainingSeconds: number }): Promise<AlongResult[]> {
  const body: Record<string, unknown> = {
    textQuery: opts.query,
    pageSize: 20,
    searchAlongRouteParameters: { polyline: { encodedPolyline: encodePolyline(thinLine(opts.route)) } },
    routingParameters: { origin: { latitude: opts.origin.latitude, longitude: opts.origin.longitude }, travelMode: "DRIVE" },
  };
  if (opts.type) body.includedType = opts.type;
  const res = await netFetch("places", "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.googlePlacesApiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.addressComponents,places.location,places.rating,places.userRatingCount,places.currentOpeningHours.openNow,routingSummaries",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new PlacesNewError(res.status, json?.error?.message ?? `HTTP ${res.status}`);
  const places: any[] = Array.isArray(json?.places) ? json.places : [];
  const summaries: any[] = Array.isArray(json?.routingSummaries) ? json.routingSummaries : [];
  const out: AlongResult[] = [];
  places.forEach((p, i) => {
    const r = parsePlace(p, opts.origin);
    if (r) out.push({ ...r, detourSeconds: detourFrom(summaries[i], opts.remainingSeconds) });
  });
  return sortByDetour(out);
}
