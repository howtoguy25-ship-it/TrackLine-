// Pass 3 §3: the driver is TrackLine's own 3D teal arrow (no dot, no flat cone), on the home map
// and while navigating; a chosen vehicle replaces it; it scales a little with zoom.
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { render } from "@testing-library/react-native";
import { CarNavArrow, NavArrow3D, LIVE_MARKER_TEAL } from "@/components/LocationMarkers";
import { PUCK_SCALE } from "@/map-v2/layers/UserPuck";

describe("navigation arrow", () => {
  it("default marker is the 3D arrow: two teal faces (light + bevel), a white outline and a shadow", async () => {
    const r = await render(<CarNavArrow markerStyle="default" />);
    const json = JSON.stringify(r.toJSON());
    const fills = Array.from(json.matchAll(/"fill":"?([^",}]+)/g)).map((m) => m[1]);
    expect(json).toContain("RNSVGEllipse");
    expect(fills.filter((f) => f !== "none" && !f.startsWith("rgba")).length).toBeGreaterThanOrEqual(2);
    expect(json).toMatch(/"stroke":/);
    expect(LIVE_MARKER_TEAL).toBe("#14B8A6");
    const a = await render(<NavArrow3D />);
    expect(a.toJSON()).toBeTruthy();
  });

  it("the puck always shows the arrow (home and navigating) and never draws the old cone or dot", () => {
    const src = readFileSync("src/map-v2/layers/UserPuck.tsx", "utf8");
    expect(src).toMatch(/puckBearingEnabled\s*\n/);
    expect(src).not.toMatch(/heading-cone|coneIcon|dotIcon|me-cone/);
    const icons = readFileSync("src/map-v2/layers/MapIcons.tsx", "utf8");
    expect(icons).not.toMatch(/heading-cone/);
  });

  it("scales a little with zoom: smaller zoomed out, full size at street level", () => {
    const stops = PUCK_SCALE.slice(3) as number[];
    const pairs: [number, number][] = [];
    for (let i = 0; i < stops.length; i += 2) pairs.push([stops[i], stops[i + 1]]);
    expect(pairs.find(([z]) => z === 10)?.[1]).toBeLessThan(1);
    expect(pairs.find(([z]) => z === 17)?.[1]).toBe(1);
  });
});
