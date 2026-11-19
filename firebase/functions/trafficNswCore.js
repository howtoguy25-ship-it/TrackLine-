// Pure helpers for Live Traffic NSW (refreshNswTraffic in index.js). No Firebase or network in
// here -- turning Transport for NSW's hazard feeds into the compact list the app shows is all
// plain data handling, unit-tested in firebase/tests/trafficNswCore.test.js.
//
// Source: Transport for NSW Open Data, "Live Traffic Hazards" (GeoJSON, one feed per kind).
// The field names read below (mainCategory, headline, roads[].mainStreet, isMajor, ended,
// lastUpdated...) are that API's documented ones, but NOTHING here has ever been run against
// the live feed -- no API key has been available to this project. Every field is therefore
// read defensively: a missing or oddly-shaped one costs that detail, never the whole refresh.

// The feeds fetched, and how each is labelled in the app.
const FEEDS = [
  { kind: "incident", path: "incident" },
  { kind: "roadwork", path: "roadwork" },
  { kind: "majorevent", path: "majorevent" },
  { kind: "flood", path: "flood" },
  { kind: "fire", path: "fire" },
];

const HAZARDS_BASE_URL = "https://api.transport.nsw.gov.au/v1/live/hazards";

function feedUrl(path) {
  return `${HAZARDS_BASE_URL}/${path}/open`;
}

// One Firestore document holds the whole snapshot (1 MiB limit). Roadworks alone can run to
// many hundreds statewide, so each kind is capped, most important first.
const MAX_PER_KIND = { incident: 250, roadwork: 150, majorevent: 40, flood: 60, fire: 60 };
const MAX_TEXT = 220;

// Generous box around NSW + the ACT. Anything outside it is a bad coordinate, not a hazard.
const BOUNDS = { minLat: -38.5, maxLat: -27.5, minLng: 140.5, maxLng: 154.5 };

function cleanText(value, maxLength = MAX_TEXT) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ") // the advice fields sometimes carry markup
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function titleCase(text) {
  // The feed shouts ("PACIFIC HIGHWAY"); on a phone that reads better as "Pacific Highway".
  if (text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_m, lead, letter) => lead + letter.toUpperCase());
}

function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e11 ? value : value * 1000;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function describeRoad(road) {
  if (!road || typeof road !== "object") return "";
  const main = titleCase(cleanText(road.mainStreet, 80));
  const suburb = titleCase(cleanText(road.suburb, 60));
  const cross = titleCase(cleanText(road.crossStreet, 80));
  let text = main;
  if (cross) text += text ? ` at ${cross}` : cross;
  if (suburb) text += text ? `, ${suburb}` : suburb;
  return text;
}

/**
 * One GeoJSON feature -> one compact incident, or null if it's ended, has no usable position,
 * or has nothing to say.
 */
function parseFeature(feature, kind) {
  if (!feature || typeof feature !== "object") return null;
  const props = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
  if (props.ended === true) return null;

  const coords = feature.geometry && feature.geometry.type === "Point" ? feature.geometry.coordinates : null;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return null;

  const rawId = feature.id !== undefined && feature.id !== null ? feature.id : props.id;
  if (rawId === undefined || rawId === null || String(rawId).trim() === "") return null;

  const category = titleCase(cleanText(props.mainCategory || props.displayName, 60));
  const headline = cleanText(props.headline || props.displayName, 160);
  if (!category && !headline) return null;

  const roads = Array.isArray(props.roads) ? props.roads : [];
  const where = describeRoad(roads[0]);
  const delay = roads[0] && typeof roads[0] === "object" ? cleanText(roads[0].delay, 60) : "";
  const advice = [props.adviceA, props.adviceB, props.otherAdvice]
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_TEXT);

  return {
    id: `${kind}:${String(rawId).trim().slice(0, 60)}`,
    kind,
    category: category || "Traffic hazard",
    headline: headline ? titleCase(headline) : category,
    where,
    delay,
    advice,
    major: props.isMajor === true,
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    updatedAt: toMillis(props.lastUpdated) || toMillis(props.created) || null,
  };
}

/** A whole feed -> its incidents, de-duplicated, most important first, capped. */
function parseFeed(geojson, kind) {
  const features = geojson && Array.isArray(geojson.features) ? geojson.features : [];
  const seen = new Set();
  const incidents = [];
  for (const feature of features) {
    const incident = parseFeature(feature, kind);
    if (!incident || seen.has(incident.id)) continue;
    seen.add(incident.id);
    incidents.push(incident);
  }
  incidents.sort((a, b) => Number(b.major) - Number(a.major) || (b.updatedAt || 0) - (a.updatedAt || 0));
  return incidents.slice(0, MAX_PER_KIND[kind] || 50);
}

/**
 * The document the app reads. `results` is one entry per feed: { kind, ok, incidents }.
 * A feed that failed keeps whatever the previous snapshot had for it, so one bad response
 * doesn't blank part of the map -- and `failedKinds` says so, rather than passing old data off
 * as fresh.
 */
function buildSnapshot(results, previous, nowMs) {
  const previousIncidents = previous && Array.isArray(previous.incidents) ? previous.incidents : [];
  const incidents = [];
  const failedKinds = [];
  for (const result of results) {
    if (result.ok) {
      incidents.push(...result.incidents);
    } else {
      failedKinds.push(result.kind);
      incidents.push(...previousIncidents.filter((incident) => incident && incident.kind === result.kind));
    }
  }
  const anyOk = results.some((result) => result.ok);
  return {
    configured: true,
    // Only moves forward when something was actually fetched.
    updatedAt: anyOk ? nowMs : (previous && previous.updatedAt) || null,
    checkedAt: nowMs,
    failedKinds,
    incidents,
  };
}

module.exports = { FEEDS, feedUrl, parseFeature, parseFeed, buildSnapshot, cleanText, titleCase, MAX_PER_KIND };
