// Official NSW school zones -> compact per-tile records for the app. Pure functions (no
// Firebase), unit-tested in firebase/tests/schoolZonesCore.test.js and __tests__/schoolZones.
//
// Source: Transport for NSW "Speed Zones" dataset, School Zones data (SchoolZones.json inside
// schoolzones.zip), CC BY 4.0 -- https://opendata.transport.nsw.gov.au/data/dataset/speed-zones
// Each record: the zone's polygon (a ~12 m band along the road), speed, AM/PM hours, direction,
// school name and its operating calendar (the official term dates).

"use strict";

const SOURCE = "Transport for NSW, Speed Zones dataset (School Zones data), CC BY 4.0";
const SOURCE_URL = "https://opendata.transport.nsw.gov.au/data/dataset/speed-zones";
/** Tiles are 0.1 degree squares (~11 km). */
const TILE_DEG = 0.1;
/** Polygons are simplified to within this many metres (the bands are ~12 m wide). */
const SIMPLIFY_METERS = 1.0;

// Broken Hill keeps South Australian (Central) time; the rest of NSW keeps Sydney time. Only the
// City of Broken Hill's schools are on Central time (Wentworth, Dareton and Pomona are not).
const BROKEN_HILL = { lat: -31.955, lng: 141.455, radiusKm: 25 };

const rad = (d) => (d * Math.PI) / 180;
function km(a, b) {
  const x = rad(b[0] - a[0]) * Math.cos(rad((a[1] + b[1]) / 2));
  const y = rad(b[1] - a[1]);
  return Math.hypot(x, y) * 6371;
}

/** "08:00 AM" -> "08:00", "02:30 PM" -> "14:30", "4 PM" -> "16:00", "14:30 PM" -> "14:30". Else null. */
function to24h(t) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$/i.exec(String(t || ""));
  if (!m) return null;
  const hour = Number(m[1]);
  const pmFlag = m[3].toUpperCase() === "PM";
  // A few records write 24-hour time with a redundant PM ("14:30 PM"): unambiguous. 13-23 with
  // AM would contradict itself, so that's rejected.
  if (hour >= 13 && hour <= 23) return pmFlag ? `${hour}:${m[2] || "00"}` : null;
  if (hour < 1 || hour > 12) return null;
  let h = hour % 12;
  if (pmFlag) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2] || "00"}`;
}

/** Douglas-Peucker on [lng, lat] points, tolerance in metres. */
function simplify(points, tolMeters) {
  if (points.length <= 4) return points;
  const lat0 = rad(points[0][1]);
  const xy = points.map(([x, y]) => [rad(x) * Math.cos(lat0) * 6371000, rad(y) * 6371000]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0;
    let idx = -1;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tolMeters && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Google encoded polyline, precision 6, of [lng, lat] points (lat first in the encoding). */
function encode(points) {
  let out = "";
  let pLat = 0;
  let pLng = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of points) {
    const iLat = Math.round(lat * 1e6);
    const iLng = Math.round(lng * 1e6);
    out += enc(iLat - pLat) + enc(iLng - pLng);
    pLat = iLat;
    pLng = iLng;
  }
  return out;
}

function tileKey(lat, lng) {
  return `${Math.floor(lat / TILE_DEG)}_${Math.floor(lng / TILE_DEG)}`;
}

/** Operating calendar XML -> [[start, end], ...]. */
function parseOpCal(opCal) {
  const out = [];
  const re = /StartDate='(\d{4}-\d{2}-\d{2})'\s+EndDate='(\d{4}-\d{2}-\d{2})'\s+Recurrence='([^']*)'/g;
  let m;
  while ((m = re.exec(String(opCal || "")))) {
    // Only the weekday recurrence the data uses ("* * * 1-5 *") is understood.
    if (m[3].trim() !== "* * * 1-5 *") return null;
    out.push([m[1], m[2]]);
  }
  return out.length ? out : null;
}

/**
 * One official record -> the app's zone, or null if it can't be read with certainty (a zone we
 * can't read is left out, never guessed).
 */
function toZone(rec) {
  if (!rec || rec.SZ_TYPE !== "School" || rec.SZ_STATUS !== "Existing") return null;
  const speed = /^(\d+)\s*km\/h$/i.exec(String(rec.SZ_SPEED || ""));
  const am = [to24h(rec.START_TIME_AM), to24h(rec.END_TIME_AM)];
  const pm = [to24h(rec.START_TIME_PM), to24h(rec.END_TIME_PM)];
  const terms = parseOpCal(rec.OP_CAL);
  const g = rec.json_geometry;
  if (!speed || am.includes(null) || pm.includes(null) || !terms || !g) return null;
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : null;
  if (!rings || !rings.length) return null;
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const r of rings) {
    for (const [x, y] of r) {
      minLat = Math.min(minLat, y);
      maxLat = Math.max(maxLat, y);
      minLng = Math.min(minLng, x);
      maxLng = Math.max(maxLng, x);
    }
  }
  const centre = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  const timezone = km(centre, [BROKEN_HILL.lng, BROKEN_HILL.lat]) <= BROKEN_HILL.radiusKm ? "Australia/Broken_Hill" : "Australia/Sydney";
  return {
    id: `TfNSW-${rec.SZ_ZONE_ID}`,
    name: String(rec.SCL_NAME || "").trim() || null,
    region: "AU-NSW",
    timezone,
    speedKmh: Number(speed[1]),
    windows: [am, pm],
    lateOpening: rec.LATE_OPENING_SCHOOL === "Y",
    oneWay: rec.SZ_DIRECTION === "One Way",
    polygons: rings.map((r) => encode(simplify(r, SIMPLIFY_METERS))),
    bbox: [minLng, minLat, maxLng, maxLat],
    terms,
  };
}

/**
 * The whole file -> { tiles: { [tileKey]: zone[] }, calendar, generated, count, skipped }.
 * A zone is put in every tile its bounding box touches.
 */
function buildTiles(records) {
  const list = Array.isArray(records) ? records : [];
  const generated = list[0] && list[0].generated ? String(list[0].generated) : null;
  const tiles = {};
  let count = 0;
  let skipped = 0;
  const termSets = new Map();
  for (const rec of list) {
    if (!rec || rec.generated) continue;
    const z = toZone(rec);
    if (!z) {
      skipped++;
      continue;
    }
    count++;
    const key = JSON.stringify(z.terms);
    termSets.set(key, (termSets.get(key) || 0) + (z.lateOpening ? 0 : 1));
    const [x0, y0, x1, y1] = z.bbox;
    const keys = new Set();
    for (let y = Math.floor(y0 / TILE_DEG); y <= Math.floor(y1 / TILE_DEG); y++) {
      for (let x = Math.floor(x0 / TILE_DEG); x <= Math.floor(x1 / TILE_DEG); x++) keys.add(`${y}_${x}`);
    }
    const { terms, ...stored } = z;
    for (const k of keys) (tiles[k] = tiles[k] || []).push(stored);
  }
  // The calendar: the term set of the ordinary (not late-opening) zones, and the late one.
  const lateZone = list.find((r) => r && r.LATE_OPENING_SCHOOL === "Y" && parseOpCal(r.OP_CAL));
  const ordinary = [...termSets.entries()].sort((a, b) => b[1] - a[1])[0];
  const terms = ordinary ? JSON.parse(ordinary[0]) : null;
  const lateTerms = lateZone ? parseOpCal(lateZone.OP_CAL) : null;
  return { tiles, terms, lateTerms, generated, count, skipped };
}

/**
 * The NSW calendar document: terms from the official zone data, public holidays from the
 * official NSW list for the same year(s). A year without an official public-holiday list is
 * NOT covered (validTo stops before it), so the app marks it "calendar unknown".
 */
function nswCalendar(terms, lateTerms, publicHolidaysByYear) {
  if (!terms || !terms.length) return null;
  const years = [...new Set(terms.map(([a]) => a.slice(0, 4)))].sort();
  const covered = years.filter((y) => Array.isArray(publicHolidaysByYear[y]));
  if (!covered.length) return null;
  return {
    region: "AU-NSW",
    timezone: "Australia/Sydney",
    validFrom: `${covered[0]}-01-01`,
    validTo: `${covered[covered.length - 1]}-12-31`,
    terms: terms.filter(([a]) => covered.includes(a.slice(0, 4))),
    lateOpeningTerms: (lateTerms || []).filter(([a]) => covered.includes(a.slice(0, 4))),
    publicHolidays: covered.flatMap((y) => publicHolidaysByYear[y]),
    sources: [
      `Terms: ${SOURCE} (OP_CAL) -- ${SOURCE_URL}`,
      "Public holidays: NSW Guide to Public Holidays (industrialrelations.nsw.gov.au), via the TfNSW 'School and public holidays' dataset",
    ],
  };
}

module.exports = { SOURCE, SOURCE_URL, TILE_DEG, to24h, simplify, encode, tileKey, parseOpCal, toZone, buildTiles, nswCalendar };
