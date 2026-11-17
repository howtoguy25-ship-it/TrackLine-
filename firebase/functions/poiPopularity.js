// Popularity for the brand / popular-place badges (app: src/map/poiRanking.ts).
//
//   ratingCount / businessStatus  Google Places API (New) Text Search, one place per lookup,
//                                 biased to a 100 m circle round the map's own POI and only
//                                 accepted if Google's place is within MATCH_M of it. Cached
//                                 in Firestore for CACHE_DAYS (a "no match" too), so each place
//                                 is looked up about once a month, not per view.
//   arrivals                      how many opted-in TrackLine drivers arrived there -- a bare
//                                 count per place, nothing about who.
//
// The Places key is a Firebase secret (GOOGLE_PLACES_SERVER_KEY). Without it, lookups return
// only what's cached plus arrivals -- never invented ratings.
const crypto = require("crypto");

const CACHE_DAYS = 30;
const MATCH_M = 150;
const MAX_PLACES_PER_CALL = 40;
const MAX_FETCHES_PER_CALL = 8;
const MAX_FETCHES_PER_USER_PER_DAY = 200;
const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = "places.displayName,places.location,places.userRatingCount,places.businessStatus";

const docIdFor = (key) => crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 40);

function metres(a, b) {
  const R = 6371000;
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cleanPlaces(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, MAX_PLACES_PER_CALL)
    .filter((p) => p && typeof p.key === "string" && p.key.length <= 120 && typeof p.name === "string" && p.name.length <= 80 && Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

/** One Places Text Search answer -> what we keep, or null when it isn't the same place. */
function matchPlace(response, place) {
  const top = response && Array.isArray(response.places) ? response.places[0] : null;
  if (!top || !top.location) return null;
  const d = metres(place, { lat: top.location.latitude, lng: top.location.longitude });
  if (d > MATCH_M) return null;
  return {
    ratingCount: typeof top.userRatingCount === "number" ? top.userRatingCount : null,
    businessStatus: typeof top.businessStatus === "string" ? top.businessStatus : null,
  };
}

async function fetchFromPlaces(place, { apiKey, fetchImpl }) {
  const res = await fetchImpl(PLACES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
    body: JSON.stringify({
      textQuery: place.name,
      maxResultCount: 1,
      locationBias: { circle: { center: { latitude: place.lat, longitude: place.lng }, radius: 100 } },
    }),
  });
  if (!res.ok) throw new Error(`places ${res.status}`);
  return matchPlace(await res.json(), place);
}

/**
 * store: getCached(ids) -> {id: {ratingCount, businessStatus, fetchedAtMs}}, putCached(id, v),
 *        getArrivals(ids) -> {id: count}, takeFetchBudget(uid, n, nowMs) -> allowed count
 */
async function lookup({ uid, places, store, apiKey, fetchImpl, nowMs }) {
  const list = cleanPlaces(places);
  const ids = list.map((p) => docIdFor(p.key));
  const [cached, arrivals] = await Promise.all([store.getCached(ids), store.getArrivals(ids)]);
  const fresh = (c) => c && nowMs - c.fetchedAtMs < CACHE_DAYS * 86_400_000;
  const keyed = !!apiKey && apiKey !== "unset" && apiKey !== "emulator-placeholder";
  const toFetch = keyed ? list.filter((p, i) => !fresh(cached[ids[i]])).slice(0, MAX_FETCHES_PER_CALL) : [];
  const allowed = toFetch.length ? await store.takeFetchBudget(uid, toFetch.length, nowMs) : 0;
  for (const p of toFetch.slice(0, allowed)) {
    const id = docIdFor(p.key);
    try {
      const m = await fetchFromPlaces(p, { apiKey, fetchImpl });
      const value = { ratingCount: m ? m.ratingCount : null, businessStatus: m ? m.businessStatus : null, matched: !!m, fetchedAtMs: nowMs };
      cached[id] = value;
      await store.putCached(id, value);
    } catch {
      // Google down or over quota: this place ranks without ratings this time.
    }
  }
  const out = {};
  list.forEach((p, i) => {
    const c = cached[ids[i]];
    const a = arrivals[ids[i]] || 0;
    if (!c && !a) return;
    out[p.key] = { ratingCount: c ? c.ratingCount : null, businessStatus: c ? c.businessStatus : null, arrivals: a };
  });
  return { popularity: out, configured: keyed };
}

/** An opted-in driver arrived at a place: count it once per driver per place per day. */
async function recordArrival({ uid, place, store, nowMs }) {
  const [p] = cleanPlaces([place]);
  if (!p) return { counted: false };
  const day = new Date(nowMs).toISOString().slice(0, 10);
  // The mark only proves "this driver already counted today"; it holds a hash, not the uid.
  const mark = crypto.createHash("sha256").update(`${uid}|${p.key}|${day}`).digest("hex");
  const counted = await store.countArrivalOnce(docIdFor(p.key), mark, nowMs);
  return { counted };
}

module.exports = { lookup, recordArrival, matchPlace, docIdFor, cleanPlaces, CACHE_DAYS, MATCH_M, MAX_FETCHES_PER_CALL, MAX_FETCHES_PER_USER_PER_DAY, PLACES_URL, FIELD_MASK };
