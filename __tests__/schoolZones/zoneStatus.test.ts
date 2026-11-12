// School zones: official NSW data (Transport for NSW School Zones data, zone 463859, St Philip's
// Christian College Waratah: 40 km/h, 8:00-9:30 am and 2:30-4:00 pm) and the official 2026 NSW
// calendar (terms from the same data, public holidays from the NSW guide).
import { describe, expect, it } from "@jest/globals";
import nsw from "@/data/schoolCalendars/AU-NSW.json";
import rules from "@/data/schoolZoneRules.json";
import { zoneStatus, type SchoolZone } from "@/schoolZones/zoneStatus";
import { asSchoolCalendar, dayKind } from "@/schoolZones/calendar";
import { evaluateOpeningHours, parseMaxspeedConditional } from "@/schoolZones/openingHours";
import { instantAtLocalMinutes, localParts } from "@/schoolZones/localTime";

const cal = asSchoolCalendar(nsw)!;
const waratah: SchoolZone = {
  id: "TfNSW-463859",
  source: "TfNSW",
  region: "AU-NSW",
  timezone: "Australia/Sydney",
  limit: { value: 40, unit: "km/h" },
  windows: [["08:00", "09:30"], ["14:30", "16:00"]],
  name: "ST PHILIP'S CHRISTIAN COLLEGE (WARATAH)",
};
const at = (iso: string) => Date.parse(iso);

describe("NSW school zone, official hours and calendar", () => {
  it("ACTIVE at 8:15 am on a Tuesday in term (17 Nov 2026), 'until 9:30 am'", () => {
    const s = zoneStatus(waratah, cal, at("2026-11-17T08:15:00+11:00"));
    expect(s).toMatchObject({ active: true, reason: "inHours", untilLabel: "until 9:30 am", limitKmh: 40, calendarUnknown: false });
    expect(s.nextChangeMs).toBe(at("2026-11-17T09:30:00+11:00"));
  });
  it("inactive at 8:15 am on a Tuesday in the school holidays (14 Apr 2026)", () => {
    expect(zoneStatus(waratah, cal, at("2026-04-14T08:15:00+10:00"))).toMatchObject({ active: false, reason: "schoolHoliday" });
  });
  it("inactive on a Saturday (21 Nov 2026, 8:15 am)", () => {
    expect(zoneStatus(waratah, cal, at("2026-11-21T08:15:00+11:00"))).toMatchObject({ active: false, reason: "weekend" });
  });
  it("inactive at 4:05 pm (and at 4:00 pm exactly; 3:59 pm is still on)", () => {
    expect(zoneStatus(waratah, cal, at("2026-11-17T16:05:00+11:00"))).toMatchObject({ active: false, reason: "outsideHours" });
    expect(zoneStatus(waratah, cal, at("2026-11-17T16:00:00+11:00")).active).toBe(false);
    expect(zoneStatus(waratah, cal, at("2026-11-17T15:59:00+11:00"))).toMatchObject({ active: true, untilLabel: "until 4:00 pm" });
  });
  it("inactive on a public holiday inside term (King's Birthday, Mon 8 Jun 2026)", () => {
    expect(zoneStatus(waratah, cal, at("2026-06-08T08:15:00+10:00"))).toMatchObject({ active: false, reason: "publicHoliday" });
  });
  it("ACTIVE on a pupil-free staff development day inside term (Mon 2 Feb 2026): zones follow the official terms", () => {
    expect(zoneStatus(waratah, cal, at("2026-02-02T08:15:00+11:00")).active).toBe(true);
  });
  it("a late-opening school's zone starts a week later (3 Feb 2026 is still holidays for it)", () => {
    expect(zoneStatus({ ...waratah, lateOpening: true }, cal, at("2026-02-03T08:15:00+11:00"))).toMatchObject({ active: false, reason: "schoolHoliday" });
    expect(zoneStatus({ ...waratah, lateOpening: true }, cal, at("2026-02-09T08:15:00+11:00")).active).toBe(true);
  });
  it("before the window it says when it starts (to switch on at the exact minute)", () => {
    const s = zoneStatus(waratah, cal, at("2026-11-17T07:40:30+11:00"));
    expect(s).toMatchObject({ active: false, reason: "outsideHours" });
    expect(s.nextChangeMs).toBe(at("2026-11-17T08:00:00+11:00"));
  });
});

describe("timezones and daylight saving", () => {
  it("a NSW zone keeps Sydney time even when the phone is in Brisbane (no DST)", () => {
    // 07:15 in Brisbane is 08:15 in Sydney in November: the Sydney zone is on.
    const instant = at("2026-11-17T07:15:00+10:00");
    expect(localParts(instant, "Australia/Brisbane").minutes).toBe(7 * 60 + 15);
    expect(zoneStatus(waratah, cal, instant).active).toBe(true);
  });
  it("Broken Hill (NSW, but on Central time) runs its zones on its own clock", () => {
    const bh = { ...waratah, timezone: "Australia/Broken_Hill" };
    expect(zoneStatus(bh, cal, at("2026-11-17T07:45:00+10:30")).active).toBe(false);
    expect(zoneStatus(bh, cal, at("2026-11-17T08:15:00+10:30")).active).toBe(true);
    // The same instant is 8:15 in Sydney but 7:45 in Broken Hill.
    expect(zoneStatus(bh, cal, at("2026-11-17T08:15:00+11:00")).active).toBe(false);
  });
  it("either side of the April DST change (AEDT -> AEST on 5 Apr 2026)", () => {
    expect(zoneStatus(waratah, cal, at("2026-04-01T08:15:00+11:00")).active).toBe(true); // last week of term 1, AEDT
    expect(zoneStatus(waratah, cal, at("2026-04-22T08:15:00+10:00")).active).toBe(true); // first day of term 2, AEST
    expect(zoneStatus(waratah, cal, at("2026-04-22T07:15:00+10:00")).active).toBe(false);
  });
  it("finding 8:00 am on the morning clocks go forward (4 Oct 2026) lands on the real 8:00 AEDT", () => {
    expect(instantAtLocalMinutes(at("2026-10-04T01:00:00+10:00"), "Australia/Sydney", 8 * 60)).toBe(at("2026-10-04T08:00:00+11:00"));
  });
});

describe("calendar unknown is never treated as a holiday", () => {
  it("2027 (not yet in the official data): weekday hours apply, marked calendar unknown", () => {
    expect(zoneStatus(waratah, cal, at("2027-02-03T08:15:00+11:00"))).toMatchObject({ active: true, calendarUnknown: true });
    expect(dayKind(cal, "2027-02-03", 3)).toBe("unknown");
  });
});

describe("OpenStreetMap conditional limits (opening_hours with SH / PH)", () => {
  const nswTag = "Mo-Fr 08:00-09:30,14:30-16:00; SH off; PH off";
  const ctx = { weekday: 2, minutes: 8 * 60 + 15, isSchoolHoliday: false, isPublicHoliday: false };
  it("in hours on a school day; off in school holidays, on public holidays, at weekends and outside hours", () => {
    expect(evaluateOpeningHours(nswTag, ctx)).toBe(true);
    expect(evaluateOpeningHours(nswTag, { ...ctx, isSchoolHoliday: true })).toBe(false);
    expect(evaluateOpeningHours(nswTag, { ...ctx, isPublicHoliday: true })).toBe(false);
    expect(evaluateOpeningHours(nswTag, { ...ctx, weekday: 6 })).toBe(false);
    expect(evaluateOpeningHours(nswTag, { ...ctx, minutes: 16 * 60 + 5 })).toBe(false);
  });
  it("needs the calendar when the tag mentions SH/PH; without it, unknown (not active)", () => {
    expect(evaluateOpeningHours(nswTag, { ...ctx, isSchoolHoliday: null })).toBeNull();
  });
  it("syntax it doesn't evaluate is unknown, never guessed", () => {
    expect(evaluateOpeningHours("Jan-Jun Mo-Fr 08:00-09:00", ctx)).toBeNull();
    expect(evaluateOpeningHours("Mo-Fr 08:00-09:30 || PH off", ctx)).toBeNull();
    expect(evaluateOpeningHours("sunrise-sunset", ctx)).toBeNull();
  });
  it("parses maxspeed:conditional, km/h and mph", () => {
    expect(parseMaxspeedConditional("40 @ (Mo-Fr 08:00-09:30,14:30-16:00; SH off)")).toEqual([
      { kmh: 40, display: { value: 40, unit: "km/h" }, condition: "Mo-Fr 08:00-09:30,14:30-16:00; SH off" },
    ]);
    const mph = parseMaxspeedConditional("15 mph @ (Mo-Fr 07:30-08:30,14:30-15:30)")!;
    expect(mph[0].display).toEqual({ value: 15, unit: "mph" });
    expect(mph[0].kmh).toBeCloseTo(24.14, 2);
  });
  it("an mph-country zone from OSM: active in its hours, limit shown in mph", () => {
    const zone: SchoolZone = { id: "osm-1", source: "OSM", region: "US-CA", timezone: "America/Los_Angeles", limit: { value: 15, unit: "mph" }, conditional: "Mo-Fr 07:30-08:30,14:30-15:30" };
    const s = zoneStatus(zone, null, at("2026-11-17T07:45:00-08:00"));
    expect(s.active).toBe(true);
    expect(s.limitKmh).toBeCloseTo(24.14, 2);
    // ...but the same zone tagged "SH off" can't be judged without a California calendar: not shown.
    expect(zoneStatus({ ...zone, conditional: "Mo-Fr 07:30-08:30; SH off" }, null, at("2026-11-17T07:45:00-08:00"))).toMatchObject({ active: false, reason: "unknownHours" });
  });
});

describe("rule table holds only verified rows", () => {
  it("every row names an official source URL and a last-verified date", () => {
    for (const r of rules.rows) {
      expect(r.sourceUrl).toMatch(/^https:\/\//);
      expect(r.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(rules.rows.map((r) => r.region)).toEqual(["AU-NSW"]);
  });
});
