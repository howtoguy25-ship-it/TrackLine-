// Driver reports: what the server accepts, the 3-confirmation rule, what becomes public (no
// reporter id), and how a live reported zone is matched (that stretch of road, that direction)
// and judged (official calendar, like any zone). The Firestore rules for the same collections
// are tested against the emulator in firebase/tests/firestore.rules.test.js.
import { describe, expect, it, jest } from "@jest/globals";
import nsw from "@/data/schoolCalendars/AU-NSW.json";
import { asSchoolCalendar } from "@/schoolZones/calendar";
import { asCommunityFeature, communityZoneAt, type CommunityFeature } from "@/schoolZones/communityZones";
import { zoneStatus } from "@/schoolZones/zoneStatus";

jest.mock("@/services/firebase", () => ({ db: {} }));
import { buildRoadReport, reportSummary } from "@/services/roadFeatureReports";
import { defaultHoursText, parseHoursText } from "@/components/RoadReportSheet";

const core = require("../../firebase/functions/roadReportsCore");
const cal = asSchoolCalendar(nsw)!;
const at = { latitude: -33.9123, longitude: 151.1612 };

describe("what the server accepts", () => {
  it("the app's report passes the server's validator as filed (same shape both sides)", () => {
    const r = buildRoadReport("driver-a", at, 12, { kind: "school_zone_missing", speed: 40, unit: "km/h", windows: [["08:00", "09:30"], ["14:30", "16:00"]] });
    expect((r as { windows?: unknown }).windows).toEqual(["08:00-09:30", "14:30-16:00"]); // no nested arrays (Firestore)
    expect(core.validateReport(r)).toMatchObject({ kind: "school_zone_missing", speed: 40, windows: ["08:00-09:30", "14:30-16:00"] });
    const wrong = buildRoadReport("driver-a", at, null, { kind: "speed_limit_wrong", postedKmh: 50, shownKmh: 60 });
    expect(core.validateReport(wrong)).toMatchObject({ postedKmh: 50, shownKmh: 60 });
  });
  it("refuses what it can't use: no direction, bad hours, silly speeds, a forged tile", () => {
    const ok = buildRoadReport("a", at, 12, { kind: "school_zone_missing", speed: 40, unit: "km/h", windows: [["08:00", "09:30"]] });
    expect(core.validateReport({ ...ok, heading: null })).toBeNull();
    expect(core.validateReport({ ...ok, windows: ["09:30-08:00"] })).toBeNull();
    expect(core.validateReport({ ...ok, windows: [["08:00", "09:30"]] })).toBeNull();
    expect(core.validateReport({ ...ok, speed: 100 })).toBeNull();
    expect(core.validateReport({ ...ok, unit: "mph", speed: 40 })).toBeNull();
    expect(core.validateReport({ ...ok, tile: "0_0" })).toBeNull();
    expect(core.validateReport({ ...ok, kind: "made_up" })).toBeNull();
  });
});

describe("moderation: live after 3 confirmations from OTHER drivers, or owner approval", () => {
  const report = { reportedBy: "a", status: "pending" };
  it("the reporter's own confirmation and duplicates don't count", () => {
    expect(core.nextStatus(report, ["a", "b", "b"])).toBe("pending");
    expect(core.nextStatus(report, ["a", "b", "c"])).toBe("pending");
    expect(core.nextStatus(report, ["b", "c", "d"])).toBe("live");
    expect(core.countConfirmations("a", ["a", "b", "c", "d", "d"])).toBe(3);
  });
  it("the owner's decision stands", () => {
    expect(core.nextStatus({ ...report, status: "rejected" }, ["b", "c", "d", "e"])).toBe("rejected");
    expect(core.nextStatus({ ...report, status: "approved" }, [])).toBe("approved");
  });
  it("only a live/approved missing-zone report becomes public, without the reporter's id", () => {
    const r = { ...buildRoadReport("driver-a", at, 12, { kind: "school_zone_missing", speed: 40, unit: "km/h", windows: [["08:00", "09:30"]] }) };
    expect(core.toCommunityFeature("r1", r)).toBeNull(); // pending
    const pub = core.toCommunityFeature("r1", { ...r, status: "live" });
    expect(pub).toMatchObject({ id: "community-r1", kind: "school_zone", speed: 40, windows: ["08:00-09:30"] });
    expect(JSON.stringify(pub)).not.toContain("driver-a");
    const wrong = buildRoadReport("driver-a", at, null, { kind: "speed_limit_wrong", postedKmh: 50, shownKmh: 60 });
    expect(core.toCommunityFeature("r2", { ...wrong, status: "approved" })).toBeNull(); // review only
  });
});

describe("a live reported zone on the road", () => {
  const stored = core.toCommunityFeature("r1", {
    ...buildRoadReport("a", at, 10, { kind: "school_zone_missing", speed: 40, unit: "km/h", windows: [["08:00", "09:30"], ["14:30", "16:00"]] }),
    status: "live",
  });
  const f = asCommunityFeature("r1", stored) as CommunityFeature;
  const where = { region: "AU-NSW", timezone: "Australia/Sydney" };
  const north = (m: number) => ({ latitude: at.latitude + m / 111_320, longitude: at.longitude });
  it("reads back the stored record", () => {
    expect(f.windows).toEqual([["08:00", "09:30"], ["14:30", "16:00"]]);
  });
  it("covers 75 m of that road, in either direction of travel; not a cross street, not further away", () => {
    expect(communityZoneAt(north(40), 10, [f], where)?.limit).toEqual({ value: 40, unit: "km/h" });
    expect(communityZoneAt(north(40), 190, [f], where)).not.toBeNull();
    expect(communityZoneAt(north(40), 100, [f], where)).toBeNull();
    expect(communityZoneAt(north(120), 10, [f], where)).toBeNull();
  });
  it("judged on the official calendar like any zone: on at 8:15 on a school day, off in the holidays", () => {
    const z = communityZoneAt(north(10), 10, [f], where)!;
    expect(zoneStatus(z, cal, Date.parse("2026-11-17T08:15:00+11:00")).active).toBe(true);
    expect(zoneStatus(z, cal, Date.parse("2026-04-14T08:15:00+10:00")).active).toBe(false);
  });
  it("a malformed record is dropped, never guessed", () => {
    expect(asCommunityFeature("x", { ...stored, windows: ["8-9"] })).toBeNull();
    expect(asCommunityFeature("x", { ...stored, status: "pending" })).toBeNull();
  });
});

describe("the report sheet", () => {
  it("reads typed hours, and prefills only verified defaults", () => {
    expect(parseHoursText("08:00-09:30, 14:30-16:00")).toEqual([["08:00", "09:30"], ["14:30", "16:00"]]);
    expect(parseHoursText("8:00 - 9:30")).toEqual([["08:00", "09:30"]]);
    expect(parseHoursText("09:30-08:00")).toBeNull();
    expect(parseHoursText("mornings")).toBeNull();
    expect(defaultHoursText("AU-NSW")).toBe("08:00-09:30, 14:30-16:00");
    expect(defaultHoursText("AU-VIC")).toBe(""); // no verified row: the driver types what the sign says
  });
  it("summarises other drivers' reports for Confirm", () => {
    expect(reportSummary({ kind: "school_zone_missing", speed: 40, unit: "km/h", windows: ["08:00-09:30"] })).toBe("School zone 40 km/h, 08:00-09:30");
    expect(reportSummary({ kind: "speed_limit_wrong", postedKmh: 50 })).toBe("Speed limit here is 50 km/h");
  });
});
