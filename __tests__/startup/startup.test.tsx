// Startup §1: never a blank screen (a soft grid while tiles load), controls in their final places
// from the first frame, and the camera starting on the last known place then easing to the fix.
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { render, screen } from "@testing-library/react-native";
import { LoadingGrid, MAP_LOADING_GRID } from "@/map-v2/LoadingGrid";
import { loadLastLocation, saveLastLocation, shouldSave, SAVE_EVERY_M, SAVE_EVERY_MS } from "@/map/lastLocation";

describe("loading grid", () => {
  it("renders our grid, light and dark (a soft pattern, not white or black)", async () => {
    await render(<LoadingGrid dark={false} />);
    expect(screen.getByTestId("map-loading-grid")).toBeTruthy();
    for (const c of [MAP_LOADING_GRID.light, MAP_LOADING_GRID.dark]) {
      expect(c.ground).not.toMatch(/^#(FFFFFF|000000)$/i);
      expect(c.line).not.toBe(c.ground);
    }
  });
  it("TrackLineMap shows it until the map has drawn its first frame, in the map's scheme", () => {
    const src = readFileSync("src/map-v2/TrackLineMap.tsx", "utf8");
    expect(src).toMatch(/\{!firstFrame && !loadError \? <LoadingGrid dark=\{props\.theme === "dark" \|\| props\.satellite\} \/> : null\}/);
    expect(src).toMatch(/onDidFinishLoadingMap=\{\(\) => \{\s*setFirstFrame\(true\);/);
  });
});

describe("controls in their final places from the first frame", () => {
  it("the sheet height the controls ride on starts at the sheet's peek, not 0", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/const sheetVisibleHeight = useSharedValue\(whereToHeights\.peek\);/);
    expect(src).not.toMatch(/useSharedValue\(0\);\s*\n\s*\/\/ Real/);
  });
});

describe("start on the last known place", () => {
  it("saves at most every 30 s or 200 m", () => {
    const a = { latitude: -33.9, longitude: 151, at: 0 };
    expect(shouldSave(null, a)).toBe(true);
    expect(shouldSave(a, { ...a, at: SAVE_EVERY_MS - 1 })).toBe(false);
    expect(shouldSave(a, { ...a, at: SAVE_EVERY_MS })).toBe(true);
    expect(shouldSave(a, { latitude: -33.9 + (SAVE_EVERY_M + 20) / 111_000, longitude: 151, at: 1000 })).toBe(true);
  });
  it("round-trips through the phone's storage and rejects junk", async () => {
    await saveLastLocation(-33.87, 151.21, 1_000_000);
    expect(await loadLastLocation()).toMatchObject({ latitude: -33.87, longitude: 151.21 });
  });
  it("MapScreen moves to the cached place only while there's no live fix; the fix then eases in (follow, 500 ms)", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/if \(cancelled \|\| !cached \|\| liveFixRef\.current\) return;\s*camera\.move\("follow", \{ center: \{ latitude: cached\.latitude, longitude: cached\.longitude \}, zoom: HOME_FOLLOW_ZOOM \}, \{ duration: 0 \}\);/);
    expect(src).toMatch(/camera\.move\("follow", \{ center: currentLatLng, heading: bearing, zoom: HOME_FOLLOW_ZOOM \}, \{ duration: 500 \}\)/);
  });
});
