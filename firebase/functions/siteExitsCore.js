// Fix pass 7 §1: smart exit gates -- the server side of "is the exit on <road> open?".
//
// One Firestore doc per exit (an OSM gate/barrier node): siteExits/{gateId}. Drivers' answers are
// anonymous (a one-way hash of uid + gate, so the same driver counts once but can't be traced),
// kept for 60 days, at most 60 per exit. From them, per time bucket (weekday/weekend x five parts
// of the day, in the site's local time -- the phone sends its bucket), the exit's pattern: closed
// or open once at least 3 recent answers agree (75 %+). The owner can set/confirm opening hours
// from the dashboard. Pure (no Firestore here); tested in firebase/tests/siteExits.test.js.
const crypto = require("crypto");

const DAY_TYPES = ["weekday", "weekend"];
const BANDS = ["night", "morning", "day", "afternoon", "evening"];
const BUCKETS = DAY_TYPES.flatMap((d) => BANDS.map((b) => `${d}-${b}`));
const WINDOW_MS = 60 * 24 * 3600 * 1000;
const MAX_ANSWERS = 60;
/** One driver's answers for one exit within this time count once (the latest). */
const SAME_DRIVER_MS = 6 * 3600 * 1000;
const PATTERN_MIN = 3;
const PATTERN_AGREE = 0.75;

/** The phone's local time -> bucket (also used by the tests; the app has the same function). */
function bucketFor(date) {
  const day = date.getDay();
  const h = date.getHours();
  const dayType = day === 0 || day === 6 ? "weekend" : "weekday";
  const band = h < 6 ? "night" : h < 10 ? "morning" : h < 15 ? "day" : h < 19 ? "afternoon" : "evening";
  return `${dayType}-${band}`;
}

function parseAnswer(data) {
  const d = data || {};
  if (typeof d.gateId !== "string" || !/^[nw]\d{1,15}$/.test(d.gateId)) return { error: "Unknown exit." };
  if (d.siteId != null && (typeof d.siteId !== "string" || !/^[wr]\d{1,15}$/.test(d.siteId))) return { error: "Unknown site." };
  if (typeof d.open !== "boolean") return { error: "Say whether it's open." };
  if (!BUCKETS.includes(d.bucket)) return { error: "Unknown time of day." };
  const lat = Number(d.lat);
  const lng = Number(d.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "Where is the exit?" };
  const label = typeof d.label === "string" ? d.label.slice(0, 60) : null;
  return { gateId: d.gateId, siteId: d.siteId || null, open: d.open, bucket: d.bucket, lat, lng, label };
}

function voterKey(uid, gateId) {
  return crypto.createHash("sha256").update(`${uid}|${gateId}|trackline-site-exits`).digest("hex").slice(0, 16);
}

/** The pattern for one bucket from the recent answers. */
function patternFor(answers, bucket, nowMs) {
  const recent = (answers || []).filter((a) => a.bucket === bucket && nowMs - a.atMs <= WINDOW_MS);
  const open = recent.filter((a) => a.open).length;
  const closed = recent.length - open;
  let state = "unknown";
  if (closed >= PATTERN_MIN && closed / recent.length >= PATTERN_AGREE) state = "closed";
  else if (open >= PATTERN_MIN && open / recent.length >= PATTERN_AGREE) state = "open";
  return { state, open, closed };
}

/** A new answer applied to an exit's doc (null = first answer). Returns the new doc. */
function applyAnswer(doc, a, nowMs) {
  const prev = doc || { answers: [] };
  let answers = (prev.answers || []).filter((x) => nowMs - x.atMs <= WINDOW_MS);
  // The same driver within 6 h: the new answer replaces theirs.
  answers = answers.filter((x) => !(x.voter === a.voter && nowMs - x.atMs < SAME_DRIVER_MS));
  answers.push({ voter: a.voter, open: a.open, bucket: a.bucket, atMs: nowMs });
  answers = answers.slice(-MAX_ANSWERS);
  const patterns = {};
  for (const b of BUCKETS) {
    const p = patternFor(answers, b, nowMs);
    if (p.open + p.closed > 0) patterns[b] = p;
  }
  return {
    ...prev,
    gateId: a.gateId,
    siteId: a.siteId ?? prev.siteId ?? null,
    lat: a.lat,
    lng: a.lng,
    label: a.label ?? prev.label ?? null,
    answers,
    patterns,
    summary: summarise(patterns),
    updatedAtMs: nowMs,
  };
}

/** A short human summary of the closed buckets ("Closed weekends", "Closed evenings"...). */
function summarise(patterns) {
  const closed = Object.entries(patterns || {})
    .filter(([, p]) => p.state === "closed")
    .map(([b]) => b);
  if (closed.length === 0) return null;
  const weekend = BANDS.every((b) => closed.includes(`weekend-${b}`));
  const evenings = DAY_TYPES.every((d) => closed.includes(`${d}-evening`) && closed.includes(`${d}-night`));
  if (weekend && evenings) return "Closed weekends and after 7 pm";
  if (weekend) return "Closed weekends";
  if (evenings) return "Closed after 7 pm";
  return `Closed at times (${closed.join(", ")})`;
}

/** The owner's opening hours for an exit (free text like "Mon-Fri 6am-6pm", max 80 chars). */
function parseHours(data) {
  const d = data || {};
  if (typeof d.gateId !== "string" || !/^[nw]\d{1,15}$/.test(d.gateId)) return { error: "Unknown exit." };
  const hours = d.hours == null ? null : String(d.hours).trim().slice(0, 80);
  return { gateId: d.gateId, hours: hours || null, confirmed: !!d.confirmed };
}

module.exports = {
  BUCKETS,
  WINDOW_MS,
  MAX_ANSWERS,
  SAME_DRIVER_MS,
  PATTERN_MIN,
  PATTERN_AGREE,
  bucketFor,
  parseAnswer,
  voterKey,
  patternFor,
  applyAnswer,
  summarise,
  parseHours,
};
