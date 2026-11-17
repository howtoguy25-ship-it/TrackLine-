// Nearby petrol, food, hotels and parking from Google Places (New): Nearby Search sorted by
// distance, Text Search for a typed name, and the filters / sort the results sheet offers.
// Requests go through netFetch (10 s budget, one retry, status in Diagnostics). The parsing,
// filtering and sorting are pure and tested directly (__tests__/places/nearbyNew.test.ts).
import { env } from "@/config/env";
import { netFetch } from "@/services/netFetch";
import { distanceKm } from "@/utils/geo";
import type { LatLng } from "@/utils/polyline";

export type NearbyCategory = "fuel" | "food" | "hotel" | "parking";

export const CATEGORY_TYPES: Record<NearbyCategory, string[]> = {
  fuel: ["gas_station"],
  food: ["restaurant", "cafe", "fast_food_restaurant", "bakery", "meal_takeaway"],
  hotel: ["lodging"],
  parking: ["parking"],
};

/** The four area chips. Each is a real search radius around you. */
export const AREAS = [
  { key: "near", label: "Near me", radiusM: 2_000 },
  { key: "suburb", label: "My suburb", radiusM: 5_000 },
  { key: "inner", label: "Inner city", radiusM: 12_000 },
  { key: "city", label: "Whole city", radiusM: 40_000 },
] as const;
export type AreaKey = (typeof AREAS)[number]["key"];

export type SortKey = "best" | "distance" | "price";
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "best", label: "Best match" },
  { key: "distance", label: "Distance" },
  { key: "price", label: "Price" },
];

/** Fuel types the selector offers, mapped to Google's fuelOptions names and FuelCheck codes. */
export const FUEL_TYPES = [
  { key: "E10", label: "E10", google: "E10", fuelCheck: "E10" },
  { key: "91", label: "91", google: "REGULAR_UNLEADED", fuelCheck: "U91" },
  { key: "95", label: "95", google: "MIDGRADE", fuelCheck: "P95" },
  { key: "98", label: "98", google: "PREMIUM", fuelCheck: "P98" },
  { key: "diesel", label: "Diesel", google: "DIESEL", fuelCheck: "DL" },
  { key: "lpg", label: "LPG", google: "LPG", fuelCheck: "LPG" },
  { key: "ev", label: "EV", google: null, fuelCheck: null },
] as const;
export type FuelTypeKey = (typeof FUEL_TYPES)[number]["key"];

export interface FuelPrice {
  /** Cents per litre, e.g. 189.9. */
  centsPerLitre: number;
  /** When the station last reported it. */
  updatedMs: number | null;
  source: "FuelCheck" | "Google";
}

export interface NearbyResult {
  placeId: string;
  name: string;
  address: string;
  /** Suburb / locality, when Google gave one. */
  suburb: string | null;
  location: LatLng;
  distanceMeters: number;
  rating: number | null;
  ratingCount: number | null;
  /** 0 (free) .. 4 (very expensive), null when unknown. */
  priceLevel: number | null;
  openNow: boolean | null;
  /** Google photo resource name, for a thumbnail. */
  photoName: string | null;
  /** Prices Google returned for this station (fuelOptions), keyed by our fuel type. */
  googleFuel: Partial<Record<FuelTypeKey, FuelPrice>>;
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.addressComponents",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.currentOpeningHours.openNow",
  "places.photos",
  "places.fuelOptions",
].join(",");

function moneyToCents(m: { units?: string | number; nanos?: number } | undefined): number | null {
  if (!m) return null;
  const v = Number(m.units ?? 0) + (m.nanos ?? 0) / 1e9;
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 10 : null;
}

/** One Places (New) place → a result row. Missing fields stay null, never guessed. */
export function parsePlace(p: any, from: LatLng): NearbyResult | null {
  const lat = p?.location?.latitude;
  const lng = p?.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || typeof p?.id !== "string") return null;
  const locality = (p.addressComponents ?? []).find((c: any) => Array.isArray(c.types) && c.types.includes("locality"));
  const googleFuel: NearbyResult["googleFuel"] = {};
  for (const fp of p.fuelOptions?.fuelPrices ?? []) {
    const ft = FUEL_TYPES.find((f) => f.google && f.google === fp.type);
    const cents = moneyToCents(fp.price);
    if (ft && cents != null) googleFuel[ft.key] = { centsPerLitre: cents, updatedMs: fp.updateTime ? Date.parse(fp.updateTime) : null, source: "Google" };
  }
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "Unnamed place",
    address: p.shortFormattedAddress ?? p.formattedAddress ?? "",
    suburb: locality?.longText ?? locality?.shortText ?? null,
    location: { latitude: lat, longitude: lng },
    distanceMeters: Math.round(distanceKm(from.latitude, from.longitude, lat, lng) * 1000),
    rating: typeof p.rating === "number" ? p.rating : null,
    ratingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    priceLevel: typeof p.priceLevel === "string" && p.priceLevel in PRICE_LEVELS ? PRICE_LEVELS[p.priceLevel] : null,
    openNow: typeof p.currentOpeningHours?.openNow === "boolean" ? p.currentOpeningHours.openNow : null,
    photoName: p.photos?.[0]?.name ?? null,
    googleFuel,
  };
}

export class PlacesNewError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "PlacesNewError";
  }
}

async function post(path: string, body: object): Promise<any[]> {
  const res = await netFetch("places", `https://places.googleapis.com/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.googlePlacesApiKey, "X-Goog-FieldMask": FIELD_MASK },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new PlacesNewError(res.status, res.status === 403 ? `Google Places refused the request (${msg})` : msg);
  }
  return Array.isArray(json?.places) ? json.places : [];
}

export function typesFor(category: NearbyCategory, fuelType?: FuelTypeKey): string[] {
  if (category === "fuel" && fuelType === "ev") return ["electric_vehicle_charging_station"];
  return CATEGORY_TYPES[category];
}

/** Places of a category within radiusM of `center`, nearest first (up to 20, Google's limit). */
export async function searchNearbyNew(category: NearbyCategory, center: LatLng, radiusM: number, opts: { fuelType?: FuelTypeKey; popular?: boolean } = {}): Promise<NearbyResult[]> {
  const places = await post("places:searchNearby", {
    includedTypes: typesFor(category, opts.fuelType),
    maxResultCount: 20,
    rankPreference: opts.popular ? "POPULARITY" : "DISTANCE",
    locationRestriction: { circle: { center: { latitude: center.latitude, longitude: center.longitude }, radius: Math.min(50_000, radiusM) } },
  });
  return places.map((p) => parsePlace(p, center)).filter((r): r is NearbyResult => r !== null);
}

/** A typed name within the same category, biased to the area around you. */
export async function searchTextNew(query: string, category: NearbyCategory, center: LatLng, radiusM: number, fuelType?: FuelTypeKey): Promise<NearbyResult[]> {
  const places = await post("places:searchText", {
    textQuery: query,
    includedType: typesFor(category, fuelType)[0],
    pageSize: 20,
    locationBias: { circle: { center: { latitude: center.latitude, longitude: center.longitude }, radius: Math.min(50_000, radiusM) } },
  });
  return places.map((p) => parsePlace(p, center)).filter((r): r is NearbyResult => r !== null);
}

/** A small thumbnail for a row (Places photo media). */
export function photoUrl(photoName: string, maxPx = 144): string {
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxPx}&maxHeightPx=${maxPx}&key=${env.googlePlacesApiKey}`;
}

export interface ListOptions {
  sort: SortKey;
  openNow: boolean;
  topRated: boolean;
  /** For "price" on fuel: the price per result for the chosen fuel type. */
  priceOf?: (r: NearbyResult) => number | null;
}

export const TOP_RATED = 4.3;

/** Apply Open now / Top rated and the chosen sort. Unknowns go last, never dropped by a sort. */
export function arrangeResults(results: NearbyResult[], o: ListOptions): NearbyResult[] {
  let out = results.slice();
  if (o.openNow) out = out.filter((r) => r.openNow === true);
  if (o.topRated) out = out.filter((r) => (r.rating ?? 0) >= TOP_RATED);
  const byDistance = (a: NearbyResult, b: NearbyResult) => a.distanceMeters - b.distanceMeters;
  if (o.sort === "distance") return out.sort(byDistance);
  if (o.sort === "price") {
    const price = o.priceOf ?? ((r: NearbyResult) => r.priceLevel);
    return out.sort((a, b) => {
      const pa = price(a);
      const pb = price(b);
      if (pa == null && pb == null) return byDistance(a, b);
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb || byDistance(a, b);
    });
  }
  // Best match: rating weighted by how many people rated it, nudged by distance.
  const score = (r: NearbyResult) => (r.rating ?? 3.5) * Math.log10(10 + (r.ratingCount ?? 0)) - r.distanceMeters / 2000;
  return out.sort((a, b) => score(b) - score(a));
}

/** "$1.89" from cents per litre. */
export function formatFuelPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "updated 20 min ago". */
export function updatedAgo(updatedMs: number | null, nowMs = Date.now()): string | null {
  if (updatedMs == null || !Number.isFinite(updatedMs)) return null;
  const mins = Math.max(0, Math.round((nowMs - updatedMs) / 60_000));
  if (mins < 1) return "updated just now";
  if (mins < 60) return `updated ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `updated ${hours} h ago`;
  return `updated ${Math.round(hours / 24)} days ago`;
}
