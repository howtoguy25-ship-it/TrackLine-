import { env } from "@/config/env";
import type { LatLng } from "@/utils/polyline";
import { Sentry } from "@/services/sentry";
import { withTimeout } from "@/utils/withTimeout";

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

export async function searchPlaces(query: string, biasLocation?: LatLng): Promise<PlacePrediction[]> {
  if (!query.trim()) return [];

  // No `types` restriction -- Google's default returns addresses, suburbs/localities,
  // cities, regions, and countries (the "geocode" set) *plus* businesses/landmarks by name,
  // which a real navigation destination search needs too ("Starbucks", not just "123 Main
  // St"). Restricting to types:"geocode" (the old behavior) silently excluded every
  // establishment result.
  const params = new URLSearchParams({
    input: query,
    key: env.googlePlacesApiKey,
  });
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
}

// Real POI-tap-to-info requires *some* place near the tapped coordinate to look up.
// react-native-maps' own onPoiClick would be a real native "which business did they tap" event
// on the current Google-provider MapView, but this predates the switch to Google on iOS (it
// used to be Apple's MapKit there, which has no such event) and works identically regardless of
// provider, so it was left as-is rather than reworked into a still-untested native-event path
// right alongside a provider change. Treats any map tap as "find whatever's closest to here"
// via Nearby Search, then pulls full details for it.
//
// This used to pass a fixed `radius` with no `rankby`/`type` -- Nearby Search's default order
// for a plain radius search is *prominence* (rating/importance), not distance, and with no
// `type` filter that ranking pool includes localities/administrative areas alongside real
// businesses. Confirmed on a real device: tapping directly on a small shop pin returned
// "Sydney, Sydney NSW, Australia" (a locality result outranking the actual business a few
// meters away) instead of the shop itself. `rankby=distance` fixes the ordering to genuine
// closest-first, but Google requires either a `keyword`, `name`, or `type` alongside it --
// `type=establishment` is exactly "any real business/POI," which both satisfies that
// requirement and excludes locality/political results outright. `radius` isn't a valid param
// together with `rankby=distance`, so the distance sanity-check moves to the caller (which
// already fetches full place details, including geometry, right after this).
export async function findNearestPlace(location: LatLng): Promise<{ placeId: string } | null> {
  const params = new URLSearchParams({
    location: `${location.latitude},${location.longitude}`,
    rankby: "distance",
    type: "establishment",
    key: env.googlePlacesApiKey,
  });

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`
  );
  const json = await res.json();

  if (json.status === "ZERO_RESULTS") return null;
  if (json.status !== "OK") {
    Sentry.logger.error("places: nearby search request failed", {
      status: json.status,
      errorMessage: json.error_message,
    });
    throw new PlacesApiError(json.status, json.error_message);
  }

  const nearest = json.results?.[0];
  return nearest ? { placeId: nearest.place_id } : null;
}

// "Nearest train/bus station" quick action -- same rankby=distance + real-type-filter shape as
// findNearestPlace above, but scoped to `type=transit_station` (Google's own catch-all for bus
// stops, train stations, light rail stops, etc.) instead of any establishment, and returns full
// PlaceDetails directly (name + location) since the caller routes straight to it rather than
// showing an intermediate result list.
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

export async function getPlaceInfo(placeId: string): Promise<PlaceInfo> {
  const params = new URLSearchParams({
    place_id: placeId,
    key: env.googlePlacesApiKey,
    fields:
      "place_id,name,formatted_address,geometry,rating,user_ratings_total,opening_hours,formatted_phone_number,website,reviews,photos",
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
    photoUrls: (result.photos ?? [])
      .slice(0, PLACE_INFO_MAX_PHOTOS)
      .map((p: any) => nearbyPlacePhotoUrl(p.photo_reference))
      .filter((url: string | null): url is string => url !== null),
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
}

function nearbyPlacePhotoUrl(photoReference: string | undefined): string | null {
  if (!photoReference) return null;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=480&photo_reference=${photoReference}&key=${env.googlePlacesApiKey}`;
}

// Real, confirmed complaint: restaurants/hotels/petrol only ever showed the nearest ~20 results
// (a single Nearby Search page) -- fine standing still, but nowhere near "all the restaurants
// and hotels available" across the actual city/suburb a driver is in. Google's Nearby Search
// paginates up to 3 pages (60 results total) via `next_page_token`, still ordered nearest-first
// even under rankby=distance -- fetching all 3 genuinely widens real coverage out across the
// broader area instead of an artificial radius (not a valid param alongside rankby=distance
// anyway, per findNearestPlace's own comment above). Google's own real requirement: a freshly
// issued next_page_token isn't valid for a short window after being issued -- an immediate
// follow-up request reliably comes back INVALID_REQUEST, hence the delay before reusing one.
const NEXT_PAGE_TOKEN_DELAY_MS = 2000;
const MAX_NEARBY_PAGES = 3;

async function fetchAllNearbyPages(baseParams: URLSearchParams, errorContext: string): Promise<any[]> {
  const results: any[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_NEARBY_PAGES; page++) {
    const params = new URLSearchParams(baseParams);
    if (pageToken) {
      params.set("pagetoken", pageToken);
      await new Promise((resolve) => setTimeout(resolve, NEXT_PAGE_TOKEN_DELAY_MS));
    }
    const res = await withTimeout(
      fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`),
      NEARBY_SEARCH_TIMEOUT_MS,
      `${errorContext} (page ${page})`
    );
    const json = await res.json();

    if (json.status === "ZERO_RESULTS") break;
    if (json.status !== "OK") {
      Sentry.logger.error(`places: ${errorContext} page failed`, {
        status: json.status,
        errorMessage: json.error_message,
        page,
      });
      // A later page failing (e.g. the token expired) shouldn't discard real results already
      // fetched from earlier pages -- only a first-page failure has nothing real to fall back
      // to, so that's the only case still worth throwing for the caller's own error UI.
      if (page === 0) throw new PlacesApiError(json.status, json.error_message);
      break;
    }

    results.push(...(json.results ?? []));
    pageToken = json.next_page_token;
    if (!pageToken) break;
  }
  return results;
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

// Real nearby food search -- `type=restaurant` covers Google's own broad food-venue category
// (cafes, dessert bars, and fast food all commonly get tagged under it alongside sit-down
// restaurants), ranked genuinely closest-first via rankby=distance (same reasoning as
// findNearestPlace above for why that needs a type/keyword, not a bare radius search). Fetched
// ONCE per screen open -- the search bar's own live, letter-by-letter filtering happens
// client-side against this real result set (see RestaurantsSheet), not a fresh API call per
// keystroke.
export async function searchNearbyRestaurants(location: LatLng): Promise<NearbyPlace[]> {
  const params = new URLSearchParams({
    location: `${location.latitude},${location.longitude}`,
    rankby: "distance",
    type: "restaurant",
    key: env.googlePlacesApiKey,
  });

  const results = await fetchAllNearbyPages(params, "nearby restaurants request");

  return results.map((r: any) => {
    const placeLocation: LatLng = { latitude: r.geometry.location.lat, longitude: r.geometry.location.lng };
    return {
      placeId: r.place_id,
      name: r.name,
      vicinity: r.vicinity ?? "",
      location: placeLocation,
      rating: r.rating,
      userRatingsTotal: r.user_ratings_total,
      priceLevel: r.price_level,
      openNow: r.opening_hours?.open_now,
      photoUrl: nearbyPlacePhotoUrl(r.photos?.[0]?.photo_reference),
      distanceMeters: haversineMeters(location, placeLocation),
    };
  });
}

// Same shape/reasoning as searchNearbyRestaurants above, `type=lodging` instead -- Google's own
// catch-all for hotels/motels/B&Bs. Real names, real photos, real ratings, real price LEVEL
// (Google's own 0-4 $-to-$$$$ scale) -- what this does NOT and cannot provide is a live
// per-night price or a bookable checkout link, since Google Places has no such data; that needs
// a real hotel-booking API relationship (Booking.com/Expedia/etc.), a business decision, not
// something this function can fabricate. See HotelsSheet's own comment for how it presents that
// gap honestly instead of inventing a price.
export async function searchNearbyHotels(location: LatLng): Promise<NearbyPlace[]> {
  const params = new URLSearchParams({
    location: `${location.latitude},${location.longitude}`,
    rankby: "distance",
    type: "lodging",
    key: env.googlePlacesApiKey,
  });

  const results = await fetchAllNearbyPages(params, "nearby hotels request");

  return results.map((r: any) => {
    const placeLocation: LatLng = { latitude: r.geometry.location.lat, longitude: r.geometry.location.lng };
    return {
      placeId: r.place_id,
      name: r.name,
      vicinity: r.vicinity ?? "",
      location: placeLocation,
      rating: r.rating,
      userRatingsTotal: r.user_ratings_total,
      priceLevel: r.price_level,
      openNow: r.opening_hours?.open_now,
      photoUrl: nearbyPlacePhotoUrl(r.photos?.[0]?.photo_reference),
      distanceMeters: haversineMeters(location, placeLocation),
    };
  });
}

// Same shape/reasoning as searchNearbyRestaurants/Hotels above, `type=gas_station` instead --
// real station names/addresses/locations from Google Places. Google Places has no live fuel
// price data at all for any station, so priceLevel/rating here mean the same generic Google
// fields every other NearbyPlace has, not a fuel price -- see FuelStationsSheet, which never
// shows a price at all now that the NSW FuelCheck live-price integration has been removed
// (a real, confirmed external outage on NSW's own OAuth token endpoint, and even working it only
// ever covered one state).
export async function searchNearbyPetrolStations(location: LatLng): Promise<NearbyPlace[]> {
  const params = new URLSearchParams({
    location: `${location.latitude},${location.longitude}`,
    rankby: "distance",
    type: "gas_station",
    key: env.googlePlacesApiKey,
  });

  const results = await fetchAllNearbyPages(params, "nearby petrol stations request");

  return results.map((r: any) => {
    const placeLocation: LatLng = { latitude: r.geometry.location.lat, longitude: r.geometry.location.lng };
    return {
      placeId: r.place_id,
      name: r.name,
      vicinity: r.vicinity ?? "",
      location: placeLocation,
      rating: r.rating,
      userRatingsTotal: r.user_ratings_total,
      priceLevel: r.price_level,
      openNow: r.opening_hours?.open_now,
      photoUrl: nearbyPlacePhotoUrl(r.photos?.[0]?.photo_reference),
      distanceMeters: haversineMeters(location, placeLocation),
    };
  });
}

// Real, explicit request: "everything they can think of they can search" -- the search box in
// RestaurantsSheet/HotelsSheet/FuelStationsSheet previously only ever filtered client-side
// against the up-to-60 nearest results already fetched (a deliberate cost/latency tradeoff, see
// searchNearbyRestaurants' own comment) -- fine for browsing, but a genuinely different business
// across town (a specific hotel chain, a particular restaurant name) that never made it into
// those nearest 60 was simply unreachable no matter what was typed. Google's real Text Search
// API (distinct from Nearby Search -- this is the same endpoint family Google Maps' own search
// bar uses) searches by NAME/keyword, not just proximity, so a real business anywhere Google
// knows about it can be found -- `location`+`radius` bias results toward the driver's own area
// without hard-restricting to it, and `type` keeps results to the right category (a text search
// for "Hilton" with type=lodging won't surface an unrelated "Hilton Street" address). No country
// restriction of any kind -- Google Places itself is global, so this already works for a driver
// in any country, not just Australia.
export async function searchPlacesByText(
  query: string,
  location: LatLng,
  type: "restaurant" | "lodging" | "gas_station"
): Promise<NearbyPlace[]> {
  const params = new URLSearchParams({
    query,
    location: `${location.latitude},${location.longitude}`,
    radius: "50000",
    type,
    key: env.googlePlacesApiKey,
  });

  const res = await withTimeout(
    fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`),
    NEARBY_SEARCH_TIMEOUT_MS,
    "places text search request"
  );
  const json = await res.json();

  if (json.status === "ZERO_RESULTS") return [];
  if (json.status !== "OK") {
    Sentry.logger.error("places: text search request failed", {
      status: json.status,
      errorMessage: json.error_message,
      type,
    });
    throw new PlacesApiError(json.status, json.error_message);
  }

  return (json.results ?? [])
    .map((r: any) => {
      const placeLocation: LatLng = { latitude: r.geometry.location.lat, longitude: r.geometry.location.lng };
      return {
        placeId: r.place_id,
        name: r.name,
        vicinity: r.formatted_address ?? "",
        location: placeLocation,
        rating: r.rating,
        userRatingsTotal: r.user_ratings_total,
        priceLevel: r.price_level,
        openNow: r.opening_hours?.open_now,
        photoUrl: nearbyPlacePhotoUrl(r.photos?.[0]?.photo_reference),
        distanceMeters: haversineMeters(location, placeLocation),
      };
    })
    .sort((a: NearbyPlace, b: NearbyPlace) => a.distanceMeters - b.distanceMeters);
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const params = new URLSearchParams({
    place_id: placeId,
    key: env.googlePlacesApiKey,
    fields: "place_id,name,formatted_address,geometry",
  });

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
