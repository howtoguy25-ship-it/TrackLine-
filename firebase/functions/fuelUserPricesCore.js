// Driver-reported fuel prices (gap item 18). A price a driver types in is never shown on its own:
// it shows only once 3 different drivers have reported the same fuel at the same station within
// 2 cents of each other in the last 24 hours (then the middle of their prices). Official FuelCheck
// and Google prices always come first in the app; these fill the gaps. Pure; tested in
// firebase/tests/fuelUserPrices.test.js. Written only by the reportFuelPrice callable.
const FUELS = ["E10", "91", "95", "98", "diesel", "lpg"];
const CONFIRMATIONS = 3;
const AGREE_CENTS = 2;
const WINDOW_MS = 24 * 3600_000;
const SAME_DRIVER_GAP_MS = 10 * 60_000;
const MAX_FROM_STATION_M = 500;

function metres(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The callable's input, checked. Returns { error } or the clean values. */
function parseReport(d) {
  if (!d || typeof d !== "object") return { error: "Nothing to report." };
  const placeId = typeof d.placeId === "string" && /^[A-Za-z0-9_-]{6,200}$/.test(d.placeId) ? d.placeId : null;
  if (!placeId) return { error: "Unknown station." };
  if (!FUELS.includes(d.fuelType)) return { error: "Pick a fuel type." };
  const cents = Math.round(Number(d.cents) * 10) / 10;
  if (!Number.isFinite(cents) || cents < 80 || cents > 400) return { error: "That price doesn't look right (cents per litre, e.g. 189.9)." };
  const nums = [d.lat, d.lng, d.stationLat, d.stationLng].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return { error: "Your location is needed to report a price." };
  if (metres(nums[0], nums[1], nums[2], nums[3]) > MAX_FROM_STATION_M) return { error: "Report prices when you're at the station." };
  return { placeId, fuelType: d.fuelType, cents, name: typeof d.name === "string" ? d.name.slice(0, 120) : null, stationLat: nums[2], stationLng: nums[3] };
}

/** The confirmed price from recent reports (one per driver), or null. */
function confirmed(reports, nowMs) {
  const recent = latestPerDriver(reports).filter((r) => nowMs - r.atMs <= WINDOW_MS);
  let best = null;
  for (const r of recent) {
    const agree = recent.filter((x) => Math.abs(x.cents - r.cents) <= AGREE_CENTS);
    if (agree.length >= CONFIRMATIONS && (!best || agree.length > best.length)) best = agree;
  }
  if (!best) return null;
  const sorted = best.map((x) => x.cents).sort((a, b) => a - b);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { cents: Math.round(mid * 10) / 10, drivers: best.length, atMs: Math.max(...best.map((x) => x.atMs)) };
}

function latestPerDriver(reports) {
  const by = new Map();
  for (const r of reports || []) if (!by.has(r.uid) || by.get(r.uid).atMs < r.atMs) by.set(r.uid, r);
  return [...by.values()];
}

/**
 * The station/fuel document after one report: old (>24 h) reports dropped, one per driver, and the
 * confirmed price worked out again. Throws { code } when the same driver reports again too soon.
 */
function applyReport(docData, report, nowMs) {
  const prev = (docData && Array.isArray(docData.reports) ? docData.reports : []).filter((r) => nowMs - r.atMs <= WINDOW_MS);
  const mine = prev.find((r) => r.uid === report.uid);
  if (mine && nowMs - mine.atMs < SAME_DRIVER_GAP_MS) {
    const e = new Error("You've just reported this price. Try again in a few minutes.");
    e.code = "resource-exhausted";
    throw e;
  }
  const reports = [...prev.filter((r) => r.uid !== report.uid), { uid: report.uid, cents: report.cents, atMs: nowMs }];
  return { reports, confirmed: confirmed(reports, nowMs), updatedAtMs: nowMs };
}

function docId(placeId, fuelType) {
  return `${placeId}__${fuelType}`;
}

module.exports = { FUELS, CONFIRMATIONS, AGREE_CENTS, WINDOW_MS, SAME_DRIVER_GAP_MS, MAX_FROM_STATION_M, parseReport, confirmed, applyReport, docId };
