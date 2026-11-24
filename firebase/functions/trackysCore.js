// "Trackys around you" + the home privacy zone (startup §2-3). Pure rules, no Firestore here --
// index.js does the reads/writes. Tested without the emulator in firebase/tests/trackysCore.test.js
// and end to end in firebase/tests/trackys.test.js.
//
//  * The count: TrackLine users active in the last 15 minutes around you. The area grows until it
//    has enough people to mean something: 10 km, then 25, 50, then the whole region (150 km).
//    Ghost-mode users count as a number only. Under 10 it says "A few"; above, nearest 10.
//  * Private zones: nobody is shown to others within 400 m of their Home, Work, where this trip
//    started, or its destination -- nor, if they have no Home saved, of the first place they used
//    the app tonight (10 pm - 6 am, stationary).
const { encodeGeohash } = require("./reports/core");
const { haversineMeters } = require("./presencePath");

const PRIVACY_ZONE_M = 400;
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const AREA_STEPS_KM = [10, 25, 50, 150];
const MIN_USERS_FOR_AREA = 20;
const COUNT_CACHE_MS = 60 * 1000;
/** Positions kept for counting only, rounded to ~1 km, and never readable by any client. */
const ACTIVITY_ROUND_DEG = 0.01;
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;
/** Geohash length for each search step: one cell plus its 8 neighbours covers the step. */
const STEP_PRECISION = { 10: 4, 25: 3, 50: 3, 150: 2 };
const PRESENCE_GEOHASH_PRECISION = 6;

const isCoord = (lat, lng) => typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const roundTo = (v, step) => Math.round(v / step) * step;

/** "A few Trackys around you" under 10; otherwise the nearest 10 (never the exact number). */
function roundCount(n) {
  if (!Number.isFinite(n) || n < 10) return { few: true, count: null };
  return { few: false, count: Math.round(n / 10) * 10 };
}

/** The smallest step with at least MIN_USERS_FOR_AREA people, else the largest. */
function pickArea(countsByKm) {
  for (const km of AREA_STEPS_KM) if ((countsByKm[km] ?? 0) >= MIN_USERS_FOR_AREA) return km;
  return AREA_STEPS_KM[AREA_STEPS_KM.length - 1];
}

/** Count active people per step around a centre (excluding the asker). */
function countSteps(centre, people, now, selfUid) {
  const out = {};
  for (const km of AREA_STEPS_KM) out[km] = 0;
  for (const p of people) {
    if (p.uid === selfUid || !isCoord(p.lat, p.lng) || typeof p.lastActive !== "number" || now - p.lastActive > ACTIVE_WINDOW_MS) continue;
    const d = haversineMeters(centre.lat, centre.lng, p.lat, p.lng) / 1000;
    for (const km of AREA_STEPS_KM) if (d <= km) out[km] += 1;
  }
  return out;
}

/** The answer the app gets: rounded count, the area used -- never anyone's position. */
function trackysAround(centre, people, now, selfUid) {
  const counts = countSteps(centre, people, now, selfUid);
  const km = pickArea(counts);
  return { ...roundCount(counts[km]), radiusKm: km };
}

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
/** The 8 neighbours of a geohash cell (plus itself): the cells a radius query must cover. */
function cellAndNeighbours(lat, lng, precision) {
  // Cell size at this precision, by decoding the bounds of the centre cell.
  const hash = encodeGeohash(lat, lng, precision);
  const bounds = decodeBounds(hash);
  const dLat = bounds.latMax - bounds.latMin;
  const dLng = bounds.lngMax - bounds.lngMin;
  const set = new Set();
  for (const y of [-1, 0, 1]) {
    for (const x of [-1, 0, 1]) {
      const la = Math.max(-89.999, Math.min(89.999, (bounds.latMin + bounds.latMax) / 2 + y * dLat));
      let lo = (bounds.lngMin + bounds.lngMax) / 2 + x * dLng;
      if (lo > 180) lo -= 360;
      if (lo < -180) lo += 360;
      set.add(encodeGeohash(la, lo, precision));
    }
  }
  return [...set];
}

function decodeBounds(hash) {
  let even = true;
  const lat = [-90, 90];
  const lng = [-180, 180];
  for (const ch of hash) {
    const v = BASE32.indexOf(ch);
    for (let bit = 4; bit >= 0; bit--) {
      const on = (v >> bit) & 1;
      const r = even ? lng : lat;
      const mid = (r[0] + r[1]) / 2;
      if (on) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return { latMin: lat[0], latMax: lat[1], lngMin: lng[0], lngMax: lng[1] };
}

/** What's stored per active user for counting (server-only collection `activity`). */
function activityDoc({ lat, lng, ghost, now }) {
  const rl = roundTo(lat, ACTIVITY_ROUND_DEG);
  const rg = roundTo(lng, ACTIVITY_ROUND_DEG);
  return {
    lat: Math.round(rl * 100) / 100,
    lng: Math.round(rg * 100) / 100,
    gh2: encodeGeohash(rl, rg, 2),
    gh3: encodeGeohash(rl, rg, 3),
    gh4: encodeGeohash(rl, rg, 4),
    ghost: ghost === true,
    lastActive: now,
  };
}

/** Night = 10 pm to 6 am, by the phone's local hour. */
function isNightHour(localHour) {
  return typeof localHour === "number" && (localHour >= NIGHT_START_HOUR || localHour < NIGHT_END_HOUR);
}

/**
 * With no Home saved, the first place the app is used each night while standing still becomes a
 * private zone for that night (and stays until the next night's one replaces it).
 */
function shouldSetNightZone({ hasHome, localHour, stationary, dayKey, existingDayKey }) {
  if (hasHome || !stationary || !isNightHour(localHour) || typeof dayKey !== "string" || !dayKey) return false;
  return existingDayKey !== dayKey;
}

/**
 * The "night" a local time belongs to: 10 pm-midnight counts as that date, midnight-6 am as the
 * previous date, so one night is one key.
 */
function nightKey(localDate, localHour) {
  if (typeof localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
  if (localHour >= NIGHT_START_HOUR) return localDate;
  const d = new Date(`${localDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Every private zone centre for this user and trip. */
function privateZones({ home, work, nightZone, tripStart, destination }) {
  const out = [];
  for (const p of [home, work, nightZone, tripStart, destination]) {
    if (p && isCoord(p.latitude, p.longitude)) out.push({ latitude: p.latitude, longitude: p.longitude });
  }
  return out;
}

function insideAnyZone(lat, lng, zones, radiusM = PRIVACY_ZONE_M) {
  return zones.some((z) => haversineMeters(lat, lng, z.latitude, z.longitude) < radiusM);
}

module.exports = {
  PRIVACY_ZONE_M,
  ACTIVE_WINDOW_MS,
  AREA_STEPS_KM,
  MIN_USERS_FOR_AREA,
  COUNT_CACHE_MS,
  STEP_PRECISION,
  PRESENCE_GEOHASH_PRECISION,
  roundCount,
  pickArea,
  countSteps,
  trackysAround,
  cellAndNeighbours,
  decodeBounds,
  activityDoc,
  isNightHour,
  shouldSetNightZone,
  nightKey,
  privateZones,
  insideAnyZone,
  isCoord,
};
