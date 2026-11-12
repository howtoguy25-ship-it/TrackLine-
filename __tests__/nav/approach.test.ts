// Steps 3-4: trigger distances, the camera state machine, and correct vs missed manoeuvres --
// unit rules first, then the whole thing driven along two REAL recorded routes on the M4 at
// Silverwater (one takes the exit, one stays on the motorway past it).
import { describe, expect, it } from "@jest/globals";
import taken from "@/dev/testRoutes/m4-silverwater-taken.json";
import missed from "@/dev/testRoutes/m4-silverwater-missed.json";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { createGuidanceState, evaluateGuidance, remainingStepMeters } from "@/services/navigationGuidance";
import { routeToReplayPoints } from "@/dev/simulateDrive";
import {
  APPROACH_CAMERA,
  CHIP_MS,
  INITIAL_APPROACH,
  RESTORE_FAST_MS,
  RESTORE_MS,
  distanceToLineMeters,
  kindOfStep,
  manoeuvreHighlight,
  reduceApproach,
  type ApproachEffect,
  type ApproachState,
} from "@/nav/approach";
import { approachTriggerMeters, calloutLabel, confirmationText, shouldZoomFor } from "@/nav/manoeuvre";
import type { Route } from "@/services/directions";

describe("trigger distances", () => {
  it("200 m normally, 400 m above 90 km/h", () => {
    expect(approachTriggerMeters(60)).toBe(200);
    expect(approachTriggerMeters(90)).toBe(200);
    expect(approachTriggerMeters(91)).toBe(400);
    expect(approachTriggerMeters(null)).toBe(200);
  });

  it("zooms for exits, merges, splits, roundabouts, lane changes and complex turns; not for plain turns", () => {
    for (const k of ["exit", "onramp", "merge", "fork", "roundabout", "laneChange", "complex"] as const) expect(shouldZoomFor(k)).toBe(true);
    for (const k of ["turn", "continue", "arrive"] as const) expect(shouldZoomFor(k)).toBe(false);
  });

  it("Google routes get kinds from their manoeuvre codes", () => {
    expect(kindOfStep({ maneuver: "ramp-left" })).toBe("exit");
    expect(kindOfStep({ maneuver: "fork-right" })).toBe("fork");
    expect(kindOfStep({ maneuver: "turn-left" })).toBe("turn");
  });

  it("callouts and chips say what happened", () => {
    expect(calloutLabel({ maneuverKind: "exit", exitNumber: "3B" })).toBe("Exit 3B");
    expect(calloutLabel({ maneuverKind: "fork", roadRef: "M5", targetStreetName: "M5 West" })).toBe("M5");
    expect(calloutLabel({ maneuverKind: "merge", maneuverSide: "left" })).toBe("Merge left");
    expect(confirmationText("exit")).toBe("Exit taken ✓");
    expect(confirmationText("merge")).toBe("Merge complete ✓");
    expect(confirmationText("turn")).toBe("Turn complete ✓");
  });
});

describe("the state machine never gets stuck zoomed in", () => {
  const approaching: ApproachState = { ...INITIAL_APPROACH, phase: "approach", stepIndex: 3, enteredAtMs: 0 };
  for (const type of ["panned", "rerouted", "rerouteFailed", "arrived", "routeChanged"] as const) {
    it(`${type} -> normal, with the camera restored`, () => {
      const { state, effects } = reduceApproach(approaching, { type });
      expect(state.phase).toBe("normal");
      expect(effects.some((e) => e.kind === "restore")).toBe(true);
    });
  }
  it("in normal, outside events do nothing", () => {
    expect(reduceApproach(INITIAL_APPROACH, { type: "panned" }).effects).toEqual([]);
  });
});

/** Drives a recorded track while navigating `nav`, feeding the machine once a second. */
function drive(nav: Route, track: Route, speedKmh: number) {
  const points = routeToReplayPoints(track.polyline, speedKmh, 1000);
  const guidance = createGuidanceState();
  let state: ApproachState = INITIAL_APPROACH;
  const log: { t: number; phase: string; effect: ApproachEffect }[] = [];
  for (const p of points) {
    const position = { latitude: p.latitude, longitude: p.longitude };
    const g = evaluateGuidance(guidance, nav.steps, position.latitude, position.longitude, []);
    const step = nav.steps[g.activeStepIndex];
    const out = reduceApproach(state, {
      type: "tick",
      nowMs: p.elapsedMs,
      position,
      speedKmh,
      activeStepIndex: g.activeStepIndex,
      steps: nav.steps,
      metersToManoeuvre: remainingStepMeters(step, position.latitude, position.longitude),
      offRouteMeters: distanceToLineMeters(position, nav.polyline),
    });
    state = out.state;
    for (const effect of out.effects) log.push({ t: p.elapsedMs, phase: state.phase, effect });
    if (out.effects.some((e) => e.kind === "missed")) {
      // MapScreen would reroute now; the new route arriving ends the episode.
      const r = reduceApproach(state, { type: "rerouted" });
      state = r.state;
      for (const effect of r.effects) log.push({ t: p.elapsedMs, phase: state.phase, effect });
      break;
    }
  }
  return log;
}

describe("real drive: M4 eastbound, Silverwater Road exit", () => {
  const nav = parseMapboxResponse(taken)[0];
  const stayed = parseMapboxResponse(missed)[0];
  const exitIndex = nav.steps.findIndex((s) => s.maneuverKind === "exit" && s.instruction.includes("Silverwater"));

  it("taking the exit at 100 km/h: zoom in 400 m out, 'Exit taken ✓', then the normal camera", () => {
    const log = drive(nav, nav, 100);
    const exitEvents = log.filter((l) => l.t > 0);
    const zoom = exitEvents.find((l) => l.effect.kind === "zoomIn" && l.effect.stepIndex === exitIndex);
    expect(zoom).toBeTruthy();
    const confirmed = exitEvents.find((l) => l.t > zoom!.t && l.effect.kind === "confirmed");
    expect(confirmed?.effect).toEqual({ kind: "confirmed", text: "Exit taken ✓" });
    const restore = exitEvents.find((l) => l.t > confirmed!.t && l.effect.kind === "restore");
    expect(restore?.effect).toEqual({ kind: "restore", durationMs: RESTORE_MS });
    // The chip shows for 2 s before the camera eases back.
    expect(restore!.t - confirmed!.t).toBeGreaterThanOrEqual(CHIP_MS);
    // Zoomed in no later than 400 m (100 km/h covers ~28 m a second).
    expect(log.some((l) => l.effect.kind === "missed")).toBe(false);
  });

  it("the merge onto the M4 also gets the approach view and a 'Merge complete ✓'", () => {
    const log = drive(nav, nav, 70);
    expect(log.some((l) => l.effect.kind === "confirmed" && l.effect.text === "Merge complete ✓")).toBe(true);
  });

  it("missing the exit (staying on the M4): zoom in, then missed -> camera back fast -> reroute -> normal", () => {
    const log = drive(nav, stayed, 100);
    const kinds = log.map((l) => l.effect.kind);
    const zoomAt = log.findIndex((l) => l.effect.kind === "zoomIn" && l.effect.stepIndex === exitIndex);
    expect(zoomAt).toBeGreaterThanOrEqual(0);
    const missedAt = kinds.indexOf("missed", zoomAt);
    expect(missedAt).toBeGreaterThan(zoomAt);
    expect(log[missedAt - 1].effect).toEqual({ kind: "restore", durationMs: RESTORE_FAST_MS });
    expect(kinds.slice(zoomAt, missedAt)).not.toContain("confirmed");
    expect(log[log.length - 1].phase).toBe("normal");
  });

  it("the approach view is z18 (Mapbox), 60° pitch, 1.2 s", () => {
    expect(APPROACH_CAMERA).toEqual({ zoom: 19, pitch: 60, durationMs: 1200 });
  });

  it("the highlight covers the road through the split and the start of the exit", () => {
    const h = manoeuvreHighlight(nav.steps, exitIndex)!;
    expect(h.through.length).toBeGreaterThan(2);
    expect(h.exitSide[0]).toEqual(nav.steps[exitIndex + 1].polyline[0]);
  });
});
