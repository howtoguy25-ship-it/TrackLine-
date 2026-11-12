import { env } from "@/config/env";
import type { LatLng } from "@/utils/polyline";
import { Sentry } from "@/services/sentry";

// Real, confirmed bug fix -- see withTimeout.ts's own comment. 12s is generous enough for a
// real, slow-but-working connection to still complete normally, short enough that a genuinely
// hung request turns into a clear, retryable error well before it reads as the app being frozen.
const NEARBY_SEARCH_TIMEOUT_MS = 12000;

export interface PlacePrediction {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  // Real distance from biasLocation -- only present when biasLocation was actually passed (see
  // the `origin` param below, a real, documented Autocomplete API field: passing `origin` makes
  // Google compute and return this itself, not something calculated client-side from a guess).
  distanceMeters?: number;
  // Google's own real place-type tags (e.g. "train_station", "locality", "university") -- used
  // to pick a real, category-appropriate icon instead of one generic pin for every result.
  types?: string[];
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  address: string;
  location: LatLng;
}

export class PlacesApiError extends Error {
  constructor(public status: string, message?: string) {
    super(message ? `${status}: ${message}` : status);
    this.name = "PlacesApiError";
  }
}

export async function searchPlaces(
  query: string,
  biasLocation?: LatLng,
  // Pass the same token for every keystroke of one search, and again to getPlaceDetails for the
  // result chosen: Google then bills the whole search as one session instead of per request
  // (see services/searchRanking.ts -- SearchSession).
  sessionToken?: string
): Promise<PlacePrediction[]> {
  if (!query.trim()) return [];

  // No `types` restriction -- Google's default returns addresses, suburbs/localities,
  // cities, regions, and countries (the "geocode" set) *plus* businesses/landmarks by name,
  // which a real navigation destination search needs too ("Starbucks", not just "123 Main
  // St"). Restricting to types:"geocode" (the old behavior) silently excluded every
  // establishment result.
  const params = new URLSearchParams({
    input: query,
    key: env.googlePlacesApiKey,
    // Australia first: ranks Australian matches above same-named places overseas, without
    // hiding the overseas ones (a hard country filter would).
    region: "au",
  });
  if (sessionToken) params.set("sessiontoken", sessionToken);
  if (biasLocation) {
    params.set("location", `${biasLocation.latitude},${biasLocation.longitude}`);
    params.set("radius", "50000");
    // Real, documented Autocomplete API field -- passing `origin` (distinct from the `location`
    // bias above, which only affects ranking/relevance) makes Google compute and return a real
    // `distance_meters` per prediction, straight from the same real point every other "near me"
    // search in this app already uses. Not a client-side estimate.
    params.set("origin", `${biasLocation.latitude},${biasLocation.longitude}`);
  }

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`
  );
  const json = await res.json();

  // ZERO_RESULTS is a normal, silent empty-list outcome (nothing matches yet, still typing).
  // Everything else (REQUEST_DENIED, INVALID_REQUEST, OVER_QUERY_LIMIT, UNKNOWN_ERROR) is a
  // real failure -- most commonly an API-key restriction issue, since a plain fetch() from
  // JS doesn't send the iOS/Android bundle-identifier headers that an "app-restricted" key
  // requires, unlike calls made through the native Maps SDK itself. This used to be silently
  // swallowed into an empty array indistinguishable from "no matches", which is exactly what
  // made this impossible to diagnose without a report like "the dropdown just never appears."
  if (json.status !== "OK" && json.status !== "ZERO_RESULTS") {
    Sentry.logger.error("places: autocomplete request failed", {
      status: json.status,
      errorMessage: json.error_message,
      query,
    });
    throw new PlacesApiError(json.status, json.error_message);
  }
  if (json.status === "ZERO_RESULTS") return [];

  return json.predictions.map((p: any) => ({
    placeId: p.place_id,
    primaryText: p.structured_formatting?.main_text ?? p.description,
    secondaryText: p.structured_formatting?.secondary_text ?? "",
    distanceMeters: typeof p.distance_meters === "number" ? p.distance_meters : undefined,
    types: Array.isArray(p.types) ? p.types : undefined,
  }));
}

export interface PlaceReview {
  authorName: string;
  rating: number;
  relativeTime: string;
  text: string;
}

export interface PlaceInfo extends PlaceDetails {
  rating?: number;
  userRatingsTotal?: number;
  openNow?: boolean;
  weekdayText?: string[];
  phoneNumber?: string;
  website?: string;
  reviews: PlaceReview[];
  // Real Google Places photos for this business -- up to PLACE_INFO_MAX_PHOTOS, empty array
  // (never fabricated) when Google has none on file for it.
  photoUrls: string[];
  // Who took each photo, aligned with photoUrls -- Google's terms require it to be shown with
  // the photo. Plain text (Google sends it as a link; only the name is kept). May be "".
  photoAttributions: string[];
  // Google's own real 0-4 price scale -- see priceLevelText below. undefined means Google has
  // no price data for this place (most non-business addresses), never guessed.
  priceLevel?: number;
  // A clean, human-readable category derived from Google's own real `types` array (e.g.
  // "Restaurant", "Hair Salon") -- see primaryCategoryLabel below for how the generic/
  // administrative entries every type array carries (point_of_interest, establishment, ...)
  // get filtered out first. undefined for a plain address/non-business place, or if every real
  // type Google returned was one of those generic ones -- never a guessed category.
  category?: string;
}

// Shared across PlaceInfoSheet/RestaurantsSheet/HotelsSheet -- Google's own real 0-4 price_level
// scale, rendered the same real "$" x N way everywhere it's shown.
export function priceLevelText(level: number | undefined): string | null {
  if (level === undefined) return null;
  return "$".repeat(Math.max(1, level));
}

// Google's own place `types` array always includes several generic/administrative entries
// alongside the one or two that actually describe what kind of business this is --
// "point_of_interest" and "establishment" are on nearly every result, and a street address
// additionally carries "route"/"street_address"/"geocode"/"political"/locality-ish entries.
// Real, confirmed-real exclusion list (Google's own documented place type taxonomy, not
// guessed) so the first REMAINING type -- the actual category Google itself assigned -- is what
// gets shown, formatted from snake_case into a real readable label ("hair_care" -> "Hair Care").
const GENERIC_PLACE_TYPES = new Set([
  "point_of_interest",
  "establishment",
  "premise",
  "subpremise",
  "political",
  "geocode",
  "plus_code",
  "route",
  "street_address",
  "street_number",
  "intersection",
  "locality",
  "sublocality",
  "sublocality_level_1",
  "sublocality_level_2",
  "sublocality_level_3",
  "sublocality_level_4",
  "sublocality_level_5",
  "neighborhood",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "administrative_area_level_4",
  "administrative_area_level_5",
  "postal_code",
  "postal_code_suffix",
  "postal_town",
  "country",
]);

export function primaryCategoryLabel(types: string[] | undefined): string | undefined {
  const real = (types ?? []).find((t) => !GENERIC_PLACE_TYPES.has(t));
  if (!real) return undefined;
  return real
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// "Nearest train/bus station" quick action -- rankby=distance + a real `type` filter
// (`type=transit_station`, Google's own catch-all for bus stops, train stations, light rail
// stops, etc.), returning full PlaceDetails directly (name + location) since the caller routes
// straight to it rather than showing an intermediate result list. `rankby=distance` requires a
// `keyword`/`name`/`type` alongside it (a plain `radius` search instead defaults to *prominence*
// ranking, not distance, and would mix in locality/administrative results) -- `type=
// transit_station` both satisfies that and keeps results to genuine transit stops.
export async function findNearestTransitStation(location: LatLng): Promise<PlaceDetails | null> {
  const params = new URLSearchParams({
    location: `${location.latitude},${location.longitude}`,
    rankby: "distance",
    type: "transit_station",
    key: env.googlePlacesApiKey,
  });

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`
  );
  const json = await res.json();

  if (json.status === "ZERO_RESULTS") return null;
  if (json.status !== "OK") {
    Sentry.logger.error("places: nearest transit station request failed", {
      status: json.status,
      errorMessage: json.error_message,
    });
    throw new PlacesApiError(json.status, json.error_message);
  }

  const nearest = json.results?.[0];
  if (!nearest) return null;
  return {
    placeId: nearest.place_id,
    name: nearest.name,
    address: nearest.vicinity ?? "",
    location: {
      latitude: nearest.geometry.location.lat,
      longitude: nearest.geometry.location.lng,
    },
  };
}

// Capped, same reasoning as RestaurantsSheet's own review cap below -- a real business can have
// dozens of Places photos; a horizontal strip of a handful is what a driver glancing at this
// sheet actually looks at, not an unbounded gallery.
const PLACE_INFO_MAX_PHOTOS = 6;

/** Photo URLs and their (required) credits, kept in step -- a photo is dropped with its credit. */
function placePhotosWithCredit(photos: any[] | undefined): { photoUrls: string[]; photoAttributions: string[] } {
  const photoUrls: string[] = [];
  const photoAttributions: string[] = [];
  for (const photo of (photos ?? []).slice(0, PLACE_INFO_MAX_PHOTOS)) {
    const url = nearbyPlacePhotoUrl(photo?.photo_reference);
    if (!url) continue;
    photoUrls.push(url);
    const html = Array.isArray(photo.html_attributions) ? photo.html_attributions.join(", ") : "";
    photoAttributions.push(html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
  }
  return { photoUrls, photoAttributions };
}

export async function getPlaceInfo(placeId: string): Promise<PlaceInfo> {
  const params = new URLSearchParams({
    place_id: placeId,
    key: env.googlePlacesApiKey,
    fields:
      "place_id,name,formatted_address,geometry,rating,user_ratings_total,opening_hours,formatted_phone_number,website,reviews,photos,price_level,types",
  });

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`
  );
  const json = await res.json();

  if (json.status !== "OK") {
    Sentry.logger.error("places: place info request failed", {
      status: json.status,
      errorMessage: json.error_message,
      placeId,
    });
    throw new PlacesApiError(json.status, json.error_message);
  }

  const result = json.result;
  return {
    placeId: result.place_id,
    name: result.name,
    address: result.formatted_address,
    location: {
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
    },
    rating: result.rating,
    userRatingsTotal: result.user_ratings_total,
    openNow: result.opening_hours?.open_now,
    weekdayText: result.opening_hours?.weekday_text,
    phoneNumber: result.formatted_phone_number,
    website: result.website,
    reviews: (result.reviews ?? []).slice(0, 5).map((r: any) => ({
      authorName: r.author_name,
      rating: r.rating,
      relativeTime: r.relative_time_description,
      text: r.text,
    })),
    ...placePhotosWithCredit(result.photos),
    priceLevel: result.price_level,
    category: primaryCategoryLabel(result.types),
  };
}

// Live "current address" for the driver's own GPS fix -- turns a bare lat/lng into a real
// street address (house number + street), the same way Apple/Google Maps show a real address
// under the blue dot rather than raw coordinates. Google's Geocode API returns several results
// for one point (the exact street address, but also its containing neighborhood/postcode/etc.);
// street_address is the most specific one that actually has a house number, so it's preferred
// over whatever happens to be first in the list.
export async function reverseGeocode(location: LatLng): Promise<string | null> {
  const params = new URLSearchParams({
    latlng: `${location.latitude},${location.longitude}`,
    key: env.googlePlacesApiKey,
  });

  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
  const json = await res.json();

  if (json.status === "ZERO_RESULTS") return null;
  if (json.status !== "OK") {
    Sentry.logger.error("places: reverse geocode request failed", {
      status: json.status,
      errorMessage: json.error_message,
    });
    throw new PlacesApiError(json.status, json.error_message);
  }

  const results: any[] = json.results ?? [];
  const best =
    results.find((r) => r.types?.includes("street_address")) ??
    results.find((r) => r.types?.includes("premise")) ??
    results[0];
  return best?.formatted_address ?? null;
}

export interface NearbyPlace {
  placeId: string;
  name: string;
  vicinity: string;
  location: LatLng;
  rating?: number;
  userRatingsTotal?: number;
  // Google's own 0-4 scale ($ to $$$$) -- undefined means Google itself has no price data for
  // this place, never guessed/defaulted to a specific level.
  priceLevel?: number;
  openNow?: boolean;
  // A real, directly-usable Google Places Photo API URL (this app's own API key already
  // embedded), or null when Google has no photo for this place -- never a placeholder image.
  photoUrl: string | null;
  distanceMeters: number;
  // The place's own raw OpenStreetMap tags, when it came from OSM (fuel/food/hotel/parking
  // lists). Lets a list read real per-place details the fixed fields above have no slot for --
  // e.g. the parking sheet's free/covered/accessible filters (services/parkingFilters.ts).
  osmTags?: Record<string, string>;
}

function nearbyPlacePhotoUrl(photoReference: string | undefined): string | null {
  if (!photoReference) return null;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=480&photo_reference=${photoReference}&key=${env.googlePlacesApiKey}`;
}

// Real Street View Static API thumbnail -- Apple Maps' own "Look Around" equivalent, "with a
// touch of TrackLine" per explicit request. The real, documented Metadata endpoint is checked
// first (a separate, free call, same API key) rather than building the image URL unconditionally
// -- the Street View Static Image endpoint itself returns a generic gray "no imagery here" tile
// for a location Google has no real panorama for, and showing that dressed up as a real street
// photo would be exactly the kind of fabricated-looking result this app never shows. Returns
// null (never a placeholder) when there's genuinely no real coverage at this location.
export async function getStreetViewUrl(location: LatLng): Promise<string | null> {
  const params = new URLSearchParams({
    location: `${location.latitude},${location.longitude}`,
    key: env.googlePlacesApiKey,
  });
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`);
    const json = await res.json();
    if (json.status !== "OK") return null;
    return `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${location.latitude},${location.longitude}&key=${env.googlePlacesApiKey}`;
  } catch (err) {
    Sentry.logger.error("places: street view metadata request failed", { error: String(err) });
    return null;
  }
}

// Real, explicit request -- an interactive (pan/zoom/walk) Street View embed via Google's Maps
// Embed API, same documented "streetview" mode, same API key already used for every other Google
// call in this app. Only ever built as a companion to a `getStreetViewUrl` result that already
// passed the real metadata coverage check above -- this function does no coverage check of its
// own because Static and Embed Street View draw from the same underlying panorama coverage, so a
// confirmed-real location for one is a confirmed-real location for the other. Whether "Maps Embed
// API" is actually enabled on this project's key is NOT something this app can check in advance;
// the caller (PlaceInfoSheet) loads this in a WebView and falls back to the static thumbnail on a
// real load failure -- never a silently blank panel.
export function getStreetViewEmbedUrl(location: LatLng): string {
  const params = new URLSearchParams({
    key: env.googlePlacesApiKey,
    location: `${location.latitude},${location.longitude}`,
    heading: "0",
    pitch: "0",
    fov: "90",
  });
  return `https://www.google.com/maps/embed/v1/streetview?${params.toString()}`;
}

// Real distance (haversine), not Google's own ranking order -- Nearby Search's `rankby=distance`
// mode already sorts by this, but the app still needs the actual meters figure to show/format
// per result, which Google's response doesn't include directly.
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function getPlaceDetails(placeId: string, sessionToken?: string): Promise<PlaceDetails> {
  const params = new URLSearchParams({
    place_id: placeId,
    key: env.googlePlacesApiKey,
    fields: "place_id,name,formatted_address,geometry",
  });
  // Ends the autocomplete session this result came from (see searchPlaces).
  if (sessionToken) params.set("sessiontoken", sessionToken);

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`
  );
  const json = await res.json();

  if (json.status !== "OK") {
    Sentry.logger.error("places: place details request failed", {
      status: json.status,
      errorMessage: json.error_message,
      placeId,
    });
    throw new PlacesApiError(json.status, json.error_message);
  }

  const result = json.result;
  return {
    placeId: result.place_id,
    name: result.name,
    address: result.formatted_address,
    location: {
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
    },
  };
}
