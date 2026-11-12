// No crashes on missing data: no lanes, no exit number, no road name, no junction view -- each
// falls back to the plain instruction.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationInstructionCard } from "@/components/NavigationInstructionCard";
import { LaneStrip } from "@/components/nav/LaneStrip";
import { JunctionViewCard } from "@/components/nav/JunctionViewCard";
import { calloutLabel, confirmationText } from "@/nav/manoeuvre";
import { laneSentence } from "@/nav/lanes";
import { planStepAnnouncement } from "@/services/navSpeechPlan";
import { manoeuvreHighlight } from "@/nav/approach";
import type { RouteStep } from "@/services/directions";

const bare: RouteStep = {
  instruction: "Take the exit",
  maneuver: "ramp-left",
  distanceMeters: 300,
  durationSeconds: 20,
  startLocation: { latitude: -33.8, longitude: 151 },
  endLocation: { latitude: -33.801, longitude: 151.001 },
  polyline: [],
  maneuverKind: "exit",
};

describe("missing data falls back to the plain instruction", () => {
  it("the top card renders with no lanes, no exit number, no road name", async () => {
    await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <NavigationInstructionCard step={bare} roadName={null} themeKey="dark" onExit={jest.fn()} onExpandDirections={jest.fn()} lanes={null} />
      </SafeAreaProvider>
    );
    expect(screen.queryByTestId("lane-strip")).toBeNull();
    expect(screen.getAllByText(/Take the exit/).length).toBeGreaterThan(0);
  });
  it("lane strip with no lanes draws nothing", async () => {
    await render(<LaneStrip lanes={[]} />);
    expect(screen.queryByTestId("lane-strip")).toBeNull();
  });
  it("junction view with no picture draws nothing", async () => {
    await render(<JunctionViewCard url={undefined} token="" top={0} />);
    expect(screen.queryByTestId("junction-view")).toBeNull();
  });
  it("callout, chip and voice cope without exit number, road ref or name", () => {
    expect(calloutLabel({ maneuverKind: "exit" })).toBe("Exit");
    expect(calloutLabel({})).toBeNull();
    expect(confirmationText(undefined)).toBe("Turn complete ✓");
    expect(laneSentence({ lanes: undefined, kind: "exit" })).toBeNull();
    const plan = planStepAnnouncement({ step: bare, distanceMeters: 200, kind: "final" }, "km", "en");
    expect(JSON.stringify(plan)).toMatch(/Take the exit/);
  });
  it("no highlight (rather than a crash) for a step without geometry", () => {
    expect(manoeuvreHighlight([bare, bare], 0)).toBeNull();
  });
});
