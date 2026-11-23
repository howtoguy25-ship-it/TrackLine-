// Gap item 6: a toll booth / toll gantry on the route (OpenStreetMap barrier=toll_booth,
// highway=toll_gantry) -> "Toll point" ahead banner + "Toll ahead" spoken, only on the route and
// in the direction of travel, and gone with Settings > Reports > Toll booth > Alert off. Plus the
// per-route toll cost from Google's Routes API (TOLLS): the price Google gives, or "has a toll" with
// no price, never an invented amount.
import { describe, expect, it } from "@jest/globals";
import { classifyOverpass } from "@/services/osmTrafficData";
import { collectApproachFeatures } from "@/alerts/collectFeatures";
import { aheadSourcesFrom } from "@/nav/ahead/aheadSources";
import { aheadOf, projectFeed } from "@/nav/ahead/aheadFeed";
import { spokenLine } from "@/nav/ahead/aheadKinds";
import { warnDistanceM } from "@/nav/ahead/aheadTiming";
import { DEFAULT_SETTINGS } from "@/services/settings";
import { parseRoutesApiRoute } from "@/services/directions";

// A straight road north, ~1.1 km.
const route = [
  { latitude: -33.9, longitude: 151.0 },
  { latitude: -33.895, longitude: 151.0 },
  { latitude: -33.89, longitude: 151.0 },
];
const osm = classifyOverpass(
  [
    { type: "node", id: 1, lat: -33.893, lon: 151.0, tags: { highway: "toll_gantry" } },
    { type: "node", id: 2, lat: -33.893, lon: 151.01, tags: { barrier: "toll_booth" } }, // ~900 m off the route
  ],
  { wantTrafficLights: false, wantSpeedCameras: false, wantFeatures: ["tollBooth"] }
);

describe("toll ahead", () => {
  it("OSM toll gantry on the route -> one Toll point alert ahead, with its spoken line", () => {
    const features = collectApproachFeatures(DEFAULT_SETTINGS, { osm, alerts: [], incidents: [] });
    expect(features.map((f) => f.key).sort()).toEqual(["osm:tollBooth:1", "osm:tollBooth:2"]);
    const feed = projectFeed(aheadSourcesFrom(features, [], []), route);
    expect(feed.map((a) => a.key)).toEqual(["osm:tollBooth:1"]);
    const [toll] = aheadOf(feed, 100);
    expect(toll).toMatchObject({ kind: "toll", title: "Toll point", source: "map" });
    expect(toll.aheadM).toBeGreaterThan(600);
    expect(spokenLine(toll.kind, toll.title, null)).toBe("Toll point ahead");
    // Warned in time at 80 km/h (15 s of driving, 300 m minimum).
    expect(warnDistanceM(toll, 80 / 3.6)).toBeCloseTo(333, 0);
  });

  it("passed: no longer ahead", () => {
    const feed = projectFeed(aheadSourcesFrom(collectApproachFeatures(DEFAULT_SETTINGS, { osm, alerts: [], incidents: [] }), [], []), route);
    expect(aheadOf(feed, 900)).toEqual([]);
  });

  it("Settings > Reports > Toll booth > Alert off: no toll alerts", () => {
    const off = { ...DEFAULT_SETTINGS, reportPrefs: { ...DEFAULT_SETTINGS.reportPrefs, tollBooth: { ...DEFAULT_SETTINGS.reportPrefs?.tollBooth, alert: false } } } as typeof DEFAULT_SETTINGS;
    expect(collectApproachFeatures(off, { osm, alerts: [], incidents: [] })).toEqual([]);
  });
});

describe("toll cost per route (Routes API TOLLS)", () => {
  const base = { distanceMeters: 1000, staticDuration: "120s", duration: "130s", polyline: { encodedPolyline: "" }, legs: [] };
  it("Google's price", () => {
    const r = parseRoutesApiRoute({ ...base, travelAdvisory: { tollInfo: { estimatedPrice: [{ currencyCode: "AUD", units: "8", nanos: 950000000 }] } } }, true);
    expect(r.tollEstimate).toEqual({ hasToll: true, priceText: "$8.95" });
  });
  it("a toll with no price on file: says there's a toll, no amount", () => {
    expect(parseRoutesApiRoute({ ...base, travelAdvisory: { tollInfo: {} } }, true).tollEstimate).toEqual({ hasToll: true, priceText: null });
  });
  it("no toll on the route", () => {
    expect(parseRoutesApiRoute({ ...base }, true).tollEstimate).toEqual({ hasToll: false, priceText: null });
  });
});
