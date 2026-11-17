// Crash history (Settings > Reports > Crash history): every real crash we've seen, kept for
// RECORD_YEARS -- Live Traffic NSW crash incidents (official, recorded as the 5-minute feed
// refresh sees them) and drivers' crash reports that someone else confirmed. The app groups
// them by place; a place with CLUSTER_MIN or more is a "crash history" spot.
const { encodeGeohash } = require("./reports/core");

const RECORD_YEARS = 3;
const YEAR_MS = 365 * 24 * 3600 * 1000;
const CRASH_RE = /\b(crash|collision|accident)/i;

/** Live Traffic NSW incidents -> crash records (same test the app uses for "Crash"). */
function recordsFromIncidents(incidents, nowMs) {
  return (incidents || [])
    .filter((i) => i && typeof i.id === "string" && Number.isFinite(i.lat) && Number.isFinite(i.lng) && i.kind !== "roadwork" && CRASH_RE.test(`${i.category || ""} ${i.headline || ""}`))
    .map((i) => ({
      id: `ltn_${i.id}`,
      lat: i.lat,
      lng: i.lng,
      geohash: encodeGeohash(i.lat, i.lng, 7),
      source: "liveTrafficNsw",
      atMs: typeof i.updatedAt === "number" ? i.updatedAt : nowMs,
      expiresAtMs: nowMs + RECORD_YEARS * YEAR_MS,
    }));
}

/** A driver's crash report as it ends: kept only if another driver confirmed it. */
function recordFromAlert(id, a, nowMs) {
  if (!a || a.type !== "crash" || !((a.confirmCount || 0) >= 1)) return null;
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) return null;
  return { id: `drv_${id}`, lat: a.lat, lng: a.lng, geohash: encodeGeohash(a.lat, a.lng, 7), source: "drivers", atMs: nowMs, expiresAtMs: nowMs + RECORD_YEARS * YEAR_MS };
}

module.exports = { recordsFromIncidents, recordFromAlert, RECORD_YEARS };
