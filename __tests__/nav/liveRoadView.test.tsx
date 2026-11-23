// Live road view panel + camera: only what the camera tracks is drawn, the states are real, every
// button does something, and the camera half turns model output into scene vehicles.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { LiveRoadView } from "@/components/LiveRoadView";
import type { SceneVehicle } from "@/nav/liveScene";

const car = (id: number, z: number, x = 0): SceneVehicle => ({ id, kind: "car", x, z, close: z < 12, speedKmh: null });
const base = { route: [], dark: false, height: 240, onTurnOff: () => {}, onRetry: () => {}, onOpenSettings: () => {} };

async function laidOut(ui: React.ReactElement) {
  const r = await render(ui);
  await act(async () => {
    fireEvent(r.getByTestId("live-road-view"), "layout", { nativeEvent: { layout: { width: 360, height: 240 } } });
  });
  return r;
}

describe("live road view panel", () => {
  it("counts what the camera tracks right now; an empty road says so", async () => {
    const r = await laidOut(<LiveRoadView {...base} status="running" vehicles={[car(1, 20), car(2, 40, 3.5)]} />);
    expect(r.getByTestId("live-road-count").props.children).toBe("Live view · 2 vehicles");
    expect(r.getByTestId("live-route-line", { includeHiddenElements: true })).toBeTruthy();
    const empty = await laidOut(<LiveRoadView {...base} status="running" vehicles={[]} />);
    expect(empty.getByTestId("live-road-count").props.children).toBe("Live view · no vehicles in view");
  });

  it("nothing is drawn as vehicles until the camera is running", async () => {
    const r = await laidOut(<LiveRoadView {...base} status="starting" vehicles={[car(1, 20)]} />);
    expect(r.getByText("Starting the camera…")).toBeTruthy();
    expect(r.getByTestId("live-road-count").props.children).toBe("Live view");
  });

  it("no camera access: says why and opens Settings", async () => {
    const onOpenSettings = jest.fn();
    const r = await laidOut(<LiveRoadView {...base} status="noPermission" vehicles={[]} onOpenSettings={onOpenSettings} />);
    await fireEvent.press(r.getByTestId("live-road-settings"));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("model didn't load: Try again retries", async () => {
    const onRetry = jest.fn();
    const r = await laidOut(<LiveRoadView {...base} status="modelFailed" vehicles={[]} onRetry={onRetry} />);
    expect(r.getByText("The vehicle model didn't load.")).toBeTruthy();
    await fireEvent.press(r.getByTestId("live-road-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("the close button turns the view off", async () => {
    const onTurnOff = jest.fn();
    const r = await laidOut(<LiveRoadView {...base} status="running" vehicles={[]} onTurnOff={onTurnOff} />);
    await fireEvent.press(r.getByTestId("live-road-off"));
    expect(onTurnOff).toHaveBeenCalled();
  });
});

describe("wiring", () => {
  const read = (f: string) => require("fs").readFileSync(f, "utf8") as string;
  it("MapScreen: shown only with the toggle on while navigating a driving route; arrow and controls move above it", () => {
    const src = read("src/screens/MapScreen.tsx");
    expect(src).toMatch(/const liveViewOn = liveViewShown\(settings\.liveRoadView, !!route, travelMode === "driving"\) && !detectionOpen;/);
    expect(src).toMatch(/navFollowPadding\(windowHeight, liveViewReserved\)/);
    expect(src).toMatch(/bottomBarHeight=\{liveViewOn \? bottomBarHeight \+ 8 \+ liveViewH : bottomBarHeight\}/);
    expect(src).toMatch(/onTurnOff=\{\(\) => updateSettings\(\{ liveRoadView: false \}\)\}/);
    expect(src).toMatch(/routeAhead\(navGeo, navMatch\.along/);
  });
  it("the camera: same model and tracker as vehicle detection, 10 s model limit, nothing recorded", () => {
    const src = read("src/components/LiveVehicleCamera.tsx");
    expect(src).toMatch(/loadBoxedTFLiteModel\(\)/);
    expect(src).toMatch(/createBoxTracker\(\)/);
    expect(src).toMatch(/export const MODEL_TIMEOUT_MS = 10_000;/);
    expect(src).not.toMatch(/takePhoto|startRecording/);
    expect(src).toMatch(/isActive=\{focused && ready\}/);
  });
  it("Settings: the toggle is off by default", () => {
    const { DEFAULT_SETTINGS } = require("@/services/settings");
    expect(DEFAULT_SETTINGS.liveRoadView).toBe(false);
    expect(read("src/screens/SettingsScreen.tsx")).toMatch(/title="Live road view"/);
  });
});
