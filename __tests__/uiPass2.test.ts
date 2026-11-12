// Jest unit tests for the rules behind UI pass 2 that the spec asked to be tested: route
// de-duplication, traffic label thresholds, the street-pill lookup throttle, distance formatting
// and the floating buttons hiding above the half sheet. (scripts/test-ui-logic.ts has the wider
// set of plain checks for every section.) Run with: npx jest
import { describe, expect, it } from "@jest/globals";
import { distinctRoutes, sharedPathFraction, trafficLevel, type ChoiceRoute } from "../src/map/routeChoices";
import {
  STREET_LOOKUP_MIN_MOVE_M,
  StreetNameTracker,
  floatingButtonsInteractive,
  floatingButtonsOpacity,
} from "../src/map/homeMapLogic";
import { formatDistance } from "../src/utils/navFormat";

const SYD = -33.87;
const eastLine = (lat: number, lng: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ latitude: lat, longitude: lng + i * 0.001 }));
const routeOf = (polyline: ChoiceRoute["polyline"], minutes: number, km: number): ChoiceRoute => ({
  polyline,
  distanceMeters: km * 1000,
  durationSeconds: minutes * 60,
  durationInTrafficSeconds: minutes * 60,
});

describe("route de-duplication", () => {
  it("measures how much of one route runs along another", () => {
    const main = eastLine(SYD, 151.2, 50);
    expect(sharedPathFraction(main, main)).toBeGreaterThan(0.99);
    expect(sharedPathFraction(main, eastLine(SYD + 0.009, 151.2, 50))).toBe(0);
  });

  it("drops an alternative sharing more than 85% of its path with a kept route", () => {
    const best = routeOf(eastLine(SYD, 151.2, 50), 10, 5);
    const nearCopy = eastLine(SYD, 151.2, 50).map((p, i) => (i >= 45 ? { ...p, latitude: p.latitude + 0.003 } : p));
    const different = routeOf(eastLine(SYD + 0.01, 151.2, 50), 12, 6);
    expect(distinctRoutes([best, routeOf(nearCopy, 11, 5.4), different])).toEqual([best, different]);
  });

  it("keeps an alternative that shares less than 85%", () => {
    const best = routeOf(eastLine(SYD, 151.2, 50), 10, 5);
    // Shares the first 20 of 50 points (40%), then runs 1 km north.
    const split = eastLine(SYD, 151.2, 50).map((p, i) => (i >= 20 ? { ...p, latitude: p.latitude + 0.009 } : p));
    expect(distinctRoutes([best, routeOf(split, 12, 6)])).toHaveLength(2);
  });

  it("drops a route with identical time and distance", () => {
    const best = routeOf(eastLine(SYD, 151.2, 50), 10, 5);
    expect(distinctRoutes([best, routeOf(eastLine(SYD + 0.02, 151.2, 50), 10, 5)])).toEqual([best]);
  });

  it("returns at most three, always starting with Google's first", () => {
    const routes = [0, 1, 2, 3].map((i) => routeOf(eastLine(SYD + i * 0.01, 151.2, 30), 10 + i, 5 + i));
    const kept = distinctRoutes(routes);
    expect(kept).toHaveLength(3);
    expect(kept[0]).toBe(routes[0]);
  });
});

describe("traffic label thresholds", () => {
  const withTraffic = (free: number, live: number): ChoiceRoute => ({
    polyline: [],
    distanceMeters: 1000,
    durationSeconds: free,
    durationInTrafficSeconds: live,
  });

  it.each([
    [600, 600, "light"],
    [600, 630, "light"], // exactly 5% slower
    [600, 631, "typical"],
    [600, 750, "typical"], // exactly 25% slower
    [600, 751, "heavy"],
  ])("free-flow %ds, live %ds -> %s", (free, live, level) => {
    expect(trafficLevel(withTraffic(free, live))).toBe(level);
  });

  it("says nothing when Google gave no live-traffic time", () => {
    expect(trafficLevel({ polyline: [], distanceMeters: 1000, durationSeconds: 600 })).toBeNull();
  });
});

describe("street-pill lookup throttle", () => {
  const M = 1 / 111_320; // degrees of latitude per metre
  const fixAt = (metersNorth: number, heading = 0) => ({ latitude: -33.9 + metersNorth * M, longitude: 151.2, heading });

  it("makes no more than one paid lookup per 25 m driven", () => {
    const tracker = new StreetNameTracker();
    for (let m = 0; m <= 1000; m += 2) {
      const fix = fixAt(m);
      if (tracker.update(fix)) tracker.resolve(fix, "George St");
    }
    expect(tracker.lookupsStarted).toBeLessThanOrEqual(1000 / STREET_LOOKUP_MIN_MOVE_M);
    expect(tracker.lookupsStarted).toBeGreaterThanOrEqual(10);
  });

  it("makes exactly one lookup while parked, whatever the compass does", () => {
    const tracker = new StreetNameTracker();
    for (let s = 0; s < 600; s++) {
      const fix = fixAt(0, s % 2 === 0 ? 0 : 200);
      if (tracker.update(fix)) tracker.resolve(fix, "George St");
    }
    expect(tracker.lookupsStarted).toBe(1);
  });

  it("never has two lookups in flight", () => {
    const tracker = new StreetNameTracker();
    expect(tracker.update(fixAt(0))).toBe(true);
    expect(tracker.update(fixAt(100))).toBe(false);
    expect(tracker.lookupsStarted).toBe(1);
  });
});

describe("distance formatting", () => {
  it("shows tens of metres under 1 km and one decimal above", () => {
    expect(formatDistance(347, "km")).toBe("350 m");
    expect(formatDistance(3640, "km")).toBe("3.6 km");
  });

  it("uses miles when chosen", () => {
    expect(formatDistance(5000, "miles")).toMatch(/mi$/);
  });
});

describe("floating buttons above the half sheet", () => {
  const HALF = 420;

  it("are fully shown up to the half-sheet height", () => {
    expect(floatingButtonsOpacity(200, HALF)).toBe(1);
    expect(floatingButtonsOpacity(HALF, HALF)).toBe(1);
    expect(floatingButtonsInteractive(HALF, HALF)).toBe(true);
  });

  it("fade out over the next 48pt and can't be tapped once hidden", () => {
    expect(floatingButtonsOpacity(HALF + 24, HALF)).toBe(0.5);
    expect(floatingButtonsOpacity(HALF + 48, HALF)).toBe(0);
    expect(floatingButtonsOpacity(800, HALF)).toBe(0);
    expect(floatingButtonsInteractive(HALF + 40, HALF)).toBe(false);
  });
});
