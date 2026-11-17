// NSW FuelCheck live prices (fuelPricesNearby in index.js). The app never sees the key: it asks
// this function for prices near a point for one fuel type, and gets back stations with their
// price and when it was last updated. Pure apart from the injected fetch, unit-tested in
// firebase/tests/fuelCheckCore.test.js.
//
// Source: NSW Government Fuel API (api.nsw.gov.au, "Fuel API" product): OAuth client-credentials
// token, then POST /FuelPriceCheck/v1/fuel/prices/nearby. Field names below are that API's
// documented ones, read defensively; NOTHING here has been run against the live API from this
// project (no key available while writing it). A missing field costs that station, never the
// whole answer.

const TOKEN_URL = "https://api.onegov.nsw.gov.au/oauth/client_credential/accesstoken?grant_type=client_credentials";
const NEARBY_URL = "https://api.onegov.nsw.gov.au/FuelPriceCheck/v1/fuel/prices/nearby";
const FUEL_TYPES = new Set(["E10", "U91", "P95", "P98", "DL", "PDL", "LPG", "E85", "B20", "EV"]);
const MAX_RADIUS_KM = 25;

function isConfigured(key, secret) {
  return typeof key === "string" && typeof secret === "string" && key.length > 8 && secret.length > 8 && key !== "unset" && secret !== "unset";
}

/** "17/11/2026 09:05:00 AM" style timestamp the API wants on each request (Sydney time). */
function requestTimestamp(nowMs) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(new Date(nowMs));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")} ${get("dayPeriod").toUpperCase()}`;
}

/** "17/11/2026 08:41:12" (Sydney local) → epoch ms. Returns null when it can't be read. */
function parseLastUpdated(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(String(s || "").trim());
  if (!m) return null;
  let hour = Number(m[4]);
  if (m[7]) hour = (hour % 12) + (m[7].toUpperCase() === "PM" ? 12 : 0);
  // Sydney is UTC+10 or +11; work out which for that date from Intl.
  const guess = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), hour, Number(m[5]), Number(m[6] || 0));
  const offsetMin = sydneyOffsetMinutes(guess);
  return guess - offsetMin * 60_000;
}

function sydneyOffsetMinutes(utcMs) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", timeZoneName: "shortOffset" }).formatToParts(new Date(utcMs));
  const tz = (parts.find((p) => p.type === "timeZoneName") || {}).value || "GMT+10";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tz);
  if (!m) return 600;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** Validated request from the app, or an error message. */
function parseRequest(data) {
  const lat = Number(data && data.lat);
  const lng = Number(data && data.lng);
  const fuelType = String((data && data.fuelType) || "");
  const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(1, Number((data && data.radiusKm) || 5)));
  // A rough NSW box: outside it FuelCheck has nothing, so the app is told plainly.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat > -28.1 || lat < -37.6 || lng < 140.9 || lng > 153.7) {
    return { error: "FuelCheck covers New South Wales only." };
  }
  if (!FUEL_TYPES.has(fuelType)) return { error: "Unknown fuel type." };
  return { lat, lng, fuelType, radiusKm };
}

/** API answer → [{ code, name, brand, address, lat, lng, centsPerLitre, updatedMs }]. */
function parseNearby(json) {
  const stations = Array.isArray(json && json.stations) ? json.stations : [];
  const prices = Array.isArray(json && json.prices) ? json.prices : [];
  const byCode = new Map();
  for (const p of prices) {
    const code = String(p && p.stationcode);
    const price = Number(p && p.price);
    if (!code || !Number.isFinite(price) || price <= 0) continue;
    byCode.set(code, { centsPerLitre: price, updatedMs: parseLastUpdated(p.lastupdated) });
  }
  const out = [];
  for (const s of stations) {
    const code = String(s && s.code);
    const price = byCode.get(code);
    const lat = Number(s && s.location && s.location.latitude);
    const lng = Number(s && s.location && s.location.longitude);
    if (!price || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      code,
      name: String(s.name || ""),
      brand: String(s.brand || ""),
      address: String(s.address || ""),
      lat,
      lng,
      centsPerLitre: price.centsPerLitre,
      updatedMs: price.updatedMs,
    });
  }
  return out;
}

/** One lookup: token, then nearby prices. Throws with a plain message on failure. */
async function fetchNearbyPrices({ key, secret, request, fetchImpl, nowMs, uuid }) {
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
  });
  if (!tokenRes.ok) throw new Error(`FuelCheck sign-in failed (HTTP ${tokenRes.status})`);
  const token = (await tokenRes.json().catch(() => ({}))).access_token;
  if (!token) throw new Error("FuelCheck sign-in gave no token");
  const res = await fetchImpl(NEARBY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      apikey: key,
      Authorization: `Bearer ${token}`,
      transactionid: uuid,
      requesttimestamp: requestTimestamp(nowMs),
    },
    body: JSON.stringify({
      fueltype: request.fuelType,
      brand: [],
      namedlocation: "",
      latitude: String(request.lat),
      longitude: String(request.lng),
      radius: String(request.radiusKm),
      sortby: "distance",
      sortascending: "true",
    }),
  });
  if (!res.ok) throw new Error(`FuelCheck prices failed (HTTP ${res.status})`);
  return parseNearby(await res.json());
}

module.exports = { isConfigured, requestTimestamp, parseLastUpdated, parseRequest, parseNearby, fetchNearbyPrices, TOKEN_URL, NEARBY_URL };
