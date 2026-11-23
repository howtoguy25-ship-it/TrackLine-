// Gap item 18 (server): a driver-typed fuel price shows only once 3 different drivers agree within
// 2 cents in 24 h; one report per driver; no rapid repeats; reports must be made at the station.
const core = require("../functions/fuelUserPricesCore");

const T = Date.UTC(2026, 10, 23, 2);
const at = { lat: -33.9175, lng: 151.0345, stationLat: -33.9176, stationLng: 151.0346 };

test("input is checked: station, fuel, a sane price, and you're at the station", () => {
  expect(core.parseReport({ placeId: "ChIJabc123", fuelType: "E10", cents: 189.94, ...at })).toMatchObject({ placeId: "ChIJabc123", fuelType: "E10", cents: 189.9 });
  expect(core.parseReport({ placeId: "ChIJabc123", fuelType: "jet", cents: 189, ...at }).error).toMatch(/fuel/);
  expect(core.parseReport({ placeId: "ChIJabc123", fuelType: "E10", cents: 18.9, ...at }).error).toMatch(/price/);
  expect(core.parseReport({ placeId: "ChIJabc123", fuelType: "E10", cents: 189, ...at, lat: -33.95 }).error).toMatch(/at the station/);
  expect(core.parseReport({ placeId: "../x", fuelType: "E10", cents: 189, ...at }).error).toMatch(/station/);
});

test("one or two drivers: nothing shown; the third agreeing driver confirms it (the middle price)", () => {
  let d = core.applyReport(null, { uid: "a", cents: 189.9 }, T);
  expect(d.confirmed).toBeNull();
  d = core.applyReport(d, { uid: "b", cents: 190.9 }, T + 60_000);
  expect(d.confirmed).toBeNull();
  d = core.applyReport(d, { uid: "c", cents: 189.5 }, T + 120_000);
  expect(d.confirmed).toEqual({ cents: 189.9, drivers: 3, atMs: T + 120_000 });
});

test("drivers who disagree by more than 2 cents don't confirm each other", () => {
  let d = null;
  for (const [uid, c] of [["a", 180], ["b", 185], ["c", 190]]) d = core.applyReport(d, { uid, cents: c }, T);
  expect(d.confirmed).toBeNull();
});

test("the same driver three times is still one driver; and can't repeat within 10 minutes", () => {
  let d = core.applyReport(null, { uid: "a", cents: 189.9 }, T);
  expect(() => core.applyReport(d, { uid: "a", cents: 189.9 }, T + 60_000)).toThrow(/few minutes/);
  d = core.applyReport(d, { uid: "a", cents: 189.9 }, T + core.SAME_DRIVER_GAP_MS);
  d = core.applyReport(d, { uid: "a", cents: 189.9 }, T + 2 * core.SAME_DRIVER_GAP_MS);
  expect(d.reports).toHaveLength(1);
  expect(d.confirmed).toBeNull();
});

test("reports older than 24 hours drop out", () => {
  let d = core.applyReport(null, { uid: "a", cents: 189.9 }, T);
  d = core.applyReport(d, { uid: "b", cents: 189.9 }, T);
  d = core.applyReport(d, { uid: "c", cents: 189.9 }, T + core.WINDOW_MS + 1);
  expect(d.reports.map((r) => r.uid)).toEqual(["c"]);
  expect(d.confirmed).toBeNull();
});
