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

console.log(`\n${passed} checks passed`);
