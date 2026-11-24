// The Waze-match clean-up, checked on the components the live screens actually render:
// no traffic legend pill, no dashcam badge on Menu, one square report button, a full-width nav
// top bar with no eye/chevron, nothing over the arrival time, the limit sign above the dial.
import React from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";

jest.mock("expo-haptics", () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("expo-audio", () => require("../support/stubs").stubService());

import { HomeMapControls } from "@/components/HomeMapControls";
import { NavigationInstructionCard } from "@/components/NavigationInstructionCard";
import { NavBottomBar } from "@/components/NavBottomBar";
import { LiveSpeedometer, SIGN_GAP } from "@/components/LiveSpeedometer";
import type { RouteStep } from "@/services/directions";

const mapScreen = readFileSync(join(__dirname, "../../src/screens/MapScreen.tsx"), "utf8");
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const shared = (v: number) => ({ value: v, get: () => v, set: () => {} }) as never;
const wrap = (el: React.ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{el}</SafeAreaProvider>;

const step: RouteStep = {
  instruction: "Turn left onto A6/Stacey Street. Continue on A6.",
  maneuver: "turn-left",
  distanceMeters: 400,
  durationSeconds: 30,
  startLocation: { latitude: -33.9, longitude: 151.0 },
  endLocation: { latitude: -33.901, longitude: 151.001 },
  polyline: [],
  targetStreetName: "A6/Stacey St",
} as RouteStep;

describe("home map", () => {
  it("no traffic legend pill anywhere on the map screen", () => {
    expect(mapScreen).not.toMatch(/Some traffic|trafficLegend/);
  });
  it("no Front view pill and no floating loading spinner badges", () => {
    expect(mapScreen).not.toMatch(/"Front view"|osmLoadingBadge|placeInfoLoadingBadge|<MuteButton/);
  });

  it("Menu has no dashcam badge; there's one report button and it's a rounded square", async () => {
    await render(
      <HomeMapControls
        {...({
          sheetVisibleHeight: shared(200),
          sheetHalfHeight: 420,
          bottomInset: 0,
          topInset: 0,
          unreadCount: 0,
          onMenu: jest.fn(),
          showCompass: true,
          bearing: shared(0),
          onCompass: jest.fn(),
          showAudioPlayer: true,
          onAudioPlayer: jest.fn(),
          soundOff: false,
          onSound: jest.fn(),
          onReport: jest.fn(),
          showRecenter: false,
          onRecenter: jest.fn(),
        } as unknown as React.ComponentProps<typeof HomeMapControls>)}
      />
    );
    expect(screen.getAllByLabelText("Report something on the road")).toHaveLength(1);
    const report = StyleSheet.flatten(screen.getByTestId("report-button").props.style);
    expect(report.borderRadius).toBeLessThan((report.width as number) / 2);
    expect(screen.queryByLabelText(/dashcam/i)).toBeNull();
    expect(readFileSync(join(__dirname, "../../src/components/HomeMapControls.tsx"), "utf8")).not.toMatch(/dashcamBadge/);
  });
});

describe("navigation", () => {
  it("top bar: full width from the top edge, big distance, street on one line, no eye/chevron/sentence", async () => {
    await render(wrap(<NavigationInstructionCard step={step} roadName={null} themeKey="dark" onExpandDirections={jest.fn()} metersToManoeuvre={40} />));
    const bar = StyleSheet.flatten(screen.getByTestId("nav-top-bar").props.style);
    expect(bar).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0 });
    expect(screen.getByTestId("nav-distance").props.children).toBe("40 m");
    expect(screen.getByTestId("nav-street").props.children).toBe("Stacey St");
    expect(screen.getByTestId("nav-street").props.numberOfLines).toBe(1);
    expect(screen.getByText("A6")).toBeTruthy(); // the road shield
    expect(screen.queryByText(/Continue on A6/)).toBeNull(); // spoken, not printed
    expect(screen.queryByLabelText(/transparent|Collapse|Expand navigation card|Exit navigation/)).toBeNull();
  });

  it("bottom bar: search · arrival time · routes; Overview is the routes button, nothing sits on the time", async () => {
    const onOverview = jest.fn();
    await render(
      wrap(
        <NavBottomBar
          etaText="25 min"
          arrivalClockText="10:54 pm"
          distanceRemainingText="28 km"
          roadName={null}
          themeKey="dark"
          hasStop={false}
          onAddStop={jest.fn()}
          onRemoveStop={jest.fn()}
          onOptions={jest.fn()}
          onOverview={onOverview}
        />
      )
    );
    expect(screen.getByText("10:54 pm")).toBeTruthy();
    expect(screen.getByText("25 min • 28 km")).toBeTruthy();
    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.getByTestId("nav-search")).toBeTruthy();
    expect(screen.getByTestId("nav-routes")).toBeTruthy();
    expect(screen.queryByTestId("nav-recenter")).toBeNull(); // the bar never carries it (fix pass 5: NavMapControls' pill)
  });

  it("re-centre is no longer drawn by the bar (it's the bottom-left pill in NavMapControls)", async () => {
    await render(
      wrap(
        <NavBottomBar etaText="25 min" arrivalClockText="10:54 pm" distanceRemainingText="28 km" roadName={null} themeKey="dark" hasStop={false} onAddStop={jest.fn()} onRemoveStop={jest.fn()} onOptions={jest.fn()} onOverview={jest.fn()} />
      )
    );
    expect(screen.queryByTestId("nav-recenter")).toBeNull();
  });
});

describe("speedometer", () => {
  it("the speed limit sign sits above the dial with an 8pt gap", async () => {
    await render(
      <LiveSpeedometer speedKmh={62} speedLimitKmh={60} unit="km/h" signStyle="ring" schoolZone={null} visible showLimit chimeEnabled={false} />
    );
    const tree = JSON.stringify(screen.toJSON());
    // Sign first (above), dial second, in a column with an 8pt gap.
    expect(tree.indexOf("speedometer-limit")).toBeGreaterThan(-1);
    expect(tree.indexOf("speedometer-limit")).toBeLessThan(tree.indexOf("speedometer-dial"));
    const column = screen.getByTestId("speedometer-limit").parent;
    let node = column;
    while (node && StyleSheet.flatten(node.props.style)?.flexDirection !== "column") node = node.parent;
    expect(StyleSheet.flatten(node!.props.style)).toMatchObject({ flexDirection: "column", gap: SIGN_GAP });
  });
});
