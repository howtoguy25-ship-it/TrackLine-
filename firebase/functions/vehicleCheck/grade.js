// Green / amber / red for each report section, from the provider's data only. Also the odometer
// history check: readings in date order, the latest one, and any going backwards (a possible
// rollback) or not adding up.

const DAY_MS = 86_400_000;
/** A reading this many km below an earlier one is a rollback, not a typo-level wobble. */
const ROLLBACK_TOLERANCE_KM = 100;
/** More than this per day between two readings doesn't add up (that's ~1,500 km every day). */
const MAX_PLAUSIBLE_KM_PER_DAY = 1500;
/** Registration expiring this soon is amber. */
const REGO_WARN_DAYS = 30;

function analyseOdometer(readings) {
  const list = (Array.isArray(readings) ? readings : [])
    .filter((r) => r && typeof r.km === "number" && Number.isFinite(r.km) && r.km >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)))
    .map((r) => ({ date: r.date, km: r.km, source: r.source ?? null }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const issues = [];
  let maxSoFar = null;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (maxSoFar && r.km < maxSoFar.km - ROLLBACK_TOLERANCE_KM) {
      issues.push({ kind: "rollback", date: r.date, km: r.km, earlierKm: maxSoFar.km, earlierDate: maxSoFar.date });
    }
    if (i > 0) {
      const prev = list[i - 1];
      const days = (Date.parse(r.date) - Date.parse(prev.date)) / DAY_MS;
      if (days === 0 && r.km !== prev.km) issues.push({ kind: "conflict", date: r.date, km: r.km, earlierKm: prev.km });
      else if (days > 0 && (r.km - prev.km) / days > MAX_PLAUSIBLE_KM_PER_DAY) {
        issues.push({ kind: "implausible", date: r.date, km: r.km, earlierKm: prev.km, earlierDate: prev.date });
      }
    }
    if (!maxSoFar || r.km > maxSoFar.km) maxSoFar = r;
  }
  return { readings: list, latest: list.length ? list[list.length - 1] : null, issues };
}

function daysBetween(fromIso, toIso) {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
}

/** "Registered" / "Current" read as current; cancelled, expired, lapsed, unregistered don't. */
function regoIsCurrent(status) {
  const s = String(status || "").toLowerCase();
  if (!s) return null;
  if (/(cancel|expire|lapse|unregist|not regist|suspend)/.test(s)) return false;
  if (/(regist|current|active)/.test(s)) return true;
  return null;
}

/** -> { grade: "green"|"amber"|"red", summary } for a section with data. */
function gradeSection(key, data, today) {
  switch (key) {
    case "vehicle":
      return { grade: "green", summary: [data.year, data.make, data.model].filter(Boolean).join(" ") || "Vehicle found" };
    case "registration": {
      const current = regoIsCurrent(data.status);
      if (current === false) return { grade: "red", summary: `Not currently registered (${data.status})` };
      if (data.expiry && /^\d{4}-\d{2}-\d{2}$/.test(data.expiry)) {
        const left = daysBetween(today, data.expiry);
        if (left < 0) return { grade: "red", summary: `Registration expired ${data.expiry}` };
        if (left <= REGO_WARN_DAYS) return { grade: "amber", summary: `Registration expires ${data.expiry}` };
        if (current) return { grade: "green", summary: `Registered until ${data.expiry}` };
      }
      return { grade: "amber", summary: data.status ? `Status: ${data.status}` : "Registration status not given" };
    }
    case "writtenOff": {
      if (!data.writtenOff) return { grade: "green", summary: "No write-off recorded" };
      const statutory = data.records.some((r) => r.category === "statutory");
      const repairableOnly = data.records.every((r) => r.category === "repairable");
      if (statutory) return { grade: "red", summary: "Statutory write-off recorded" };
      if (repairableOnly) return { grade: "amber", summary: "Repairable write-off recorded" };
      return { grade: "red", summary: "Write-off recorded" };
    }
    case "stolen":
      return data.stolen ? { grade: "red", summary: "Reported stolen" } : { grade: "green", summary: "Not reported stolen" };
    case "ppsr":
      return data.securedInterests > 0
        ? { grade: "red", summary: `${data.securedInterests} security interest${data.securedInterests === 1 ? "" : "s"} registered (possible finance owing)` }
        : { grade: "green", summary: "No security interests registered" };
    case "odometer": {
      const a = analyseOdometer(data.readings);
      if (a.readings.length === 0) return { grade: "amber", summary: "No odometer readings on record" };
      if (a.issues.some((i) => i.kind === "rollback")) return { grade: "red", summary: "Odometer went backwards: possible rollback" };
      if (a.issues.length) return { grade: "amber", summary: "Odometer readings don't add up" };
      return { grade: "green", summary: `Latest reading ${a.latest.km.toLocaleString("en-AU")} km (${a.latest.date})` };
    }
    case "recalls":
      return Array.isArray(data.recalls) && data.recalls.length
        ? { grade: "amber", summary: `${data.recalls.length} recall${data.recalls.length === 1 ? "" : "s"} returned` }
        : { grade: "green", summary: "No recalls returned" };
    default:
      return { grade: "amber", summary: "" };
  }
}

module.exports = { analyseOdometer, gradeSection, regoIsCurrent, ROLLBACK_TOLERANCE_KM, MAX_PLAUSIBLE_KM_PER_DAY, REGO_WARN_DAYS };
