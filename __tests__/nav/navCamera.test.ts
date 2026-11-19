// Nav fix §4: Go now animates (1.2 s) into the follow view: pitch 45, heading-up, zoom by speed,
// arrow at ~70% of the screen; buildings flat unless 3D is on; the street callout only at the
// next manoeuvre and never on the arrow.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { NAV_ARROW_FRACTION, NAV_FOLLOW_PITCH, NAV_START_MS, navBuildingsRaised, navFollowPadding, navFollowPose, showManoeuvreCallout } from "@/nav/navCamera";
import { speedZoomFor } from "@/map/speedZoom";

const HERE = { latitude: -33.9187, longitude: 151.0349 };

describe("navigation camera", () => {
  it("after Go now: follow view, pitch 45, heading-up, zoom by speed, over 1.2 s", () => {
    expect(navFollowPose(HERE, 87, 30)).toEqual({ center: HERE, heading: 87, pitch: 45, zoom: speedZoomFor(30) });
    expect(navFollowPose(HERE, 87, 100).zoom).toBeLessThan(navFollowPose(HERE, 87, 30).zoom);
    expect(NAV_FOLLOW_PITCH).toBe(45);
    expect(NAV_START_MS).toBe(1200);
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/navFollowPose\(currentLatLng, heading, currentSpeedKmhRef\.current, isFlatViewStyle\),\n\s*\{ duration: NAV_START_MS \}/);
    // No camera path still uses the old steep 60° / zoom 18.5 driving pose.
    expect(src).not.toMatch(/pitch: (isFlatViewStyle \? 0 : )?60, zoom: (isFlatViewStyle \? 17 : )?18\.5/);
  });

  it("the arrow sits at ~70% of the screen height on every phone", () => {
    for (const h of [568, 667, 844, 932]) {
      const p = navFollowPadding(h);
      expect(Math.abs((h + p.top) / 2 / h - NAV_ARROW_FRACTION)).toBeLessThan(0.01);
    }
  });

  it("building extrusions are off by default while driving", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
