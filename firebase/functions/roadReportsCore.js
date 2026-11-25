// Driver reports about road features the official data gets wrong or doesn't have yet: a missing
// school zone, a school zone that's wrong, or a wrong speed limit. Pure functions (no Firebase),
// unit-tested in __tests__/schoolZones/communityReports.test.ts.
//
// Moderation: a report is "pending" when filed. It goes "live" once 3 OTHER signed-in drivers
// confirm it (one confirmation per account, never the reporter's own), or when the project owner
// approves it. Only live/approved missing-school-zone reports are used by the app, and only below
// the official data and OpenStreetMap. Wrong-zone and wrong-limit reports are for review only
// (the fix goes to the source data), never applied on their own.

"use strict";

const KINDS = ["school_zone_missing", "school_zone_wrong", "speed_limit_wrong"];
const WRONG_REASONS = ["not_here", "wrong_hours", "wrong_speed"];
const CONFIRMATIONS_TO_GO_LIVE = 3;
const TILE_DEG = 0.1;

const isNum = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function tileKey(lat, lng) {
  return `${Math.floor(lat / TILE_DEG)}_${Math.floor(lng / TILE_DEG)}`;
}

/**
 * Hours windows, stored as "HH:MM-HH:MM" strings (Firestore can't hold nested arrays):
 * ["08:00-09:30", "14:30-16:00"] -> [["08:00","09:30"], ["14:30","16:00"]]. 1-3 windows, each
 * start < end. Else null.
 */
function validWindows(w) {
  if (!Array.isArray(w) || w.length < 1 || w.length > 3) return null;
  const out = [];
  for (const s of w) {
    const m = typeof s === "string" ? /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(s) : null;
    if (!m || !HHMM.test(m[1]) || !HHMM.test(m[2]) || m[1] >= m[2]) return null;
    out.push([m[1], m[2]]);
  }
  return out;
}

/**
 * A report as filed -> the cleaned report, or null if it isn't one we accept. The same checks are
 * in firestore.rules (create); this is what the function trusts before anything goes live.
 */
function validateReport(d) {
  if (!d || !KINDS.includes(d.kind) || typeof d.reportedBy !== "string" || !d.reportedBy) return null;
  if (!isNum(d.lat, -90, 90) || !isNum(d.lng, -180, 180)) return null;
  if (d.tile !== tileKey(d.lat, d.lng)) return null;
  const heading = d.heading == null ? null : isNum(d.heading, 0, 360) ? d.heading : undefined;
  if (heading === undefined) return null;
  const base = { kind: d.kind, reportedBy: d.reportedBy, lat: d.lat, lng: d.lng, tile: d.tile, heading };
  if (d.kind === "school_zone_missing") {
    const windows = validWindows(d.windows);
    const unit = d.unit === "mph" ? "mph" : d.unit === "km/h" ? "km/h" : null;
    const speedOk = unit === "mph" ? isNum(d.speed, 10, 30) : isNum(d.speed, 10, 60);
    // A zone needs a direction to be matched to the right road (not a parallel one).
    if (!windows || !unit || !speedOk || heading === null) return null;
    return { ...base, speed: d.speed, unit, windows: windows.map(([a, b]) => `${a}-${b}`) };
  }
  if (d.kind === "school_zone_wrong") {
    if (!WRONG_REASONS.includes(d.reason)) return null;
    return { ...base, reason: d.reason, zoneId: typeof d.zoneId === "string" ? d.zoneId.slice(0, 80) : null };
  }
  // speed_limit_wrong
  if (!isNum(d.postedKmh, 5, 140)) return null;
  return { ...base, postedKmh: d.postedKmh, shownKmh: isNum(d.shownKmh, 0, 200) ? d.shownKmh : null };
}

/** Distinct confirmers other than the reporter. */
function countConfirmations(reportedBy, confirmerUids) {
  return new Set((confirmerUids || []).filter((u) => typeof u === "string" && u && u !== reportedBy)).size;
}

/** The status a pending report should have given its confirmations. Admin decisions stand. */
function nextStatus(report, confirmerUids) {
  if (report.status === "approved" || report.status === "rejected") return report.status;
  return countConfirmations(report.reportedBy, confirmerUids) >= CONFIRMATIONS_TO_GO_LIVE ? "live" : "pending";
}

/**
 * The public record the app reads (communityRoadFeatures/{reportId}) for a live/approved
 * missing-school-zone report -- no reporter id. Null for every other report (review only).
 */
function toCommunityFeature(id, report) {
  if (report.kind !== "school_zone_missing") return null;
  if (report.status !== "live" && report.status !== "approved") return null;
  const r = validateReport(report);
  if (!r) return null;
  return {
    id: `community-${id}`,
    kind: "school_zone",
    lat: r.lat,
    lng: r.lng,
    tile: r.tile,
    heading: r.heading,
    speed: r.speed,
    unit: r.unit,
    windows: r.windows,
    status: report.status,
  };
}

module.exports = { KINDS, WRONG_REASONS, CONFIRMATIONS_TO_GO_LIVE, tileKey, validWindows, validateReport, countConfirmations, nextStatus, toCommunityFeature };
