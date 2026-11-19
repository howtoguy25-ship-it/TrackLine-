// Real unit checks for the small pure rules behind the Waze-style UI pass 2 -- run with:
//   npx tsx scripts/test-ui-logic.ts
// Each section of the pass adds its own block here. Nothing in this file renders a screen:
// how things LOOK and FEEL on a phone is in TEST_ON_PHONE.md, marked "NEEDS DEVICE TEST".
import { RUBIK, rubikFamilyForWeight } from "../src/theme/typography";
import { scaleFor } from "../src/theme/scale";
import { SETTINGS_VERSION, migrateStoredSettings } from "../src/services/settingsMigration";
import { SearchSession, matchQuality, rankPredictions } from "../src/services/searchRanking";
import { formatDistance } from "../src/utils/navFormat";
import { isLookupablePlaceId, summarizeParking, todaysHours } from "../src/services/placePageLogic";
import {
  DEFAULT_ROUTE_AVOID,
  avoidCount,
  avoidPillLabel,
  avoidRouteOptions,
  bubbleAnchors,
  distanceToPolylineMeters,
  distinctRoutes,
  formatRouteDuration,
  normalizeRouteAvoid,
  roadFromInstruction,
  routeSummaryLine,
  routeTags,
  sharedPathFraction,
  trafficLevel,
  trafficStretches,
  viaRoadLabel,
  withoutUturns,
  type ChoiceRoute,
} from "../src/map/routeChoices";
import {
  ALERT_PIN_MAX,
  ALERT_PIN_MIN,
  HOME_ARROW_SCREEN_FRACTION,
  STREET_LOOKUP_MIN_MOVE_M,
  StreetNameTracker,
  alertPinSize,
  arrowScreenY,
  countReportsAround,
  floatingButtonsInteractive,
  floatingButtonsOpacity,
  headingDelta,
  homeMapPadding,
  roadFromRouteSteps,
  shouldClusterAlerts,
  zoomFromLatitudeDelta,
} from "../src/map/homeMapLogic";

const assert = {
  ok(value: unknown, message?: string): void {
    if (!value) throw new Error(message ?? "assertion failed");
  },
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  // Same JSON shape (objects compared by their values, in key order).
  deepEqual(actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`expected ${e}, got ${a}`);
  },
};
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("§0 font");
check("each weight the spec uses maps to the Rubik file that IS that weight", () => {
  assert.equal(rubikFamilyForWeight("400"), RUBIK.regular);
  assert.equal(rubikFamilyForWeight("500"), RUBIK.medium);
  assert.equal(rubikFamilyForWeight("600"), RUBIK.semiBold);
  assert.equal(rubikFamilyForWeight("700"), RUBIK.bold);
});
check("no weight, 'normal' and 'bold' behave as React Native's own defaults do", () => {
  assert.equal(rubikFamilyForWeight(undefined), RUBIK.regular);
  assert.equal(rubikFamilyForWeight("normal"), RUBIK.regular);
  assert.equal(rubikFamilyForWeight("bold"), RUBIK.bold);
});
check("weights that aren't bundled use the nearest real face (800/900 -> Bold, 300 -> Regular)", () => {
  assert.equal(rubikFamilyForWeight("800"), RUBIK.bold);
  assert.equal(rubikFamilyForWeight(900), RUBIK.bold);
  assert.equal(rubikFamilyForWeight("300"), RUBIK.regular);
  assert.equal(rubikFamilyForWeight(100), RUBIK.regular);
});
check("a nonsense weight falls back to Regular instead of an unregistered family", () => {
  assert.equal(rubikFamilyForWeight("heavy"), RUBIK.regular);
});

console.log("§0 scaling from the 390pt design width");
check("a 390pt phone is 1:1", () => {
  assert.equal(scaleFor(390), 1);
});
check("smaller and larger phones scale in proportion", () => {
  assert.ok(Math.abs(scaleFor(375) - 375 / 390) < 1e-9);
  assert.ok(Math.abs(scaleFor(430) - 430 / 390) < 1e-9);
});
check("the scale is clamped, so a tiny phone isn't cramped and a tablet isn't oversized", () => {
  assert.equal(scaleFor(280), 0.85);
  assert.equal(scaleFor(1024), 1.25);
});
check("a missing or bad width never produces NaN sizes", () => {
  assert.equal(scaleFor(0), 1);
  assert.equal(scaleFor(NaN), 1);
});

console.log("§1 floating buttons vs the sheet");
check("fully visible at peek and at exactly half height", () => {
  assert.equal(floatingButtonsOpacity(200, 420), 1);
  assert.equal(floatingButtonsOpacity(420, 420), 1);
});
check("HIDDEN ABOVE HALF: fades over the next 48pt, then gone", () => {
  assert.equal(floatingButtonsOpacity(444, 420), 0.5);
  assert.equal(floatingButtonsOpacity(468, 420), 0);
  assert.equal(floatingButtonsOpacity(800, 420), 0);
});
check("a faded-out button can't be tapped", () => {
  assert.equal(floatingButtonsInteractive(420, 420), true);
  assert.equal(floatingButtonsInteractive(460, 420), false);
  assert.equal(floatingButtonsInteractive(800, 420), false);
});

console.log("§1 where the driver sits on screen");
check("the arrow lands at 62% of the screen height on a normal phone", () => {
  const padding = homeMapPadding(844, 250);
  assert.ok(Math.abs(arrowScreenY(844, padding) - 844 * HOME_ARROW_SCREEN_FRACTION) < 0.5);
  assert.equal(padding.bottom, 250);
});
check("the arrow is always above whatever covers the bottom of the map", () => {
  for (const [height, covered] of [[844, 250], [667, 300], [932, 220], [568, 330]] as const) {
    const padding = homeMapPadding(height, covered);
    assert.ok(arrowScreenY(height, padding) < height - padding.bottom, `h=${height} covered=${covered}`);
  }
});
check("a very tall sheet can't pad the map away to nothing", () => {
  const padding = homeMapPadding(568, 5000);
  assert.ok(568 - padding.top - padding.bottom >= 100);
});

console.log("§1 report pins");
check("22pt zoomed out, 34pt close up, never outside that range", () => {
  assert.equal(alertPinSize(8), ALERT_PIN_MIN);
  assert.equal(alertPinSize(12), ALERT_PIN_MIN);
  assert.equal(alertPinSize(17), ALERT_PIN_MAX);
  assert.equal(alertPinSize(21), ALERT_PIN_MAX);
});
check("sizes move in 4pt steps, growing with zoom", () => {
  let previous = 0;
  for (let zoom = 10; zoom <= 19; zoom += 0.25) {
    const size = alertPinSize(zoom);
    assert.ok((size - ALERT_PIN_MIN) % 4 === 0, `size ${size} at zoom ${zoom}`);
    assert.ok(size >= previous);
    previous = size;
  }
});
check("a report on the active route is one step larger at every zoom", () => {
  for (const zoom of [10, 13, 15, 18]) assert.equal(alertPinSize(zoom, true), alertPinSize(zoom) + 4);
});
check("reports are grouped into counts below zoom 12 and drawn singly from 12 up", () => {
  assert.equal(shouldClusterAlerts(11.9), true);
  assert.equal(shouldClusterAlerts(12), false);
});
check("zoom is derived sensibly from the latitude span", () => {
  assert.ok(Math.abs(zoomFromLatitudeDelta(360) - 0) < 1e-9);
  assert.ok(zoomFromLatitudeDelta(0.005) > zoomFromLatitudeDelta(0.05));
  assert.ok(Number.isFinite(zoomFromLatitudeDelta(0)));
});

console.log("§1 'N reports around you'");
check("counts only reports within 10km -- the real number, including zero", () => {
  const here = { latitude: -33.8688, longitude: 151.2093 };
  const reports = [
    { lat: -33.8688, lng: 151.2093 }, // here
    { lat: -33.9, lng: 151.2093 }, // ~3.5km
    { lat: -33.95, lng: 151.2093 }, // ~9km
    { lat: -34.0, lng: 151.2093 }, // ~14.6km
  ];
  assert.equal(countReportsAround(reports, here), 3);
  assert.equal(countReportsAround([], here), 0);
});

console.log("§1 street-name pill throttle");
const M = 1 / 111_320; // degrees of latitude per metre
const fixAt = (metersNorth: number, heading = 0) => ({
  latitude: -33.9 + metersNorth * M,
  longitude: 151.2,
  heading,
});
check("heading difference wraps correctly", () => {
  assert.equal(headingDelta(350, 10), 20);
  assert.equal(headingDelta(0, 180), 180);
  assert.equal(headingDelta(90, 90), 0);
});
check("NO MORE THAN ONE LOOKUP PER 25m: a 1km drive ticking every 2m makes at most 40", () => {
  const tracker = new StreetNameTracker();
  for (let m = 0; m <= 1000; m += 2) {
    const fix = fixAt(m);
    if (tracker.update(fix)) tracker.resolve(fix, "George St");
  }
  assert.ok(tracker.lookupsStarted <= 1000 / STREET_LOOKUP_MIN_MOVE_M, `made ${tracker.lookupsStarted} lookups`);
  assert.ok(tracker.lookupsStarted >= 10); // and it does keep looking, not just once
});
check("sitting still makes exactly one lookup however long it ticks", () => {
  const tracker = new StreetNameTracker();
  for (let second = 0; second < 600; second++) {
    const fix = fixAt(0, second % 2 === 0 ? 0 : 3); // a little compass jitter
    if (tracker.update(fix)) tracker.resolve(fix, "George St");
  }
  assert.equal(tracker.lookupsStarted, 1);
  assert.equal(tracker.name, "George St");
});
check("heading jitter while parked never triggers a lookup, even a big swing", () => {
  const tracker = new StreetNameTracker();
  const first = fixAt(0, 0);
  if (tracker.update(first)) tracker.resolve(first, "George St");
  for (const heading of [90, 200, 310, 45]) tracker.update(fixAt(0.5, heading));
  assert.equal(tracker.lookupsStarted, 1);
});
check("a real turn (moved and heading changed > 30 degrees) looks up before 25m", () => {
  const tracker = new StreetNameTracker();
  const first = fixAt(0, 0);
  if (tracker.update(first)) tracker.resolve(first, "George St");
  const turned = fixAt(12, 90);
  assert.equal(tracker.update(turned), true);
  tracker.resolve(turned, "Pitt St");
  assert.equal(tracker.name, "Pitt St");
});
check("a stretch of road already named is answered from memory, with no lookup", () => {
  const tracker = new StreetNameTracker();
  for (let m = 0; m <= 300; m += 5) {
    const fix = fixAt(m);
    if (tracker.update(fix)) tracker.resolve(fix, m < 150 ? "George St" : "Pitt St");
  }
  const after = tracker.lookupsStarted;
  for (let m = 0; m <= 300; m += 5) tracker.update(fixAt(m)); // drive it again
  assert.equal(tracker.lookupsStarted, after);
});
check("only one lookup is ever in flight at a time", () => {
  const tracker = new StreetNameTracker();
  assert.equal(tracker.update(fixAt(0)), true); // not resolved yet
  assert.equal(tracker.update(fixAt(100)), false);
  assert.equal(tracker.update(fixAt(200)), false);
  assert.equal(tracker.lookupsStarted, 1);
});
check("a failed lookup isn't cached, so the road gets another try", () => {
  const tracker = new StreetNameTracker();
  assert.equal(tracker.update(fixAt(0)), true);
  tracker.fail();
  assert.equal(tracker.update(fixAt(40)), true);
});
check("'no road here' is remembered too, and hides the pill", () => {
  const tracker = new StreetNameTracker();
  const fix = fixAt(0);
  if (tracker.update(fix)) tracker.resolve(fix, null);
  assert.equal(tracker.name, null);
  assert.equal(tracker.update(fixAt(1)), false);
});
check("while navigating, the road is the street the previous step turned onto", () => {
  const steps = [{ targetStreetName: "George St" }, { targetStreetName: "Pitt St" }, {}];
  assert.equal(roadFromRouteSteps(steps, 0), null);
  assert.equal(roadFromRouteSteps(steps, 1), "George St");
  assert.equal(roadFromRouteSteps(steps, 2), "Pitt St");
  assert.equal(roadFromRouteSteps([{}, {}], 1), null);
});

console.log("§1 the map opens on TrackLine Light");
check("a phone that was on satellite is moved back to the drawn map, once", () => {
  const migrated = migrateStoredSettings({ defaultMapViewStyle: "satellite3d", mapTheme: "dark" }, undefined);
  assert.equal(migrated.defaultMapViewStyle, "tilted3d");
  assert.equal(migrated.mapTheme, "light");
  assert.equal(migrated.settingsVersion, SETTINGS_VERSION);
});
check("a flat-view preference is left alone -- only satellite is reset", () => {
  assert.equal(migrateStoredSettings({ defaultMapViewStyle: "flat", mapTheme: "light" }, 1).defaultMapViewStyle, "flat");
});
check("choosing satellite AFTER the reset sticks: an up-to-date phone is never touched again", () => {
  const again = migrateStoredSettings({ defaultMapViewStyle: "satellite3d", mapTheme: "dark" }, SETTINGS_VERSION);
  assert.equal(again.defaultMapViewStyle, "satellite3d");
  assert.equal(again.mapTheme, "dark");
});

console.log("§3 search results order");
const p = (primaryText: string, distanceMeters?: number, secondaryText = "") => ({ primaryText, secondaryText, distanceMeters });
check("a name that starts with the query beats one that only contains it as a later word", () => {
  assert.equal(matchQuality(p("Bondi Beach"), "bond"), 0);
  assert.equal(matchQuality(p("North Bondi"), "bond"), 1);
  assert.equal(matchQuality(p("12 Smith St"), "bond"), 2);
});
check("matching ignores case, accents and extra spaces", () => {
  assert.equal(matchQuality(p("Café Sydney"), "  CAFE  "), 0);
});
check("nearest first WITHIN a level of match -- a far exact name still beats a near loose one", () => {
  const ranked = rankPredictions(
    [p("North Bondi", 500), p("Bondi Beach", 9000), p("Bondi Junction", 4000), p("1 Bond St", 100)],
    "bondi"
  );
  assert.equal(ranked.map((r) => r.primaryText).join(" | "), "Bondi Junction | Bondi Beach | North Bondi | 1 Bond St");
});
check("results without a distance go after those with one, otherwise in Google's own order", () => {
  const ranked = rankPredictions([p("Bondi A"), p("Bondi B", 3000), p("Bondi C")], "bondi");
  assert.equal(ranked.map((r) => r.primaryText).join(","), "Bondi B,Bondi A,Bondi C");
});
check("an empty query keeps Google's order untouched", () => {
  const list = [p("Z", 900), p("A", 10)];
  assert.equal(rankPredictions(list, "").map((r) => r.primaryText).join(","), "A,Z");
});
check("SESSION TOKENS: every keystroke of one search shares a token; choosing a result ends it", () => {
  let n = 0;
  const session = new SearchSession(() => `token-${++n}`);
  const typed = ["b", "bo", "bon", "bond", "bondi"].map(() => session.forAutocomplete());
  assert.ok(typed.every((t) => t === "token-1"));
  assert.equal(session.forDetails(), "token-1");
  assert.equal(session.active, false);
  assert.equal(session.forAutocomplete(), "token-2"); // the next search is a new session
});
check("an abandoned search doesn't leak its token into the next one", () => {
  let n = 0;
  const session = new SearchSession(() => `t${++n}`);
  session.forAutocomplete();
  session.abandon();
  assert.equal(session.forDetails(), undefined);
  assert.equal(session.forAutocomplete(), "t2");
});

console.log("§3 distance formatting");
check("under 1km in tens of metres, then kilometres to one decimal", () => {
  assert.equal(formatDistance(347, "km"), "350 m");
  assert.equal(formatDistance(3640, "km"), "3.6 km");
});
check("miles when the driver has chosen miles", () => {
  assert.ok(/mi$/.test(formatDistance(5000, "miles")), formatDistance(5000, "miles"));
});

console.log("§4 place page");
check("a car park within 40m is treated as the place's own", () => {
  const summary = summarizeParking([{ name: "Westfield car park", distanceMeters: 25 }]);
  assert.equal(summary.kind, "onsite");
});
check("otherwise the nearest one, with an honest walk time (straight line x1.3 at 80m/min)", () => {
  const summary = summarizeParking([
    { name: "Far", distanceMeters: 700 },
    { name: "Wilson Parking", distanceMeters: 300 },
  ]);
  assert.ok(summary.kind === "nearby" && summary.name === "Wilson Parking" && summary.walkMinutes === 5);
});
check("no car park within 800m hides the section rather than guessing", () => {
  assert.equal(summarizeParking([{ name: "Too far", distanceMeters: 1500 }]).kind, "none");
  assert.equal(summarizeParking([]).kind, "none");
});
check("today's opening hours are picked out of Google's week list", () => {
  const week = ["Monday: 9:00 AM – 5:00 PM", "Tuesday: Closed", "Sunday: 10:00 AM – 4:00 PM"];
  assert.equal(todaysHours(week, new Date(2026, 10, 16)), "9:00 AM – 5:00 PM"); // a Monday
  assert.equal(todaysHours(week, new Date(2026, 10, 17)), "Closed");
  assert.equal(todaysHours(week, new Date(2026, 10, 19)), null); // Thursday isn't listed
  assert.equal(todaysHours(undefined, new Date()), null);
});
check("a place from a shared link isn't looked up (it isn't a Google place)", () => {
  assert.equal(isLookupablePlaceId("shared:-33.85,151.21"), false);
  assert.equal(isLookupablePlaceId("ChIJ3S-JXmauEmsRUcIaWtf4MzE"), true);
  assert.equal(isLookupablePlaceId("osm:node:123"), true);
});

console.log("§5 route selection");
// A straight line of points heading east from (lat, lng), one every ~100 m.
const eastLine = (lat: number, lng: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ latitude: lat, longitude: lng + i * 0.001 }));
const SYD = -33.87;
const routeOf = (polyline: ReturnType<typeof eastLine>, minutes: number, km: number, extra: Partial<ChoiceRoute> = {}): ChoiceRoute => ({
  polyline,
  distanceMeters: km * 1000,
  durationSeconds: minutes * 60,
  durationInTrafficSeconds: minutes * 60,
  ...extra,
});
check("a route on the same road shares ~100% of its path; one 1 km away shares none", () => {
  const main = eastLine(SYD, 151.2, 50);
  assert.ok(sharedPathFraction(main, main) > 0.99);
  assert.equal(sharedPathFraction(main, eastLine(SYD + 0.009, 151.2, 50)), 0);
});
check("de-duplication drops an alternative that's >85% the same road as the best route", () => {
  const best = routeOf(eastLine(SYD, 151.2, 50), 10, 5);
  // Same road for 45 of 50 points, then a short detour: 90% shared.
  const nearCopy = eastLine(SYD, 151.2, 50).map((p, i) => (i >= 45 ? { ...p, latitude: p.latitude + 0.003 } : p));
  const different = routeOf(eastLine(SYD + 0.01, 151.2, 50), 12, 6);
  const kept = distinctRoutes([best, routeOf(nearCopy, 11, 5.4), different]);
  assert.equal(kept.length, 2);
  assert.ok(kept[0] === best && kept[1] === different);
});
check("de-duplication drops a route with identical time and distance even if re-encoded", () => {
  const best = routeOf(eastLine(SYD, 151.2, 50), 10, 5);
  const same = routeOf(eastLine(SYD + 0.02, 151.2, 50), 10, 5); // different points, same numbers
  assert.equal(distinctRoutes([best, same]).length, 1);
});
check("de-duplication keeps at most 3 routes, and always Google's first", () => {
  const routes = [0, 1, 2, 3, 4].map((i) => routeOf(eastLine(SYD + i * 0.01, 151.2, 30), 10 + i, 5 + i));
  const kept = distinctRoutes(routes);
  assert.equal(kept.length, 3);
  assert.ok(kept[0] === routes[0]);
});
check("traffic label thresholds: <=5% slower light, <=25% typical, beyond heavy", () => {
  const withTraffic = (free: number, live: number) => routeOf([], 0, 1, { durationSeconds: free, durationInTrafficSeconds: live });
  assert.equal(trafficLevel(withTraffic(600, 600)), "light");
  assert.equal(trafficLevel(withTraffic(600, 630)), "light"); // exactly 5%
  assert.equal(trafficLevel(withTraffic(600, 631)), "typical");
  assert.equal(trafficLevel(withTraffic(600, 750)), "typical"); // exactly 25%
  assert.equal(trafficLevel(withTraffic(600, 751)), "heavy");
  assert.equal(trafficLevel({ polyline: [], distanceMeters: 1, durationSeconds: 600 }), null); // no live data
});
check("route tags: first is Best, a minute-quicker one is Fastest, a toll-free one is No tolls", () => {
  const tolled = { hasToll: true };
  const free = { hasToll: false };
  const tags = routeTags([
    routeOf([], 20, 10, { tollEstimate: tolled }),
    routeOf([], 18, 12, { tollEstimate: tolled }),
    routeOf([], 24, 9, { tollEstimate: free }),
  ]);
  assert.deepEqual(tags, ["Best", "Fastest", "No tolls"]);
  // 30 seconds quicker isn't enough to be called Fastest.
  assert.deepEqual(routeTags([routeOf([], 20, 10), { ...routeOf([], 20, 10), durationInTrafficSeconds: 1170 }]), ["Best", null]);
});
check("the grey line reads 'Best route, Typical traffic · Toll'", () => {
  assert.equal(routeSummaryLine("Best", "typical", true), "Best route, Typical traffic · Toll");
  assert.equal(routeSummaryLine(null, "light", false), "Alternative route, Light traffic");
  assert.equal(routeSummaryLine("No tolls", null, false), "No tolls");
});
check("'Via' comes from Google's own description, never made up", () => {
  assert.equal(viaRoadLabel("M2"), "Via M2");
  assert.equal(viaRoadLabel("via Pacific Hwy"), "Via Pacific Hwy");
  assert.equal(viaRoadLabel(""), null);
  assert.equal(viaRoadLabel(undefined), null);
});
check("route times read '10 min', '1 h 5 min', '2 h'", () => {
  assert.equal(formatRouteDuration(600), "10 min");
  assert.equal(formatRouteDuration(20), "1 min");
  assert.equal(formatRouteDuration(3900), "1 h 5 min");
  assert.equal(formatRouteDuration(7200), "2 h");
});
check("the road a Routes API step turns onto is read from its English sentence only", () => {
  assert.equal(roadFromInstruction("Turn left onto George St", "en"), "George St");
  assert.equal(roadFromInstruction("Head north on Pitt St toward Market St", "en"), "Pitt St");
  assert.equal(roadFromInstruction("Keep left to continue on M1, follow signs for Sydney", "en"), "M1");
  assert.equal(roadFromInstruction("Turn right\nPass by the petrol station", "en"), undefined);
  assert.equal(roadFromInstruction("Gire a la izquierda en Calle Mayor", "es"), undefined);
});
check("U-turn avoidance drops routes with a U-turn, but never leaves no route", () => {
  const withU = routeOf([], 10, 5, { steps: [{ maneuver: "turn-left" }, { maneuver: "uturn-right" }] });
  const clean = routeOf([], 12, 6, { steps: [{ maneuver: "turn-left" }] });
  assert.deepEqual(withoutUturns([withU, clean]), { routes: [clean], allHaveUturns: false });
  assert.deepEqual(withoutUturns([withU]), { routes: [withU], allHaveUturns: true });
});
check("Avoid pill counts what's switched on; unsupported options can't be switched on", () => {
  assert.equal(avoidPillLabel(DEFAULT_ROUTE_AVOID), "Avoid");
  const two = { ...DEFAULT_ROUTE_AVOID, tolls: true, ferries: true };
  assert.equal(avoidCount(two), 2);
  assert.equal(avoidPillLabel(two), "Avoid · 2");
  const stored = normalizeRouteAvoid({ tolls: true, unpaved: true, motorways: "yes" });
  assert.deepEqual(stored, { ...DEFAULT_ROUTE_AVOID, tolls: true }); // unpaved unsupported, junk ignored
  assert.deepEqual(normalizeRouteAvoid(null), DEFAULT_ROUTE_AVOID);
  assert.deepEqual(avoidRouteOptions({ ...two, motorways: true }), { avoidTolls: true, avoidHighways: true, avoidFerries: true });
});
check("only slow and jammed stretches are drawn over the selected route", () => {
  const line = eastLine(SYD, 151.2, 10);
  const stretches = trafficStretches(line, [
    { startIndex: 0, endIndex: 3, speed: "NORMAL" },
    { startIndex: 3, endIndex: 6, speed: "SLOW" },
    { startIndex: 6, endIndex: 9, speed: "TRAFFIC_JAM" },
  ]);
  assert.equal(stretches.length, 2);
  assert.equal(stretches[0].coordinates.length, 4);
  assert.equal(stretches[1].speed, "TRAFFIC_JAM");
  assert.deepEqual(trafficStretches(line, undefined), []);
});
check("time bubbles sit where routes separate, far apart from each other", () => {
  // Two routes that share their first and last points but run 1 km apart in the middle.
  const a = eastLine(SYD, 151.2, 41);
  const b = a.map((p, i) => (i > 5 && i < 35 ? { ...p, latitude: p.latitude + 0.009 } : p));
  const [ba, bb] = bubbleAnchors([a, b], 0);
  assert.ok(ba && bb);
  assert.ok(distanceToPolylineMeters(ba!, b) > 500, "bubble A is clear of route B");
  assert.ok(distanceToPolylineMeters(bb!, a) > 500, "bubble B is clear of route A");
  // A lone route's bubble goes at its middle.
  const [only] = bubbleAnchors([a], 0);
  assert.ok(Math.abs(only!.longitude - a[20].longitude) < 0.0002);
});

console.log(`\n${passed} checks passed`);
