// Step 2: the lane strip (real lanes from the recorded M4 route) and the spoken lane sentence.
import React from "react";
import { StyleSheet } from "react-native";
import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import taken from "@/dev/testRoutes/m4-silverwater-taken.json";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { LaneStrip, LANE_TILE, laneAccessibilityLabel } from "@/components/nav/LaneStrip";
import { planStepAnnouncement } from "@/services/navSpeechPlan";
import { parseIntersectionLanes } from "@/nav/lanes";
import type { RouteStep } from "@/services/directions";

const exitStep = parseMapboxResponse(taken)[0].steps.find((s) => s.lanes && s.maneuverKind === "exit")!;

describe("lane strip", () => {
  it("one tile per lane, left to right: the route's lane go-blue and larger, the others dark", async () => {
    await render(<LaneStrip lanes={exitStep.lanes!} />);
    const valid = screen.getAllByTestId("lane-valid");
    const other = screen.getAllByTestId("lane-other");
    expect(valid).toHaveLength(1);
    expect(other).toHaveLength(3);
    const v = StyleSheet.flatten(valid[0].props.style);
    const o = StyleSheet.flatten(other[0].props.style);
    expect(v.backgroundColor).toBe(LANE_TILE.valid.fill);
    expect(o.backgroundColor).toBe(LANE_TILE.other.fill);
    expect(Number(v.width)).toBeGreaterThan(Number(o.width));
  });

  it("tells a screen reader which lanes to use", () => {
    expect(laneAccessibilityLabel(exitStep.lanes!)).toBe("Use lane 1 of 4, counting from the left");
  });
});

describe("spoken lane guidance", () => {
  const step = (over: Partial<RouteStep>): RouteStep => ({
    instruction: "Take exit 3B towards Roberts Road",
    maneuver: "ramp-left",
    distanceMeters: 1200,
    durationSeconds: 60,
    startLocation: { latitude: 0, longitude: 0 },
    endLocation: { latitude: 0, longitude: 0 },
    polyline: [],
    ...over,
  });
  const twoLeft = parseIntersectionLanes([
    { indications: ["slight left"], valid: true },
    { indications: ["slight left", "straight"], valid: true },
    { indications: ["straight"], valid: false },
    { indications: ["straight"], valid: false },
  ])!;

  it('"In 400 metres, keep left, use the two left lanes to take exit 3B"', () => {
    const plan = planStepAnnouncement(
      { step: step({ lanes: twoLeft, maneuverKind: "exit", maneuverSide: "left", exitNumber: "3B" }), distanceMeters: 400, kind: "early" },
      "km"
    );
    expect(plan.fullText).toBe("In 400 metres, keep left, use the two left lanes to take exit 3B");
  });

  it("a recorded voice plays its own 'In 400 metres' and 'Keep left' clips and speaks the lanes", () => {
    const plan = planStepAnnouncement(
      { step: step({ lanes: twoLeft, maneuverKind: "exit", maneuverSide: "left", exitNumber: "3B" }), distanceMeters: 400, kind: "early" },
      "km"
    );
    expect(plan.segments).toEqual([
      { clipKey: "dist_400m", text: "In 400 metres" },
      { clipKey: "instr_keep_left", text: "Keep left" },
      { text: "use the two left lanes to take exit 3B" },
    ]);
  });

  it("a turn with lanes adds the lanes after the instruction", () => {
    const right = parseIntersectionLanes([
      { indications: ["straight"], valid: false },
      { indications: ["right"], valid: true },
    ])!;
    const plan = planStepAnnouncement(
      { step: step({ instruction: "Turn right onto George St", maneuver: "turn-right", maneuverKind: "laneChange", lanes: right }), distanceMeters: 200, kind: "final" },
      "km"
    );
    expect(plan.fullText).toBe("Turn right onto George St, use the right lane");
  });

  it("no lane data: exactly the instruction as before", () => {
    const plan = planStepAnnouncement({ step: step({}), distanceMeters: 400, kind: "early" }, "km");
    expect(plan.fullText).toBe("In 400 metres, take exit 3B towards Roberts Road");
  });
});
