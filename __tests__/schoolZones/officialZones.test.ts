// Official NSW school zones end to end: the converter (firebase/functions/schoolZonesCore.js) on
// real records, matching the car to a real zone band (Tempe High School, Unwins Bridge Road --
// from a real converted TfNSW tile), the offline cache rules, and a simulated drive along the real
// road through the zone at 8:20 am on a school day vs in the holidays.
import { describe, expect, it } from "@jest/globals";
import tile from "../fixtures/schoolZones/nsw-tile-newtown.json";
import drive from "../fixtures/schoolZones/drive-through-zone.json";
import nsw from "@/data/schoolCalendars/AU-NSW.json";
import { asSchoolCalendar } from "@/schoolZones/calendar";
import { toShape, zoneAt, type StoredZone } from "@/schoolZones/zoneMatch";
import { zoneStatus } from "@/schoolZones/zoneStatus";
import { cachedRead, MAX_AGE_MS, REFRESH_AFTER_MS, tileKey, tilesAround } from "@/schoolZones/zoneStore";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { driveTrack } from "@/dev/simulateDrive";
import type { LatLng } from "@/utils/polyline";

const core = require("../../firebase/functions/schoolZonesCore");

const cal = asSchoolCalendar(nsw)!;
const shapes = (tile.zones as StoredZone[]).map(toShape);
const tempe = shapes.find((s) => s.zone.id === "TfNSW-449560")!;
const road = parseMapboxResponse(drive)[0];

describe("the converter, on real official records", () => {
  it("reads every format the data uses and refuses what it can't read", () => {
    expect(core.to24h("08:00 AM")).toBe("08:00");
    expect(core.to24h("02:30 PM")).toBe("14:30");
    expect(core.to24h("4 PM")).toBe("16:00");
    expect(core.to24h("14:30 PM")).toBe("14:30");
    expect(core.to24h("14:30 AM")).toBeNull();
    expect(core.to24h(null)).toBeNull();
    // A zone with no hours in the data (Hillston Central School) is left out, not guessed.
    expect(core.toZone({ SZ_TYPE: "School", SZ_STATUS: "Existing", SZ_SPEED: "40 km/h", START_TIME_AM: null, END_TIME_AM: null, START_TIME_PM: null, END_TIME_PM: null, OP_CAL: "", json_geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } })).toBeNull();
  });
  it("tile keys agree between the server and the phone", () => {
    expect(core.tileKey(-33.9, 151.17)).toBe(tileKey(-33.9, 151.17));
    expect(tilesAround(-33.9, 151.17)).toContain(tileKey(-33.9, 151.17));
  });
  it("the real tile: 95 official zones with their own hours and the Sydney clock", () => {
    expect(shapes.length).toBe(95);
    expect(tempe.zone).toMatchObject({ name: "TEMPE HIGH SCHOOL", limit: { value: 40, unit: "km/h" }, timezone: "Australia/Sydney" });
  });
});

describe("matching the car to the zone's road (not a parallel road or a cross street)", () => {
  // A point on the real road in the middle of the zone, and the road's direction there.
  const inZone = road.polyline.filter((p) => zoneAt(p, null, [tempe]));
  const offset = (p: LatLng, brg: number, m: number): LatLng => ({
    latitude: p.latitude + (m * Math.cos((brg * Math.PI) / 180)) / 111_320,
    longitude: p.longitude + (m * Math.sin((brg * Math.PI) / 180)) / (111_320 * Math.cos((p.latitude * Math.PI) / 180)),
  });
  const bearingAt = (i: number) => {
    const a = inZone[i];
    const b = inZone[i + 1];
    return (Math.atan2((b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180), b.latitude - a.latitude) * 180) / Math.PI;
  };
  // A point on the road where the official zone is just the road (some points have the zone
  // running into a side street; 20 m beside those is IN the zone, not a parallel road).
  const k = inZone.findIndex((_, i) => {
    if (i + 1 >= inZone.length) return false;
    const b = bearingAt(i);
    return !zoneAt(offset(inZone[i], b + 90, 20), null, [tempe]) && !zoneAt(offset(inZone[i], b - 90, 20), null, [tempe]);
  });
  const mid = inZone[k];
  const roadBearing = bearingAt(k);
  it("on the road, either direction: in the zone", () => {
    expect(inZone.length).toBeGreaterThan(3);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(zoneAt(mid, roadBearing, [tempe])?.zone.id).toBe("TfNSW-449560");
    expect(zoneAt(mid, roadBearing + 180, [tempe])?.zone.id).toBe("TfNSW-449560");
  });
  it("6 m off (GPS error): still in the zone", () => {
    expect(zoneAt(offset(mid, roadBearing + 90, 6), roadBearing, [tempe])).not.toBeNull();
  });
  it("a parallel road 20 m away: not in the zone", () => {
    expect(zoneAt(offset(mid, roadBearing + 90, 20), roadBearing, [tempe])).toBeNull();
    expect(zoneAt(offset(mid, roadBearing - 90, 20), roadBearing, [tempe])).toBeNull();
  });
  it("crossing the zone's road at right angles (a cross street): not in the zone", () => {
    expect(zoneAt(mid, roadBearing + 90, [tempe])).toBeNull();
  });
});

describe("simulated drive along the real road through Tempe High School's zone (Unwins Bridge Road)", () => {
  // 40 km/h, one fix a second, along the road geometry. `start` is when the drive begins.
  const run = (startIso: string) => {
    const t0 = Date.parse(startIso);
    let prev: LatLng | null = null;
    const states: { inZone: boolean; active: boolean; until: string | null }[] = [];
    for (const s of driveTrack(road.polyline, () => 40)) {
      const heading = prev ? (Math.atan2((s.truth.longitude - prev.longitude) * Math.cos((s.truth.latitude * Math.PI) / 180), s.truth.latitude - prev.latitude) * 180) / Math.PI : null;
      prev = s.truth;
      const z = zoneAt(s.truth, heading, shapes);
      const st = z ? zoneStatus(z.zone, cal, t0 + s.timeMs) : null;
      states.push({ inZone: !!z, active: !!st?.active, until: st?.untilLabel ?? null });
    }
    return states;
  };
  it("8:20 am on a school day (Tue 17 Nov 2026): the 40 zone is active through the zone, 'until 9:30 am'", () => {
    const s = run("2026-11-17T08:20:00+11:00");
    const inside = s.filter((x) => x.inZone);
    expect(inside.length).toBeGreaterThan(20); // ~416 m at 40 km/h
    expect(inside.every((x) => x.active && x.until === "until 9:30 am")).toBe(true);
    expect(s.filter((x) => !x.inZone).every((x) => !x.active)).toBe(true);
  });
  it("8:20 am in the school holidays (Tue 14 Apr 2026): in the zone, but no alert -- the normal limit", () => {
    const s = run("2026-04-14T08:20:00+10:00");
    expect(s.some((x) => x.inZone)).toBe(true);
    expect(s.some((x) => x.active)).toBe(false);
  });
});

describe("offline cache: refreshed weekly, never older than 30 days", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), m };
  };
  it("fresh cache is used without asking the server", async () => {
    const s = store();
    await s.setItem("k", JSON.stringify({ fetchedAt: 0, data: "cached" }));
    let asked = false;
    expect(await cachedRead("k", async () => ((asked = true), "fresh"), REFRESH_AFTER_MS - 1, s)).toBe("cached");
    expect(asked).toBe(false);
  });
  it("older than a week: re-checked; offline, the cache is still used up to 30 days", async () => {
    const s = store();
    await s.setItem("k", JSON.stringify({ fetchedAt: 0, data: "cached" }));
    expect(await cachedRead("k", async () => "fresh", REFRESH_AFTER_MS + 1, s)).toBe("fresh");
    await s.setItem("k", JSON.stringify({ fetchedAt: 0, data: "cached" }));
    expect(await cachedRead("k", async () => { throw new Error("offline"); }, MAX_AGE_MS - 1, s)).toBe("cached");
  });
  it("over 30 days old and the re-check fails: nothing (no stale zones shown)", async () => {
    const s = store();
    await s.setItem("k", JSON.stringify({ fetchedAt: 0, data: "cached" }));
    expect(await cachedRead("k", async () => { throw new Error("offline"); }, MAX_AGE_MS + 1, s)).toBeNull();
  });
});
