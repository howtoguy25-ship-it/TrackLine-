// Pure helpers for the presence system (no Firebase, no network) -- split out of index.js so
// they can be unit-tested directly (see firebase/tests/presencePath.test.js). The emulator
// tests deliberately run with a fake Mapbox token, so the code that turns a REAL Mapbox match
// into a timed path is otherwise never exercised by a test at all.

// Same real haversine formula as src/services/places.ts's own haversineMeters -- duplicated
// (not imported) since this is a separate Node package/runtime from the mobile app's src/, same
// reasoning as ADMIN_EMAILS' own duplication comment above.
function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Keep in sync with src/components/trackys/{parts.tsx,accessories.tsx,customization.ts}. A
// driver's own "Make your Tracky" design (ADD-ON Part A) rides along on their presence doc so
// other drivers see it -- every field is whitelisted here because this object is rendered on
// OTHER people's devices; nothing free-form is ever stored. (Whether the driver has actually
// unlocked a given accessory/trail is NOT re-checked here -- the driving streak behind those
// unlocks only exists on the driver's own device. It's a cosmetic gate, not a security one.)
const VALID_EYE_STYLES = new Set(["normal", "sleepy", "heart", "grumpy", "closedHappy", "dot"]);
const VALID_MOUTH_STYLES = new Set(["smile", "grin", "smirk", "frown", "flat", "o"]);
const VALID_ACCESSORIES = new Set([
  "sunglasses", "sparkles", "zzz", "fork", "partyHat", "headband", "cap", "roundGlasses",
  "whistle", "headphones", "umbrella", "sunHat", "bucketHat", "cake",
]);
const VALID_TRAILS = new Set(["none", "dots", "sparkle", "ghost"]);
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function sanitizeLook(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!HEX_COLOR.test(raw.color) || !VALID_EYE_STYLES.has(raw.eyeStyle) || !VALID_MOUTH_STYLES.has(raw.mouthStyle)) {
    return null;
  }
  const look = {
    color: raw.color,
    eyeStyle: raw.eyeStyle,
    mouthStyle: raw.mouthStyle,
    trail: VALID_TRAILS.has(raw.trail) ? raw.trail : "none",
  };
  if (HEX_COLOR.test(raw.colorBottom)) look.colorBottom = raw.colorBottom;
  if (VALID_ACCESSORIES.has(raw.accessory)) {
    look.accessory = raw.accessory;
    if (HEX_COLOR.test(raw.accessoryColor)) look.accessoryColor = raw.accessoryColor;
  }
  return look;
}

function isValidLatLng(lat, lng) {
  return typeof lat === "number" && typeof lng === "number" && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function roundCoord(value) {
  return Math.round(value * 1e5) / 1e5;
}

function bearingDegrees(aLat, aLng, bLat, bLng) {
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Turns Mapbox's matched road geometry (a list of [lng, lat] with no times) into timed points:
// each vertex gets a time proportional to how far along the matched line it sits, between the
// batch's own first and last real sample times. Real road shape, honestly-estimated timing
// (constant speed within one ~60s batch) -- never a fabricated position.
function timeAlongGeometry(coords, tStart, tEnd) {
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  const total = cumulative[cumulative.length - 1];
  return coords.map((c, i) => ({
    lat: c[1],
    lng: c[0],
    t: total > 0 ? tStart + ((tEnd - tStart) * cumulative[i]) / total : tStart,
  }));
}

function downsample(points, max) {
  if (points.length <= max) return points;
  const out = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
  }
  return out;
}

module.exports = {
  haversineMeters,
  sanitizeLook,
  isValidLatLng,
  roundCoord,
  bearingDegrees,
  timeAlongGeometry,
  downsample,
};
