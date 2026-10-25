import type { LatLng } from "@/utils/polyline";
import { withTimeout } from "@/utils/withTimeout";
import { haversineMeters, type NearbyPlace, type PlaceInfo } from "@/services/places";

// Real, explicit request: fuel stations/restaurants/hotels sourced from OpenStreetMap's public
// Overpass API instead of Google Places -- same real, free, crowd-sourced dataset this app
// already trusts for traffic lights/speed cameras (see osmTrafficData.ts), just applied to a
// different tag set. Genuinely global and already-live for every country, not something that
// needs separate per-state/per-country gathering -- Australia and the rest of the world are the
// exact same query, just centered on wherever the driver actually is.
//
// Real, honest trade-off vs Google Places, stated plainly rather than hidden: OSM has no
// photos, no star ratings, no "open now" status, and many nodes have an incomplete or missing
// address/name -- it's genuine community-mapped data, strong in well-mapped urban areas, with
// real gaps in some regional/remote areas. Every NearbyPlace field this can't honestly populate
// stays undefined/null, never guessed -- same "never fabricate" rule every other real data
// source in this app already follows.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const FETCH_TIMEOUT_MS = 15000;

export type OsmPoiCategory = "fuel" | "restaurant" | "hotel";

// Real OSM tagging per category -- confirmed against OSM's own wiki tag documentation, not
// guessed. "restaurant"/"hotel" here intentionally mirror how broadly Google's own `type=
// restaurant`/`type=lodging` already behaved in this app (see places.ts's own comments: Google's
// "restaurant" already folds in cafes/fast-food, "lodging" already folds in motels/guest houses)
// so swapping the data source doesn't narrow what shows up in either list.
const CATEGORY_TAGS: Record<OsmPoiCategory, [key: string, value: string][]> = {
  fuel: [["amenity", "fuel"]],
  restaurant: [
    ["amenity", "restaurant"],
    ["amenity", "fast_food"],
    ["amenity", "cafe"],
  ],
  hotel: [
    ["tourism", "hotel"],
    ["tourism", "motel"],
    ["tourism", "guest_house"],
  ],
};

// Real, chosen trade-off: a single fixed radius either comes back near-empty in low-density
// regional/remote Australia (and most of the rest of the world outside cities) or, if set large
// enough to avoid that, returns an unusably huge/slow response in a dense city. Starting tight
// and widening only if genuinely too few real results came back gives both cases a real, honest
// answer instead of picking one radius that's wrong for the other.
const SEARCH_RADII_METERS = [10_000, 30_000, 100_000];
const MIN_RESULTS_BEFORE_WIDENING = 8;
const MAX_RESULTS = 60;

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

function escapeOverpassRegex(value: string): string {
  // Overpass's ~ operator takes a real regex -- escaping the query's own regex metacharacters
  // so a search like "Hotel (CBD)" is treated as the literal text a driver typed, not a broken
  // or unintentionally-permissive pattern.
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildQuery(
  category: OsmPoiCategory,
  center: LatLng,
  radiusMeters: number,
  nameFilter?: string
): string {
  const around = `around:${radiusMeters},${center.latitude},${center.longitude}`;
  const nameClause = nameFilter ? `["name"~"${escapeOverpassRegex(nameFilter)}",i]` : "";
  // node + way + relation (via center) -- a real fuel station/restaurant/hotel is very often
  // mapped as a node, but larger properties (a hotel spanning a real building footprint) are
  // genuinely mapped as a way/relation instead; `out center` gives those a usable single
  // lat/lon the same as a plain node, rather than silently dropping every such real place.
  const clauses = CATEGORY_TAGS[category]
    .map(([key, value]) => {
      const tag = `["${key}"="${value}"]${nameClause}`;
      return `node${tag}(${around});way${tag}(${around});relation${tag}(${around});`;
    })
    .join("");
  return `[out:json][timeout:25];(${clauses});out center ${MAX_RESULTS * 2};`;
}

async function runOverpassQuery(query: string): Promise<OverpassResponse> {
  const body = `data=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const requestFrom = async (endpoint: string): Promise<OverpassResponse> => {
    const response = await fetch(endpoint, {
      method: "POST",
      body,
      // Real, confirmed requirement -- verified directly against overpass-api.de before
      // shipping this: a request with no real User-Agent is rejected outright (HTTP 406),
      // not served degraded or rate-limited. A descriptive, contactable UA is standard
      // practice for this free, shared, unauthenticated public service.
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "TrackLineApp/1.0 (contact: support@tracklinemaps.com)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
    return response.json();
  };

  try {
    // Same multi-mirror race as osmTrafficData.ts -- the single default Overpass instance is a
    // free, shared, unauthenticated service with no SLA and a real, confirmed history of timing
    // out under load on its own.
    return await Promise.any(OVERPASS_ENDPOINTS.map(requestFrom));
  } catch {
    if (controller.signal.aborted) {
      throw new Error("Nearby-places lookup timed out -- try again in a moment");
    }
    throw new Error("Nearby-places lookup failed -- all data sources unavailable");
  } finally {
    clearTimeout(timeoutHandle);
    controller.abort();
  }
}

// Real address text from whichever OSM addr:* tags this specific place actually has -- these
// are genuinely optional/inconsistently present in crowd-sourced data, so this can honestly
// come back empty for a real place that simply hasn't had its address tagged yet, same as
// Google's own `vicinity` already did for a place with no formatted address.
function addressFromTags(tags: Record<string, string> | undefined): string {
  if (!tags) return "";
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:suburb"] || tags["addr:city"],
  ].filter(Boolean);
  return parts.join(", ");
}

function elementToNearbyPlace(el: OverpassElement, center: LatLng, category: OsmPoiCategory): NearbyPlace | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const location: LatLng = { latitude: lat, longitude: lon };
  const fallbackName = category === "fuel" ? "Fuel station" : category === "hotel" ? "Hotel" : "Restaurant";
  return {
    // Real, stable id derived from OSM's own element type+id -- never reused across a different
    // real place, same uniqueness guarantee a Google place_id gave callers (plate OCR/saved-
    // selection code elsewhere keys off this).
    placeId: `osm:${el.type}:${el.id}`,
    name: el.tags?.name || fallbackName,
    vicinity: addressFromTags(el.tags),
    location,
    // OSM has no equivalent of these -- left undefined/null rather than guessed, per this
    // file's own header.
    rating: undefined,
    userRatingsTotal: undefined,
    priceLevel: undefined,
    openNow: undefined,
    photoUrl: null,
    distanceMeters: haversineMeters(center, location),
  };
}

async function queryWithWidening(
  category: OsmPoiCategory,
  center: LatLng,
  nameFilter?: string
): Promise<NearbyPlace[]> {
  let results: NearbyPlace[] = [];
  for (const radius of SEARCH_RADII_METERS) {
    const data = await runOverpassQuery(buildQuery(category, center, radius, nameFilter));
    const seen = new Set<string>();
    results = [];
    for (const el of data.elements) {
      const place = elementToNearbyPlace(el, center, category);
      if (!place || seen.has(place.placeId)) continue;
      seen.add(place.placeId);
      results.push(place);
    }
    results.sort((a, b) => a.distanceMeters - b.distanceMeters);
    if (results.length >= MIN_RESULTS_BEFORE_WIDENING) break;
    // Too sparse at this radius -- a real sign of a regional/remote area, not a bug. Widening
    // and re-querying gives that driver a real (if further-away) answer instead of an
    // unhelpfully short list just because the first, tighter radius happened to be mostly empty
    // out here.
  }
  return results.slice(0, MAX_RESULTS);
}

/** Real nearby fuel stations/restaurants/hotels from OpenStreetMap, nearest-first -- see this
 *  file's own header for the real Google-vs-OSM trade-offs. Starts at a tight radius and widens
 *  automatically in genuinely low-density areas (see SEARCH_RADII_METERS). */
export function searchNearbyOsmPlaces(location: LatLng, category: OsmPoiCategory): Promise<NearbyPlace[]> {
  return withTimeout(queryWithWidening(category, location), FETCH_TIMEOUT_MS * SEARCH_RADII_METERS.length, `nearby ${category} request`);
}

/** Same real OSM data, filtered to places whose own tagged name matches the driver's search
 *  text -- the OSM-backed equivalent of places.ts's searchPlacesByText, used by each sheet's own
 *  in-sheet search box. */
export function searchOsmPlacesByText(query: string, location: LatLng, category: OsmPoiCategory): Promise<NearbyPlace[]> {
  if (!query.trim()) return Promise.resolve([]);
  return withTimeout(
    queryWithWidening(category, location, query.trim()),
    FETCH_TIMEOUT_MS * SEARCH_RADII_METERS.length,
    `${category} text search request`
  );
}

export interface OsmPlaceBounds {
  sw: LatLng;
  ne: LatLng;
}

// Real-cost caps for the viewport ("zoom out and see everything available") layer -- a fully
// zoomed-out view over a dense city could otherwise return thousands of nodes and stall the
// map's marker layer or overload the free, shared Overpass instance. Callers (MapScreen.tsx) are
// expected to also gate the viewport SIZE this is called with -- see its own max-delta check --
// so this cap is a last-resort backstop, not the primary control.
const BBOX_MAX_RESULTS = 200;

function buildBboxQuery(category: OsmPoiCategory, bounds: OsmPlaceBounds): string {
  const bbox = `${bounds.sw.latitude},${bounds.sw.longitude},${bounds.ne.latitude},${bounds.ne.longitude}`;
  const clauses = CATEGORY_TAGS[category]
    .map(([key, value]) => {
      const tag = `["${key}"="${value}"]`;
      return `node${tag}(${bbox});way${tag}(${bbox});relation${tag}(${bbox});`;
    })
    .join("");
  return `[out:json][timeout:25];(${clauses});out center ${BBOX_MAX_RESULTS * 2};`;
}

// Same in-memory-only cache pattern as osmTrafficData.ts -- panning back and forth over the same
// area shouldn't re-hit the network every time. Keyed by category + rounded bbox.
const bboxCache = new Map<string, NearbyPlace[]>();

function bboxCacheKey(category: OsmPoiCategory, bounds: OsmPlaceBounds): string {
  const round = (n: number) => n.toFixed(3);
  return `${category}|${round(bounds.sw.latitude)},${round(bounds.sw.longitude)},${round(bounds.ne.latitude)},${round(bounds.ne.longitude)}`;
}

/** Real "everything available in view" lookup -- unlike searchNearbyOsmPlaces/
 *  searchOsmPlacesByText above (anchored to one center point, nearest-N only, capped small for
 *  a bottom-sheet list), this returns every real tagged place inside the map's current viewport
 *  bounds, for the "zoom out and see all of them" pin layer. Distance is still computed (from
 *  the viewport's own center) so results can be shown nearest-first, but nothing here is
 *  filtered down to only the closest few the way the sheet list is. */
export async function fetchOsmPlacesInBounds(bounds: OsmPlaceBounds, category: OsmPoiCategory): Promise<NearbyPlace[]> {
  const key = bboxCacheKey(category, bounds);
  const cached = bboxCache.get(key);
  if (cached) return cached;

  const center: LatLng = {
    latitude: (bounds.sw.latitude + bounds.ne.latitude) / 2,
    longitude: (bounds.sw.longitude + bounds.ne.longitude) / 2,
  };
  const data = await withTimeout(
    runOverpassQuery(buildBboxQuery(category, bounds)),
    FETCH_TIMEOUT_MS,
    `${category} viewport request`
  );
  const seen = new Set<string>();
  const results: NearbyPlace[] = [];
  for (const el of data.elements) {
    const place = elementToNearbyPlace(el, center, category);
    if (!place || seen.has(place.placeId)) continue;
    seen.add(place.placeId);
    results.push(place);
  }
  results.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const capped = results.slice(0, BBOX_MAX_RESULTS);
  bboxCache.set(key, capped);
  return capped;
}

/** True for any placeId this service produced (searchNearbyOsmPlaces/searchOsmPlacesByText) --
 *  callers that handle both Google- and OSM-sourced places (MapScreen's venue-detail lookup) use
 *  this to route to getOsmPlaceInfo below instead of Google's getPlaceInfo, which has no idea
 *  what an "osm:node:123" id is. */
export function isOsmPlaceId(placeId: string): boolean {
  return placeId.startsWith("osm:");
}

/** Real single-place detail lookup for an OSM-sourced id -- the OSM-backed equivalent of
 *  places.ts's getPlaceInfo, used when a driver taps into a fuel/restaurant/hotel result that
 *  came from searchNearbyOsmPlaces. Re-queries Overpass for just this one element's own tags
 *  (phone/website/address can be more complete than what the original list query returned,
 *  since that one also had to work for every result in the list, not just this one) rather than
 *  reusing the NearbyPlace fields already in memory. rating/userRatingsTotal/openNow/
 *  weekdayText/reviews/photoUrls all stay unset/empty -- OSM has no real equivalent, never
 *  guessed. */
export async function getOsmPlaceInfo(placeId: string): Promise<PlaceInfo> {
  const [, elementType, idStr] = placeId.split(":");
  const id = Number(idStr);
  if (!["node", "way", "relation"].includes(elementType) || !Number.isFinite(id)) {
    throw new Error(`Not a real OSM place id: ${placeId}`);
  }

  const query = `[out:json][timeout:15];(${elementType}(${id}););out tags center;`;
  const data = await withTimeout(runOverpassQuery(query), FETCH_TIMEOUT_MS, "OSM place detail request");
  const el = data.elements[0];
  if (!el) throw new Error("This place is no longer on OpenStreetMap");

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) throw new Error("This place has no real location on record");

  return {
    placeId,
    name: el.tags?.name || "Unnamed place",
    address: addressFromTags(el.tags),
    location: { latitude: lat, longitude: lon },
    phoneNumber: el.tags?.phone || el.tags?.["contact:phone"],
    website: el.tags?.website || el.tags?.["contact:website"],
    reviews: [],
    photoUrls: [],
  };
}
