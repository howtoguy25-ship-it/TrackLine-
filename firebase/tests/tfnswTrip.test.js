// Transit live/late from Transport for NSW (functions/tfnswTrip.js): the request, reading the
// realtime answer, and matching it to the rides the app shows -- never an invented delay.
const t = require("../functions/tfnswTrip");
const TRIP = require("./fixtures/tfnswTrip/trip.json");

test("asks for the trip from/to the ride's stops, at the ride's Sydney time, realtime on", () => {
  const url = new URL(t.tripUrl({ from: { lat: -33.9177, lng: 151.0346 }, to: { lat: -33.8644, lng: 151.0472 }, departMs: Date.parse("2026-11-18T23:02:00Z") }));
  expect(url.origin + url.pathname).toBe("https://api.transport.nsw.gov.au/v1/tp/trip");
  expect(url.searchParams.get("outputFormat")).toBe("rapidJSON");
  expect(url.searchParams.get("TfNSWTR")).toBe("true");
  expect(url.searchParams.get("itdDate")).toBe("20261119"); // 10:02 am on the 19th in Sydney (AEDT)
  expect(url.searchParams.get("itdTime")).toBe("1002");
  expect(url.searchParams.get("name_origin")).toBe("151.034600:-33.917700:EPSG:4326");
});

test("reads lines, planned/estimated departures and stops", () => {
  const legs = t.parseLegs(TRIP);
  expect(legs.map((l) => l.line)).toEqual(["T6", "T1"]);
  expect(legs[0]).toMatchObject({ isRealtime: true, departureEstimatedMs: Date.parse("2026-11-18T23:10:00Z") });
  expect(legs[0].stops.map((s) => s.name)).toEqual(["Yagoona Station", "Lidcombe Station"]);
  expect(legs[0].stops[0]).toMatchObject({ latitude: -33.9047, longitude: 151.0247 });
});

test("matched by line and planned time: 3 min late; a service not tracked live says so", () => {
  const legs = t.parseLegs(TRIP);
  const [t6, t1, none] = t.matchRealtime(legs, [
    { lineName: "T6", departureTimeMs: Date.parse("2026-11-18T23:07:00Z") },
    { lineName: "T1", departureTimeMs: Date.parse("2026-11-18T23:33:00Z") },
    { lineName: "T6", departureTimeMs: Date.parse("2026-11-18T23:40:00Z") },
  ]);
  expect(t6).toMatchObject({ live: true, delayMinutes: 3 });
  expect(t6.stopsAhead).toHaveLength(2);
  expect(t1).toMatchObject({ live: false, delayMinutes: null });
  expect(none).toBeNull();
});

test("junk input is cleaned, nothing found is null", () => {
  expect(t.cleanRides([{ lineName: 5 }, null]).every((r) => r.lineName === "")).toBe(true);
  expect(t.parseLegs({})).toEqual([]);
  expect(t.matchRealtime([], [{ lineName: "T1", departureTimeMs: 1 }])).toEqual([null]);
});
