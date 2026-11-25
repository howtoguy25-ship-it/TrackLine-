// Is this school zone in force right now? Active ONLY when today is a school day for the zone's
// region (official calendar) AND the zone's own local time is inside its hours. Weekends, school
// holidays and public holidays: inactive -- no alert, the normal limit. When the region's
// calendar doesn't cover today, the zone follows its posted hours on weekdays and says
// "calendar unknown" (never silently assumed to be a holiday).

import { dayKind, type DayKind, type SchoolCalendar } from "@/schoolZones/calendar";
import { hhmmToMinutes, instantAtLocalMinutes, localParts, minutesLabel } from "@/schoolZones/localTime";
import { evaluateOpeningHours } from "@/schoolZones/openingHours";

export interface SchoolZone {
  id: string;
  /** Where the data came from ("TfNSW", "OSM", "community"). */
  source: string;
  region: string;
  /** The zone's own timezone (Australia/Sydney; Australia/Broken_Hill for Broken Hill). */
  timezone: string;
  limit: { value: number; unit: "km/h" | "mph" };
  /** Official hours, "HH:MM" pairs in local time. */
  windows?: [string, string][];
  /** Or an OSM opening_hours condition (from maxspeed:conditional). */
  conditional?: string;
  lateOpening?: boolean;
  name?: string;
}

export interface ZoneStatus {
  active: boolean;
  reason: "inHours" | "outsideHours" | DayKind | "unknownHours";
  calendarUnknown: boolean;
  /** "until 9:30 am" while active. */
  untilLabel: string | null;
  /** When this changes next (start or end of a window today), for an exact-minute update. */
  nextChangeMs: number | null;
  limitKmh: number;
}

export function limitKmh(limit: SchoolZone["limit"]): number {
  return limit.unit === "mph" ? limit.value * 1.609344 : limit.value;
}

export function zoneStatus(zone: SchoolZone, calendar: SchoolCalendar | null | undefined, nowMs: number): ZoneStatus {
  const local = localParts(nowMs, zone.timezone);
  const kind = dayKind(calendar, local.isoDate, local.weekday, zone.lateOpening);
  const calendarUnknown = kind === "unknown";
  const base = { calendarUnknown, limitKmh: limitKmh(zone.limit) };

  if (zone.conditional) {
    const on = evaluateOpeningHours(zone.conditional, {
      weekday: local.weekday,
      minutes: local.minutes,
      isSchoolHoliday: calendarUnknown ? null : kind === "schoolHoliday",
      isPublicHoliday: calendarUnknown ? null : kind === "publicHoliday",
    });
    if (on === null) return { ...base, active: false, reason: "unknownHours", untilLabel: null, nextChangeMs: null };
    return { ...base, active: on, reason: on ? "inHours" : kind === "school" || calendarUnknown ? "outsideHours" : kind, untilLabel: null, nextChangeMs: null };
  }

  if (kind === "weekend" || kind === "schoolHoliday" || kind === "publicHoliday") {
    return { ...base, active: false, reason: kind, untilLabel: null, nextChangeMs: null };
  }
  const windows = (zone.windows ?? []).map(([a, b]) => [hhmmToMinutes(a), hhmmToMinutes(b)] as const);
  for (const [a, b] of windows) {
    if (local.minutes >= a && local.minutes < b) {
      return { ...base, active: true, reason: "inHours", untilLabel: `until ${minutesLabel(b)}`, nextChangeMs: instantAtLocalMinutes(nowMs, zone.timezone, b) };
    }
  }
  const nextStart = windows.map(([a]) => a).filter((a) => a > local.minutes).sort((x, y) => x - y)[0];
  return {
    ...base,
    active: false,
    reason: "outsideHours",
    untilLabel: null,
    nextChangeMs: nextStart !== undefined ? instantAtLocalMinutes(nowMs, zone.timezone, nextStart) : null,
  };
}
