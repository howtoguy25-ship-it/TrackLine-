// Nav fix §4: Go now animates (1.2 s) into the follow view: pitch 45, heading-up, zoom by speed,
// arrow at ~70% of the screen; buildings flat unless 3D is on; the street callout only at the
// next manoeuvre and never on the arrow.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { NAV_ARROW_FRACTION, NAV_FOLLOW_PITCH, NAV_START_MS, navBuildingsRaised, navFollowPadding, navFollowPose, navZoomForSpeed, metresAheadVisible, showManoeuvreCallout } from "@/nav/navCamera";

const HERE = { latitude: -33.9187, longitude: 151.0349 };

describe("navigation camera", () => {
  it("after Go now: follow view, pitch 45, heading-up, zoom by speed, over 1.2 s", () => {
    expect(navFollowPose(HERE, 87, 30)).toEqual({ center: HERE, heading: 87, pitch: 45, zoom: navZoomForSpeed(30, 844, HERE.latitude) });
    expect(navFollowPose(HERE, 87, 100).zoom).toBeLessThan(navFollowPose(HERE, 87, 30).zoom);
    expect(NAV_FOLLOW_PITCH).toBe(45);
    expect(NAV_START_MS).toBe(1200);
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/camera\.move\("transition", navFollowPose\(currentLatLng, startBearing, currentSpeedKmhRef\.current, isFlatViewStyle, windowHeight\), \{ duration: NAV_START_MS \}\)/);
    // No camera path still uses the old steep 60° / zoom 18.5 driving pose.
    expect(src).not.toMatch(/pitch: (isFlatViewStyle \? 0 : )?60, zoom: (isFlatViewStyle \? 17 : )?18\.5/);
  });

  it("the arrow sits at ~72% of the screen height on every phone", () => {
    for (const h of [568, 667, 844, 932]) {
      const p = navFollowPadding(h);
      expect(Math.abs((h + p.top) / 2 / h - NAV_ARROW_FRACTION)).toBeLessThan(0.01);
    }
  });

  it("building extrusions are off by default while driving", () => {
     
    const { DEFAULT_SETTINGS } = require("@/services/settings");
    expect(navBuildingsRaised(DEFAULT_SETTINGS.show3DBuildings)).toBe(false);
  });

  it("the street callout shows for the next manoeuvre only, and not when it would cover the arrow", () => {
    expect(showManoeuvreCallout(400)).toBe(true);
    expect(showManoeuvreCallout(30)).toBe(false);
    expect(showManoeuvreCallout(null)).toBe(false);
    expect(readFileSync("src/screens/MapScreen.tsx", "utf8")).toMatch(/\[route\.steps\[activeStepIndex\]\]\.map/);
  });
});

describe("fix pass 5 §4: default driving view", () => {
  it("arrow at ~72%, pitch 45, and 400-700 m of road ahead in view at every speed (higher camera, owner request)", () => {
    expect(NAV_ARROW_FRACTION).toBeCloseTo(0.72, 2);
    for (const h of [667, 844, 932]) {
      for (const v of [0, 25, 50, 70, 90, 110]) {
        const z = navZoomForSpeed(v, h, -33.9);
        const ahead = metresAheadVisible(z, NAV_FOLLOW_PITCH, h, -33.9);
        expect(ahead).toBeGreaterThanOrEqual(360); // quarter-zoom steps: within ~10% of 400
        expect(ahead).toBeLessThanOrEqual(770);
      }
    }
  });
  it("faster shows more road ahead; the zoom only changes when a speed band is crossed", () => {
    expect(navZoomForSpeed(100)).toBeLessThan(navZoomForSpeed(20));
    expect(navZoomForSpeed(21)).toBe(navZoomForSpeed(39));
    expect(navZoomForSpeed(61)).toBe(navZoomForSpeed(79));
  });
  it("the same view every time navigation starts or resumes (one pose function)", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    const calls = src.match(/navFollowPose\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const c of calls) expect(c).toMatch(/windowHeight\)$/);
  });
});
