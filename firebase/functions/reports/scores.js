// Points, levels and badges (gap item 15): pure, shared rules in scores.json. The report store
// (store.js) calls applyScore inside the same transactions that publish a report and apply a vote,
// so points only ever follow something the server itself did. scores/{uid} is written only here.
const SCORES = require("./scores.json");

/** "2026-W48": the week (Monday start, Sydney time) a weekly leaderboard counts in. */
function weekKey(nowMs) {
  const d = new Date(nowMs + 10 * 3600_000); // AEST; a day either side of DST doesn't change the week
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  const thursday = new Date(monday.getTime() + 3 * 86400_000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / (7 * 86400_000)) + 1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function levelFor(points) {
  let level = SCORES.levels[0];
  for (const l of SCORES.levels) if (points >= l.min) level = l;
  return level.name;
}

const COUNTER = { reportPublished: "reports", confirmedByOther: "confirmationsReceived", vote: "votes", reportRemoved: null };

/** The score after one event. `name` is kept only when the driver chose to show it on reports. */
function applyScore(score, event, nowMs, name) {
  const s = { points: 0, weekKey: weekKey(nowMs), weekPoints: 0, reports: 0, confirmationsReceived: 0, votes: 0, name: null, ...(score || {}) };
  const wk = weekKey(nowMs);
  if (s.weekKey !== wk) {
    s.weekKey = wk;
    s.weekPoints = 0;
  }
  const delta = SCORES.points[event] || 0;
  s.points = Math.max(0, s.points + delta);
  s.weekPoints = Math.max(0, s.weekPoints + delta);
  const counter = COUNTER[event];
  if (counter) s[counter] = (s[counter] || 0) + 1;
  if (name !== undefined) s.name = name || null;
  s.level = levelFor(s.points);
  s.updatedAtMs = nowMs;
  return s;
}

module.exports = { SCORES, weekKey, levelFor, applyScore };
