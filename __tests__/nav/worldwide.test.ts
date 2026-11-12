// The lane strip, approach view and taken/missed work the same anywhere in the world: driving
// side per step (left in the UK, Japan, India, Australia; right elsewhere; changing at a border),
// U-turn arrows that swing the right way, and Google routes (used wherever Mapbox can't answer)
// read for exits, on-ramps, splits and exit numbers from any country.
import { describe, expect, it } from "@jest/globals";
import { toAppSteps, parseMapboxRoute } from "@/services/mapboxDirections";
import { manoeuvresAtStepEnds, type RouteStep } from "@/services/directions";
import { googleManoeuvre, shouldZoomFor } from "@/nav/manoeuvre";
import { kindOfStep } from "@/nav/approach";
import { laneArrowShape } from "@/components/nav/LaneArrow";

// Minimal Mapbox-shaped steps (geometry "" is fine for these checks).
const step = (type: string, modifier: string, side: "left" | "right", name = "") => ({
  geometry: "",
  distance: 100,
  duration: 10,
  name,
  driving_side: side,
  maneuver: { type, modifier, location: [0, 0] },
  intersections: [{ bearings: [0, 180] }],
});

describe("driving side comes from each step", () => {
  it("left in the UK, right in France -- changing over on a cross-border route", () => {
    const steps = toAppSteps([
      step("depart", "straight", "left", "M20"),
      step("roundabout", "left", "left", "A20"),
      step("turn", "right", "right", "A16"), // after the Channel Tunnel
      step("roundabout", "right", "right", "D940"),
      step("arrive", "", "right"),
    ]);
    expect(steps.map((s) => s.drivingSide)).toEqual(["left", "right", "right", "right"]);
    // Roundabouts go clockwise in the UK, anticlockwise in France.
    expect(steps[0].maneuver).toBe("roundabout-left");
    expect(steps[2].maneuver).toBe("roundabout-right");
  });

  it("the route falls back to the first side Mapbox states, else right", () => {
    const route = { geometry: "", legs: [{ steps: [{ ...step("depart", "", "left"), driving_side: undefined }, step("arrive", "", "left")] }] };
    expect(parseMapboxRoute(route).steps[0].drivingSide).toBe("left");
    const none = { geometry: "", legs: [{ steps: [{ ...step("depart", "", "left"), driving_side: undefined }, { ...step("arrive", "", "left"), driving_side: undefined }] }] };
    expect(parseMapboxRoute(none).steps[0].drivingSide).toBe("right");
  });
});

describe("U-turn lane arrows swing across the oncoming traffic", () => {
  it("to the right where traffic keeps left, to the left where it keeps right", () => {
    expect(laneArrowShape("uturn", "left").mirror).toBe(true); // base shape swings left; mirrored = right
    expect(laneArrowShape("uturn", "right").mirror).toBe(false);
    // Ordinary arrows don't depend on it.
    expect(laneArrowShape("slight left", "left")).toEqual(laneArrowShape("slight left", "right"));
  });
});

describe("Google routes, anywhere", () => {
  const cases: [string, string, string, string | undefined, string | undefined][] = [
    // country, code, sentence -> kind, exit number
    ["USA", "ramp-right", "Take exit 23B for I-405 N toward Sacramento", "exit", "23B"],
    ["USA", "ramp-left", "Take the ramp onto I-10 E", "onramp", undefined],
    ["USA", "keep-left", "Keep left to continue on I-5 N", "fork", undefined],
    ["UK", "ramp-left", "At junction 12, exit onto M40 toward Oxford", "exit", undefined],
    ["Germany", "ramp-right", "Take exit 49-Frankfurt-Süd toward Stadtmitte", "exit", "49"],
    ["Australia", "ramp-left", "Take the Silverwater Rd exit toward Silverwater", "exit", undefined],
    ["France", "roundabout-right", "At the roundabout, take the 3rd exit onto Avenue Victor Hugo", "roundabout", undefined],
    ["Spain (Spanish)", "ramp-right", "Toma la salida 23 hacia Madrid", "exit", undefined],
    ["Japan", "fork-left", "Keep left at the fork", "fork", undefined],
  ];
  for (const [country, code, sentence, kind, exit] of cases) {
    it(`${country}: ${code} "${sentence}"`, () => {
      const g = googleManoeuvre(code, sentence);
      expect(g.kind).toBe(kind);
      expect(g.exitNumber).toBe(exit);
    });
  }

  it("Google steps carry the kind, side and exit, so exits and splits get the approach view", () => {
    const g = (instruction: string, maneuver: string | undefined): RouteStep => ({
      instruction,
      maneuver: maneuver as RouteStep["maneuver"],
      distanceMeters: 500,
      durationSeconds: 20,
      startLocation: { latitude: 0, longitude: 0 },
      endLocation: { latitude: 0, longitude: 0 },
      polyline: [],
    });
    // Google describes each manoeuvre at the START of its step.
    const steps = manoeuvresAtStepEnds([
      g("Head east on Main St", undefined),
      g("Keep left to continue on I-5 N", "keep-left"),
      g("Take exit 23B for I-405 N", "ramp-right"),
      g("Destination will be on the right", undefined),
    ]);
    expect(steps.map((s) => s.maneuverKind)).toEqual(["fork", "exit", undefined, "arrive"]);
    expect(steps[0].maneuverSide).toBe("left");
    expect(steps[1].exitNumber).toBe("23B");
    expect(shouldZoomFor(kindOfStep(steps[0]))).toBe(true);
    expect(shouldZoomFor(kindOfStep(steps[1]))).toBe(true);
    // Even a step without the kind (an old saved route) reads keep-left as a split.
    expect(kindOfStep({ maneuver: "keep-left" as RouteStep["maneuver"] })).toBe("fork");
  });
});
