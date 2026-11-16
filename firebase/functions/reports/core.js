// Driver reports, server side: every rule a report has to pass before anyone sees it, the 3 s
// undo window, and what a "Still here" / "Not there" vote does. Pure decisions + a small store
// interface, so the same code runs against an in-memory store in tests and Firestore in
// production (index.js: submitReport, undoReport, publishPendingReport, applyReportVote).
const POLICY = require("./policy.json");

const MIN = 60_000;
const TYPES = Object.keys(POLICY.types);
const REGIONS = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

class ReportError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

function metres(a, b) {
  const R = 6371000;
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isCoord = (p) => p && typeof p.lat === "number" && typeof p.lng === "number" && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** Fresh state for a reporter who has never reported. */
function newReporterState() {
  return { log: [], undos: [], blockUntil: 0, lastBlockAt: 0, trust: POLICY.trust.start };
}

function clampTrust(t) {
  return Math.max(POLICY.trust.min, Math.min(POLICY.trust.max, t));
}

/**
 * Can this report go up? Returns the decision and the reporter's updated state (the log entry
 * and any new block are part of it, so a rejected burst still counts).
 *   reject: { action: "reject", code, message, until? }
 *   merge:  { action: "merge", alertId }    -- the same thing is already on the map
 *   create: { action: "create", needsConfirmation }
 */
function decide({ uid, input, state, nearby, nowMs }) {
  const s = { ...newReporterState(), ...(state || {}) };
  s.log = (s.log || []).filter((t) => nowMs - t < 24 * 60 * MIN);
  s.undos = (s.undos || []).filter((t) => nowMs - t < 60 * MIN);
  const reject = (code, message, extra = {}) => ({ decision: { action: "reject", code, message, ...extra }, state: s });

  if (!TYPES.includes(input.type)) return reject("bad-type", "Unknown report type.");
  if (!isCoord(input.at) || !isCoord(input.from)) return reject("bad-position", "A report needs your position and where the thing is.");
  if (metres(input.at, input.from) > POLICY.maxDistanceFromDriverM) {
    return reject("too-far", `You can only report within ${POLICY.maxDistanceFromDriverM / 1000} km of where you are.`);
  }
  if (s.blockUntil > nowMs) return reject("blocked", "Too many reports in a short time. Try again later.", { until: s.blockUntil });

  const inLast = (ms) => s.log.filter((t) => nowMs - t < ms).length;
  // Burst: this one would be the Nth inside the window -> blocked (15 min; again within a day -> 24 h).
  if (inLast(POLICY.burst.withinMinutes * MIN) + 1 >= POLICY.burst.count) {
    const repeat = s.lastBlockAt && nowMs - s.lastBlockAt < POLICY.burst.repeatWithinMinutes * MIN;
    const minutes = repeat ? POLICY.burst.repeatBlockMinutes : POLICY.burst.firstBlockMinutes;
    s.blockUntil = nowMs + minutes * MIN;
    s.lastBlockAt = nowMs;
    return reject("blocked", "Too many reports in a short time. Try again later.", { until: s.blockUntil });
  }
  if (inLast(60 * MIN) >= POLICY.maxPerHour) return reject("hourly-limit", `Up to ${POLICY.maxPerHour} reports an hour.`);
  if (s.log.length >= POLICY.maxPerDay) return reject("daily-limit", `Up to ${POLICY.maxPerDay} reports a day.`);

  // Duplicate: the same type, still up, close by.
  const dup = (nearby || [])
    .filter((a) => a.type === input.type && a.expiresAtMs > nowMs && metres(a, input.at) <= POLICY.duplicateRadiusM)
    .sort((a, b) => metres(a, input.at) - metres(b, input.at))[0];
  if (dup) {
    if (dup.createdBy === uid) return reject("duplicate", "You've already reported this.");
    s.log = [...s.log, nowMs];
    return { decision: { action: "merge", alertId: dup.id }, state: s };
  }

  s.log = [...s.log, nowMs];
  return { decision: { action: "create", needsConfirmation: s.trust < POLICY.trust.needsConfirmationBelow }, state: s };
}

/** May this reporter undo now? (max per rolling hour) Returns the updated state or a rejection. */
function decideUndo({ state, pending, uid, nowMs }) {
  const s = { ...newReporterState(), ...(state || {}) };
  s.undos = (s.undos || []).filter((t) => nowMs - t < 60 * MIN);
  if (!pending || pending.uid !== uid) return { ok: false, code: "not-found", message: "Nothing to undo.", state: s };
  if (nowMs > pending.publishAtMs) return { ok: false, code: "too-late", message: "It's already on the map.", state: s };
  if (s.undos.length >= POLICY.maxUndosPerHour) return { ok: false, code: "undo-limit", message: `You can undo ${POLICY.maxUndosPerHour} reports an hour.`, state: s };
  s.undos = [...s.undos, nowMs];
  // An undone report doesn't count towards the hourly/daily limits.
  const i = s.log.lastIndexOf(pending.createdAtMs);
  if (i >= 0) s.log = [...s.log.slice(0, i), ...s.log.slice(i + 1)];
  return { ok: true, state: s };
}

/** The alert as published, from a pending report. */
function alertFromPending(p) {
  const t = POLICY.types[p.type];
  const lifetime = (p.customTtlMs && p.customTtlMs > 0 ? Math.min(p.customTtlMs, t.maxLifeMinutes * MIN) : t.lifetimeMinutes * MIN);
  return {
    type: p.type,
    lat: p.lat,
    lng: p.lng,
    geohash: p.geohash,
    region: p.region,
    createdBy: p.uid,
    createdAtMs: p.publishAtMs,
    expiresAtMs: p.publishAtMs + lifetime,
    confirmCount: 0,
    denyCount: 0,
    thanksCount: 0,
    hiddenBy: {},
    needsConfirmation: !!p.needsConfirmation,
    lastConfirmedAtMs: p.publishAtMs,
    notThere: 0,
    ...(p.comment ? { comment: p.comment } : {}),
    ...(p.reporterName ? { reporterName: p.reporterName } : {}),
  };
}

/**
 * A "Still here" (confirm) or "Not there" (deny) vote on an alert.
 *   confirm: lives on (extended by the type's extendMinutes, capped at maxLifeMinutes from when it
 *            was posted), confirmed now, no longer needs confirmation, the not-there run resets.
 *   deny:    one more "not there"; at removeAfterNotThere in a row it's removed.
 * Returns { action: "update", patch } | { action: "delete" }, and the reporter's trust change.
 */
function applyVote(alert, vote, nowMs) {
  const t = POLICY.types[alert.type];
  if (!t) return { action: "none", trustDelta: 0 };
  if (vote === "confirm") {
    const cap = alert.createdAtMs + t.maxLifeMinutes * MIN;
    const expiresAtMs = Math.min(cap, Math.max(alert.expiresAtMs, nowMs + t.extendMinutes * MIN));
    return { action: "update", patch: { expiresAtMs, lastConfirmedAtMs: nowMs, needsConfirmation: false, notThere: 0 }, trustDelta: POLICY.trust.confirmed };
  }
  const notThere = (alert.notThere || 0) + 1;
  if (notThere >= POLICY.removeAfterNotThere) return { action: "delete", trustDelta: POLICY.trust.removed };
  return { action: "update", patch: { notThere }, trustDelta: POLICY.trust.notThere };
}

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
/** Standard geohash (the app's utils/geohash encodes the same), computed here so a client can't
 * file a report under the wrong map cell. */
function encodeGeohash(lat, lng, precision = 9) {
  let latR = [-90, 90];
  let lngR = [-180, 180];
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    const r = even ? lngR : latR;
    const v = even ? lng : lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) {
      ch = (ch << 1) | 1;
      r[0] = mid;
    } else {
      ch <<= 1;
      r[1] = mid;
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

function validateInput(data) {
  const d = data || {};
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const input = {
    type: d.type,
    at: { lat: num(d.at && d.at.lat), lng: num(d.at && d.at.lng) },
    from: { lat: num(d.from && d.from.lat), lng: num(d.from && d.from.lng) },
    region: d.region,
    geohash: "",
    comment: typeof d.comment === "string" ? d.comment.trim().split(/\s+/).slice(0, 7).join(" ").slice(0, 80) : undefined,
    customTtlMs: typeof d.customTtlMs === "number" && d.customTtlMs > 0 ? d.customTtlMs : null,
  };
  if (!REGIONS.includes(input.region)) throw new ReportError("bad-region", "Reports are for Australia for now.");
  if (isCoord(input.at)) input.geohash = encodeGeohash(input.at.lat, input.at.lng, 9);
  return input;
}

/**
 * Store interface (Firestore in production, memory in tests):
 *   transact(uid, fn)   -- runs fn(state) atomically; fn returns { state, ...result }
 *   nearby(at, type)    -- alerts of this type near `at` (id, type, lat, lng, createdBy, expiresAtMs)
 *   createPending(p)    -> id
 *   getPending(id), deletePending(id)
 *   mergeInto(alertId, voterUid)  -- counts the duplicate as a "Still here" from this reporter
 */
async function submit(store, { uid, data, reporterName, nowMs }) {
  const input = validateInput(data);
  const nearby = await store.nearby(input.at, input.type);
  const result = await store.transact(uid, (state) => {
    const { decision, state: next } = decide({ uid, input, state, nearby, nowMs });
    return { state: next, decision };
  });
  const d = result.decision;
  if (d.action === "reject") throw new ReportError(d.code, d.message, d.until ? { until: d.until } : {});
  if (d.action === "merge") {
    await store.mergeInto(d.alertId, uid, nowMs);
    return { merged: true, alertId: d.alertId };
  }
  const pending = {
    uid,
    type: input.type,
    lat: input.at.lat,
    lng: input.at.lng,
    geohash: input.geohash,
    region: input.region,
    comment: input.comment || null,
    reporterName: reporterName || null,
    customTtlMs: input.customTtlMs,
    needsConfirmation: d.needsConfirmation,
    createdAtMs: nowMs,
    publishAtMs: nowMs + POLICY.undoSeconds * 1000,
  };
  const pendingId = await store.createPending(pending);
  return { merged: false, pendingId, publishAtMs: pending.publishAtMs, needsConfirmation: d.needsConfirmation };
}

async function undo(store, { uid, pendingId, nowMs }) {
  const pending = await store.getPending(pendingId);
  const r = await store.transact(uid, (state) => {
    const out = decideUndo({ state, pending, uid, nowMs });
    return { state: out.state, out };
  });
  if (!r.out.ok) throw new ReportError(r.out.code, r.out.message);
  await store.deletePending(pendingId);
  return { undone: true };
}

module.exports = { POLICY, ReportError, metres, encodeGeohash, decide, decideUndo, alertFromPending, applyVote, clampTrust, newReporterState, submit, undo, validateInput };
