// Startup §2-3 rules, without the emulator: the count's rounding and widening area, ghosts as a
// number, the 400 m private zones and tonight's automatic zone.
const core = require("../functions/trackysCore");

const at = (lat, lng, minsAgo = 1, uid = Math.random().toString(36)) => ({ uid, lat, lng, lastActive: NOW - minsAgo * 60_000 });
const NOW = 1_800_000_000_000;
const SYD = { lat: -33.87, lng: 151.21 };
// ~1 km steps north of Sydney CBD
const north = (km) => SYD.lat + km / 111.2;

describe("Trackys around you", () => {
  test("exact under 10 is never shown: 'A few'", () => {
    expect(core.roundCount(0)).toEqual({ few: true, count: null });
    expect(core.roundCount(9)).toEqual({ few: true, count: null });
  });
  test("10 and above round to the nearest 10", () => {
    expect(core.roundCount(10)).toEqual({ few: false, count: 10 });
    expect(core.roundCount(1248)).toEqual({ few: false, count: 1250 });
    expect(core.roundCount(14)).toEqual({ few: false, count: 10 });
  });
  test("starts at 10 km; widens 25 -> 50 -> region until 20 people", () => {
    const people = [];
    for (let i = 0; i < 5; i++) people.push(at(north(5), SYD.lng)); // 5 within 10 km
    for (let i = 0; i < 10; i++) people.push(at(north(20), SYD.lng)); // +10 within 25
    for (let i = 0; i < 10; i++) people.push(at(north(40), SYD.lng)); // +10 within 50
    const r = core.trackysAround(SYD, people, NOW, "me");
    expect(r.radiusKm).toBe(50);
    expect(r.count).toBe(30); // 25 people -> nearest 10
    const busy = Array.from({ length: 30 }, () => at(north(3), SYD.lng));
    expect(core.trackysAround(SYD, busy, NOW, "me")).toEqual({ few: false, count: 30, radiusKm: 10 });
  });
  test("only the last 15 minutes count; the asker doesn't count themselves", () => {
    const people = [at(north(1), SYD.lng, 16), at(north(1), SYD.lng, 1, "me")];
    expect(core.countSteps(SYD, people, NOW, "me")[10]).toBe(0);
  });
  test("the stored activity is rounded to ~1 km and carries no exact position", () => {
    const doc = core.activityDoc({ lat: -33.871234, lng: 151.209876, ghost: true, now: NOW });
    expect(doc).toMatchObject({ lat: -33.87, lng: 151.21, ghost: true, lastActive: NOW });
    expect(doc.gh4).toHaveLength(4);
  });
  test("geohash cell + neighbours cover the search step", () => {
    const cells = core.cellAndNeighbours(SYD.lat, SYD.lng, 4);
    expect(cells.length).toBe(9);
    const b = core.decodeBounds(cells[0]);
    expect(b.latMax - b.latMin).toBeGreaterThan(0.1);
  });
});

describe("private zones", () => {
  const home = { latitude: SYD.lat, longitude: SYD.lng };
  test("400 m around Home / Work / trip start / destination / tonight's place", () => {
    const zones = core.privateZones({ home, work: null, nightZone: null, tripStart: null, destination: null });
    expect(core.insideAnyZone(north(0.39), SYD.lng, zones)).toBe(true);
    expect(core.insideAnyZone(north(0.41), SYD.lng, zones)).toBe(false);
    expect(core.PRIVACY_ZONE_M).toBe(400);
  });
  test("tonight's zone: only with no Home, only 10 pm - 6 am, only standing still, once a night", () => {
    const base = { hasHome: false, localHour: 23, stationary: true, dayKey: "2026-11-24", existingDayKey: null };
    expect(core.shouldSetNightZone(base)).toBe(true);
    expect(core.shouldSetNightZone({ ...base, hasHome: true })).toBe(false);
    expect(core.shouldSetNightZone({ ...base, localHour: 21 })).toBe(false);
    expect(core.shouldSetNightZone({ ...base, stationary: false })).toBe(false);
    expect(core.shouldSetNightZone({ ...base, existingDayKey: "2026-11-24" })).toBe(false);
    expect(core.shouldSetNightZone({ ...base, existingDayKey: "2026-11-23" })).toBe(true);
  });
  test("one night is one key: 11 pm and 2 am the next morning are the same night", () => {
    expect(core.nightKey("2026-11-24", 23)).toBe("2026-11-24");
    expect(core.nightKey("2026-11-25", 2)).toBe("2026-11-24");
  });
});
