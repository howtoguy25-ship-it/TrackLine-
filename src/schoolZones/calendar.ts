// School days per region, from official calendars (src/data/schoolCalendars/*, refreshed yearly
// into Firestore "schoolCalendars" by a Cloud Function). A date outside the calendar's range is
// "unknown" -- never silently treated as a holiday.

export interface SchoolCalendar {
  region: string;
  timezone: string;
  validFrom: string;
  validTo: string;
  /** Inclusive [start, end] ISO dates of each term. */
  terms: [string, string][];
  /** Some schools start later (NSW: late-opening schools); the zone data says which. */
  lateOpeningTerms?: [string, string][];
  publicHolidays: string[];
  sources?: string[];
  lastVerified?: string;
}

export type DayKind = "school" | "weekend" | "schoolHoliday" | "publicHoliday" | "unknown";

const inRange = (d: string, [a, b]: [string, string]) => d >= a && d <= b;

/** What kind of day `isoDate` is for school zones in this calendar. */
export function dayKind(cal: SchoolCalendar | null | undefined, isoDate: string, weekday: number, lateOpening = false): DayKind {
  if (weekday === 6 || weekday === 7) return "weekend";
  if (!cal || isoDate < cal.validFrom || isoDate > cal.validTo) return "unknown";
  if (cal.publicHolidays.includes(isoDate)) return "publicHoliday";
  const terms = lateOpening && cal.lateOpeningTerms ? cal.lateOpeningTerms : cal.terms;
  return terms.some((t) => inRange(isoDate, t)) ? "school" : "schoolHoliday";
}

/** A calendar from JSON (bundled or Firestore), shape-checked. Null if it doesn't look right. */
export function asSchoolCalendar(raw: unknown): SchoolCalendar | null {
  const c = raw as Partial<SchoolCalendar> | null;
  const pairs = (v: unknown): v is [string, string][] =>
    Array.isArray(v) && v.every((t) => Array.isArray(t) && t.length === 2 && typeof t[0] === "string" && typeof t[1] === "string");
  if (!c || typeof c.region !== "string" || typeof c.timezone !== "string" || !pairs(c.terms) || !Array.isArray(c.publicHolidays)) return null;
  if (typeof c.validFrom !== "string" || typeof c.validTo !== "string") return null;
  if (c.lateOpeningTerms !== undefined && !pairs(c.lateOpeningTerms)) return null;
  return c as SchoolCalendar;
}
