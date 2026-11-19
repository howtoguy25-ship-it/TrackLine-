// Route preview + route list (nav fix §1-§2): the camera fits every route + start + destination
// in the space the measured UI leaves, flat and north-up; bubbles never overlap; the selected
// route stays fully visible above the sheet at both snap points; the camera no longer snaps back
// to the driver on every GPS fix while choosing a route.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import {
  MAX_SHEET_FRACTION,
  PREVIEW_PITCH,
  allVisible,
  boundsOf,
  bubblesOverlap,
  previewEdgePadding,
  previewFitCoordinates,
  projectFitted,
} from "@/nav/previewCamera";
import { bubbleAnchors } from "@/map/routeChoices";

// 323 Stacey St, Bankstown -> 40 Bazentin St, Belfield: three real-shaped alternatives.
const START = { latitude: -33.9187, longitude: 151.0349 };
const END = { latitude: -33.9064, longitude: 151.0857 };
const via = (pts: [number, number][]) => [START, ...pts.map(([latitude, longitude]) => ({ latitude, longitude })), END];
const ROUTES = [
  via([[-33.917, 151.045], [-33.913, 151.06], [-33.909, 151.074]]),
  via([[-33.925, 151.05], [-33.922, 151.068], [-33.912, 151.082]]),
  via([[-33.908, 151.04], [-33.901, 151.058], [-33.902, 151.075]]),
];
const PHONES = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

describe("route preview fit (§1)", () => {
  it("fits every coordinate of every route, plus the start and destination", () => {
    const coords = previewFitCoordinates(ROUTES, START, END);
    expect(coords.length).toBe(ROUTES.reduce((n, r) => n + r.length, 0) + 2);
    for (const line of ROUTES) for (const p of line) expect(coords).toContainEqual(p);
  });

  it("padding is the measured top card + 24, the sheet's current height + 24, and 32 at the sides", () => {
    expect(previewEdgePadding(180, 300)).toEqual({ top: 204, bottom: 324, left: 32, right: 32 });
    // Recomputed when the sheet grows.
    expect(previewEdgePadding(180, 480).bottom).toBe(504);
  });

  it("after the fit, every route point is inside the free area, on every phone size", () => {
    const coords = previewFitCoordinates(ROUTES, START, END);
    const fit = boundsOf(coords)!;
    for (const vp of PHONES) {
      const pad = previewEdgePadding(140, vp.height * 0.3);
      expect(allVisible(projectFitted(coords, fit, vp, pad), vp, pad)).toBe(true);
    }
  });

  it("time bubbles sit at points unique to each route and never overlap after the fit", () => {
    const anchors = bubbleAnchors(ROUTES, 0) as { latitude: number; longitude: number }[];
    expect(anchors.every(Boolean)).toBe(true);
    const fit = boundsOf(previewFitCoordinates(ROUTES, START, END))!;
    for (const vp of PHONES.slice(1)) {
      const pad = previewEdgePadding(140, vp.height * 0.3);
      expect(bubblesOverlap(projectFitted(anchors, fit, vp, pad))).toBe(false);
    }
  });

  it("the preview camera is flat (pitch 0) and north-up; no raised buildings at pitch 0", () => {
    expect(PREVIEW_PITCH).toBe(0);
    const map = readFileSync("src/map-v2/TrackLineMap.tsx", "utf8");
    expect(map).toMatch(/pitch: PREVIEW_PITCH/);
    expect(map).toMatch(/props\.show3DBuildings && pitch > BUILDING_EXTRUSION_MIN_PITCH/);
  });

  it("root cause stays fixed: the follow-the-driver camera does not run while choosing a route", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/userMovedMapRef\.current \|\| placePage \|\| pendingDestination\) return;/);
    // And the fit re-runs when the top card or the sheet changes size.
    expect(src).toMatch(/\[previewFit, inRouteSelection, mapReady, routeTopCardBottom, routeSheetHeight\]/);
  });
});

describe("route list sheet (§2)", () => {
  it("the selected route is fully visible above the sheet, collapsed and pulled up", () => {
    const selected = ROUTES[1];
    const coords = previewFitCoordinates([selected], START, END);
    const fit = boundsOf(coords)!;
    for (const vp of PHONES) {
      for (const sheet of [vp.height * 0.28, vp.height * MAX_SHEET_FRACTION]) {
        const pad = previewEdgePadding(140, sheet);
        expect(allVisible(projectFitted(coords, fit, vp, pad), vp, pad)).toBe(true);
        // ...and at least 40% of the screen is left for the map.
        expect(sheet).toBeLessThanOrEqual(vp.height * 0.6 + 0.001);
      }
    }
  });

  it("the sheet reports its current height (so the map re-fits) and caps the list at 60%", () => {
    const src = readFileSync("src/components/RouteSelection.tsx", "utf8");
    expect(src).toMatch(/onHeightChange\?\.\(currentHeight\)/);
    expect(src).toMatch(/windowHeight \* MAX_SHEET_FRACTION - collapsedHeight/);
    expect(readFileSync("src/screens/MapScreen.tsx", "utf8")).toMatch(/onHeightChange=\{setRouteSheetHeight\}/);
  });
});

describe("fix pass 4: preview rules", () => {
  it("the route sheet never covers more than 55% of the screen; preview is flat with no raised buildings", () => {
    expect(MAX_SHEET_FRACTION).toBe(0.55);
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/show3DBuildings=\{settings\.show3DBuildings && !inRouteSelection\}/);
  });
});
