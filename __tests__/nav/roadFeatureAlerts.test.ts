// Road features are alerts, not dots (src/nav/roadFeatureAlerts.ts + MapScreen): no feature dots
// outside navigation; while driving only features ON the route ahead within 1 km, at most three
// icons, the "Show on map" switch respected; the chip counts down and goes once passed; voice once
// at ~300 m.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import {
  MAX_ROUTE_FEATURE_ICONS,
  ROUTE_FEATURE_AHEAD_M,
  VOICE_AT_M,
  chipRemainingM,
  featureChipText,
  routeFeatureIcons,
  routeFeaturesAhead,
  shouldSpeakFeature,
  type RouteFeature,
} from "@/nav/roadFeatureAlerts";

const LAT = -33.9;
const M_LNG = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
// A straight 3 km road east.
const route = Array.from({ length: 31 }, (_, i) => ({ latitude: LAT, longitude: 151 + i * 100 * M_LNG }));
const at = (key: string, item: RouteFeature["item"], metresAlong: number, offM = 0): RouteFeature => ({ key, item, lat: LAT + offM / 111_320, lng: 151 + metresAlong * M_LNG });

describe("which features count", () => {
  const features = [
    at("bump", "speedBump", 200),
    at("cross", "pedestrianCrossing", 450),
    at("rail", "railwayCrossing", 700),
    at("cam", "speedCamera", 900),
    at("far", "speedBump", 1500), // beyond 1 km
    at("behind", "speedBump", 50), // already passed
    at("side", "speedBump", 300, 120), // on a side street, 120 m off the route
  ];
  it("only on the route, ahead, within 1 km; nearest first, with the distance to each", () => {
    const ahead = routeFeaturesAhead(features, route, 100);
    expect(ahead.map((f) => f.key)).toEqual(["bump", "cross", "rail", "cam"]);
    expect(Math.round(ahead[0].aheadM)).toBe(100);
    expect(ROUTE_FEATURE_AHEAD_M).toBe(1000);
  });
  it("at most three icons, and only those with 'Show on map' on", () => {
    const ahead = routeFeaturesAhead(features, route, 100);
    expect(routeFeatureIcons(ahead, () => true).map((f) => f.key)).toEqual(["bump", "cross", "rail"]);
    expect(MAX_ROUTE_FEATURE_ICONS).toBe(3);
    expect(routeFeatureIcons(ahead, (item) => item !== "pedestrianCrossing").map((f) => f.key)).toEqual(["bump", "rail", "cam"]);
  });
});

describe("the chip and the voice", () => {
  it("'Speed bump ahead · 200 m', counting down; gone once passed", () => {
    expect(featureChipText("speedBump", 200, "km")).toBe("Speed bump ahead · 200 m");
    expect(chipRemainingM(500, 300)).toBe(200);
    expect(chipRemainingM(500, 480)).toBe(20);
    expect(chipRemainingM(500, 505)).toBeNull();
  });
  it("speaks once, at about 300 m", () => {
    expect(VOICE_AT_M).toBe(300);
    expect(shouldSpeakFeature(600, false)).toBe(false);
    expect(shouldSpeakFeature(290, false)).toBe(true);
    expect(shouldSpeakFeature(150, true)).toBe(false);
  });
});

describe("MapScreen uses it", () => {
  const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
  it("no feature, traffic-light or camera dots outside navigation", () => {
    expect(src).not.toMatch(/showsTrafficLightPins\(settings\)/);
    expect(src).not.toMatch(/showsSpeedCameraPins\(settings\)/);
    expect(src).not.toMatch(/for \(const p of osmFeaturePins\(settings, osmData, nearbyAlerts\)\) \{\n\s*add\(/);
    // While driving, the route icons are the ahead alerts (nav/ahead): only with a route, within
    // 1.5 km, at most three.
    expect(src).toMatch(/if \(!route \|\| travelMode !== "driving"\) return \[\];/);
    expect(src).toMatch(/aheadFeedNow\.filter\(\(x\) => \(x\.source === "map" \|\| x\.source === "traffic"\) && x\.aheadM <= MAP_ICONS_AHEAD_M\)\.slice\(0, MAX_MAP_ICONS\)/);
  });
  it("navigating: the ahead banner warns; free driving: the chip and its voice", () => {
    expect(src).toMatch(/<AheadBanner/);
    expect(src).toMatch(/if \(route \|\| !currentLatLng \|\| travelMode !== "driving" \|\| approachFeatures\.length === 0\) return;/);
    expect(src).toMatch(/featureChipText\(approachChip\.item, chipAheadM \?\? approachChip\.distanceM/);
  });
});
