// OpenStreetMap conditional speed limits for school zones, e.g.
//   maxspeed:conditional = "40 @ (Mo-Fr 08:00-09:30,14:30-16:00; SH off; PH off)"
//   maxspeed:conditional = "15 mph @ (Mo-Fr 07:30-08:30,14:30-15:30)"
// A small opening_hours evaluator for the parts school zones use: weekday ranges and lists,
// time ranges, SH (school holidays), PH (public holidays) and "off". Anything outside that
// (month/date ranges, sunrise, "||" fallbacks, week numbers...) is "unknown" -- and an unknown
// zone is never shown as active (real data only: when unsure, the normal limit).

export interface HoursContext {
  /** 1 = Monday ... 7 = Sunday */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
  /** null when the region's school calendar isn't known for this date. */
  isSchoolHoliday: boolean | null;
  isPublicHoliday: boolean | null;
}

interface Rule {
  weekdays: Set<number> | null; // null = every day
  holidays: Set<"SH" | "PH">;
  times: [number, number][] | null; // null = all day
  off: boolean;
}

const DAY: Record<string, number> = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6, Su: 7 };

function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

function parseRule(raw: string): Rule | null {
  let text = raw.trim();
  const rule: Rule = { weekdays: null, holidays: new Set(), times: null, off: false };
  if (/\s(off|closed)$/.test(` ${text}`)) {
    rule.off = true;
    text = text.replace(/\s*(off|closed)$/, "").trim();
  }
  if (!text) return rule;
  for (const token of text.split(/\s+/)) {
    if (/^\d/.test(token)) {
      // time ranges: 08:00-09:30,14:30-16:00
      const ranges: [number, number][] = [];
      for (const r of token.split(",")) {
        const [a, b] = r.split("-");
        const from = parseTime(a ?? "");
        const to = parseTime(b ?? "");
        if (from === null || to === null || to <= from) return null;
        ranges.push([from, to]);
      }
      rule.times = ranges;
      continue;
    }
    // day selectors: Mo-Fr, Sa,Su, PH, SH, Mo-Fr,PH
    const days = new Set<number>(rule.weekdays ?? []);
    for (const part of token.split(",")) {
      if (part === "SH" || part === "PH") {
        rule.holidays.add(part);
        continue;
      }
      const range = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part);
      if (!range) return null; // something we don't evaluate
      const from = DAY[range[1]];
      const to = range[2] ? DAY[range[2]] : from;
      for (let d = from; ; d = (d % 7) + 1) {
        days.add(d);
        if (d === to) break;
      }
    }
    if (days.size) rule.weekdays = days;
  }
  return rule;
}

export function parseOpeningHours(value: string): Rule[] | null {
  if (!value || value.includes("||")) return null;
  const rules: Rule[] = [];
  for (const part of value.split(";")) {
    if (!part.trim()) continue;
    const r = parseRule(part);
    if (!r) return null;
    rules.push(r);
  }
  return rules.length ? rules : null;
}

/**
 * Is the restriction in force? true / false, or null when it can't be told (unsupported syntax,
 * or it depends on a school/public-holiday calendar we don't have for this date).
 */
export function evaluateOpeningHours(value: string, ctx: HoursContext): boolean | null {
  const rules = parseOpeningHours(value);
  if (!rules) return null;
  let state = false;
  for (const r of rules) {
    let matches: boolean;
    if (r.holidays.size) {
      const sh = r.holidays.has("SH") ? ctx.isSchoolHoliday : false;
      const ph = r.holidays.has("PH") ? ctx.isPublicHoliday : false;
      if ((r.holidays.has("SH") && sh === null) || (r.holidays.has("PH") && ph === null)) return null;
      matches = !!sh || !!ph || (r.weekdays?.has(ctx.weekday) ?? false);
    } else {
      matches = r.weekdays ? r.weekdays.has(ctx.weekday) : true;
    }
    if (!matches) continue;
    // A matching rule replaces what earlier rules said about this day.
    state = r.off ? false : r.times ? r.times.some(([a, b]) => ctx.minutes >= a && ctx.minutes < b) : true;
  }
  return state;
}

/** "40 @ (Mo-Fr 08:00-09:30; SH off)" -> each limit (km/h) with its condition. */
export function parseMaxspeedConditional(value: string): { kmh: number; display: { value: number; unit: "km/h" | "mph" }; condition: string }[] | null {
  const out: { kmh: number; display: { value: number; unit: "km/h" | "mph" }; condition: string }[] = [];
  // Split at top-level ";" (not inside parentheses).
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?\s*@\s*\(?(.*?)\)?\s*$/.exec(p);
    if (!m) return null;
    const n = Number(m[1]);
    const unit = m[2] === "mph" ? "mph" : "km/h";
    out.push({ kmh: unit === "mph" ? n * 1.609344 : n, display: { value: n, unit }, condition: m[3].trim() });
  }
  return out.length ? out : null;
}
