// The map must never flip, invert or show the wrong turn: heading source by speed, freezing at
// the lights, GPS glitches and magnet-mount compass noise ignored, tunnels and real U-turns,
// shortest-way smoothing, left/right cross-checked against the road geometry in both driving
// sides, the voice words swapped with it, and nothing mirrored in RTL.
import fs from "fs";
import path from "path";
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { I18nManager, StyleSheet } from "react-native";

import {
  initialHeadingState,
  stepCompass,
  stepHeading,
  compassAllowed,
  shortestDelta,
  smoothHeading,
  blendHeadings,
  type HeadingFix,
  type HeadingState,
} from "@/nav/headingFilter";
import { crossCheckTurn, maneuverTypeFor } from "@/nav/manoeuvre";
import { crossCheckSteps, swapDirectionWords, turnAngleDeg } from "@/nav/turnGeometry";
import { LaneStrip } from "@/components/nav/LaneStrip";
import type { RouteStep } from "@/services/directions";

// ---- a tiny drive simulator ------------------------------------------------------------------

type Sim = { state: HeadingState; t: number; shown: number[] };
const start = (): Sim => ({ state: initialHeadingState(), t: 0, shown: [] });

function drive(sim: Sim, n: number, fix: Partial<HeadingFix> & { speedKmh: number }, stepMs = 1000): Sim {
  let { state, t } = sim;
  const shown = [...sim.shown];
  for (let i = 0; i < n; i++) {
    t += stepMs;
    const moved = (fix.speedKmh / 3.6) * (stepMs / 1000);
    state = stepHeading(state, {
      timeMs: t,
      gpsCourse: null,
      movementBearing: null,
      movedMeters: moved,
      roadBearing: null,
      ...fix,
      speedKmh: fix.speedKmh,
    });
    if (state.shown !== null) shown.push(state.shown);
  }
  return { state, t, shown };
}

const near = (a: number, b: number, tol = 3) => Math.abs(shortestDelta(a, b)) <= tol;

describe("heading maths", () => {
  it("shortest way round: 359 -> 1 is +2, never -358", () => {
    expect(shortestDelta(359, 1)).toBe(2);
    expect(shortestDelta(1, 359)).toBe(-2);
    expect(shortestDelta(90, 270)).toBe(180);
    expect(shortestDelta(0, 0)).toBe(0);
  });

  it("smoothing 359 -> 1 passes through 0, not through 180", () => {
    let h = 359;
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      h = smoothHeading(h, 1, 100);
      seen.push(h);
    }
    for (const v of seen) expect(v > 358 || v < 2).toBe(true);
    expect(near(h, 1, 0.5)).toBe(true);
  });

  it("300 ms time constant: ~63% of the way after 300 ms", () => {
    expect(smoothHeading(0, 100, 300)).toBeCloseTo(63.2, 0);
    expect(smoothHeading(0, 100, 0)).toBe(0);
  });

  it("blend weighted 80/20 toward GPS, the short way", () => {
    expect(blendHeadings(0, 40, 0.8)).toBeCloseTo(8, 5);
    expect(blendHeadings(350, 10, 0.8)).toBeCloseTo(354, 5);
  });
});

describe("simulated drives", () => {
  it("stop at the lights for 60 s: no spin, even with course noise and GPS jitter", () => {
    let sim = drive(start(), 20, { speedKmh: 50, gpsCourse: 10 });
    expect(near(sim.state.shown!, 10)).toBe(true);
    // Stopped: the GPS course swings at random, position jitters a metre or two.
    for (let i = 0; i < 60; i++) sim = drive(sim, 1, { speedKmh: 0.5, gpsCourse: (i * 137) % 360, movementBearing: (i * 71) % 360, movedMeters: 1.5 });
    for (const h of sim.shown.slice(20)) expect(near(h, 10)).toBe(true);
    // Pulling away the same way: still 10.
    sim = drive(sim, 3, { speedKmh: 20, gpsCourse: 12 });
    expect(near(sim.state.shown!, 12, 3)).toBe(true);
  });

  it("a single GPS 180° glitch at speed is ignored", () => {
    let sim = drive(start(), 10, { speedKmh: 60, gpsCourse: 0 });
    sim = drive(sim, 1, { speedKmh: 60, gpsCourse: 180 });
    sim = drive(sim, 10, { speedKmh: 60, gpsCourse: 0 });
    for (const h of sim.shown) expect(near(h, 0, 2)).toBe(true);
  });

  it("two or three glitch fixes in a row are still not a flip (no 5 s / 30 m of reversed travel)", () => {
    let sim = drive(start(), 10, { speedKmh: 60, gpsCourse: 0 });
    sim = drive(sim, 3, { speedKmh: 60, gpsCourse: 180 }, 500);
    sim = drive(sim, 5, { speedKmh: 60, gpsCourse: 0 });
    for (const h of sim.shown) expect(near(h, 0, 2)).toBe(true);
  });

  it("tunnel exit: after a gap the old bearing holds until 3 consistent fixes agree", () => {
    let sim = drive(start(), 10, { speedKmh: 70, gpsCourse: 45 });
    sim = { ...sim, t: sim.t + 40_000 }; // 40 s without a fix
    sim = drive(sim, 1, { speedKmh: 70, gpsCourse: 80 });
    expect(near(sim.state.shown!, 45)).toBe(true);
    sim = drive(sim, 1, { speedKmh: 70, gpsCourse: 82 });
    expect(near(sim.state.shown!, 45)).toBe(true);
    sim = drive(sim, 4, { speedKmh: 70, gpsCourse: 81 });
    expect(near(sim.state.target!, 81)).toBe(true);
  });

  it("a real U-turn is accepted only after 5 s and 30 m going the other way", () => {
    let sim = drive(start(), 10, { speedKmh: 40, gpsCourse: 0 });
    sim = drive(sim, 4, { speedKmh: 25, gpsCourse: 180 }); // 4 s, ~28 m: not yet
    expect(near(sim.state.target!, 0)).toBe(true);
    sim = drive(sim, 2, { speedKmh: 25, gpsCourse: 181 }); // 6 s, ~42 m: accepted
    expect(near(sim.state.target!, 181)).toBe(true);
  });

  it("a normal right turn at an intersection follows smoothly (no hold)", () => {
    let sim = drive(start(), 5, { speedKmh: 30, gpsCourse: 0 });
    for (const course of [20, 45, 70, 90]) sim = drive(sim, 1, { speedKmh: 20, gpsCourse: course });
    expect(near(sim.state.target!, 90)).toBe(true);
    expect(near(sim.state.shown!, 90, 5)).toBe(true);
  });

  it("phone on a magnet mount: wild compass while moving never moves the map", () => {
    let sim = start();
    sim = drive(sim, 5, { speedKmh: 50, gpsCourse: 270 });
    for (let i = 0; i < 30; i++) {
      sim = { ...sim, state: stepCompass(sim.state, { timeMs: sim.t + 100, heading: (i * 97) % 360, accuracyDeg: 20 }) };
      sim = drive(sim, 1, { speedKmh: 50, gpsCourse: 270 });
    }
    for (const h of sim.shown) expect(near(h, 270, 2)).toBe(true);
    expect(compassAllowed(sim.state, { speedKmh: 50 })).toBe(false);
  });

  it("compass only before the first movement (or walking), only when accurate and steady", () => {
    let s = initialHeadingState();
    s = stepCompass(s, { timeMs: 0, heading: 120, accuracyDeg: 20 });
    s = stepCompass(s, { timeMs: 2000, heading: 122, accuracyDeg: 20 });
    expect(compassAllowed(s, { speedKmh: 0 })).toBe(true);
    s = stepHeading(s, { timeMs: 2500, speedKmh: 0, gpsCourse: null, movementBearing: null, movedMeters: 0, roadBearing: null });
    expect(near(s.shown!, 122)).toBe(true);
    // Poor accuracy (35°): not trusted.
    expect(compassAllowed(stepCompass(s, { timeMs: 4000, heading: 122, accuracyDeg: 35 }), { speedKmh: 0 })).toBe(false);
    // A sudden 90° jump within a second (magnet): not trusted.
    expect(compassAllowed(stepCompass(s, { timeMs: 2300, heading: 212, accuracyDeg: 20 }), { speedKmh: 0 })).toBe(false);
    // Once driving, never again (until walking).
    const moved = stepHeading(s, { timeMs: 3500, speedKmh: 30, gpsCourse: 125, movementBearing: null, movedMeters: 8, roadBearing: null });
    expect(compassAllowed(moved, { speedKmh: 0 })).toBe(false);
    expect(compassAllowed(moved, { speedKmh: 0, walking: true })).toBe(true);
  });

  it("3-10 km/h blends toward GPS course; above 10 the compass is ignored", () => {
    let s = initialHeadingState();
    s = stepCompass(s, { timeMs: 0, heading: 40, accuracyDeg: 20 });
    s = stepHeading(s, { timeMs: 1000, speedKmh: 6, gpsCourse: 0, movementBearing: null, movedMeters: 2, roadBearing: null });
    expect(s.target).toBeCloseTo(8, 5);
    s = stepHeading(s, { timeMs: 2000, speedKmh: 30, gpsCourse: 0, movementBearing: null, movedMeters: 8, roadBearing: null });
    expect(s.target).toBe(0);
  });

  it("navigating: the camera follows the route's road direction, not noisy GPS", () => {
    let sim = drive(start(), 5, { speedKmh: 60, gpsCourse: 92, roadBearing: 90 });
    sim = drive(sim, 5, { speedKmh: 60, gpsCourse: 270, roadBearing: 90 }); // a reversed GPS course
    for (const h of sim.shown) expect(near(h, 90, 1)).toBe(true);
    // Road geometry turning a corner is taken at once.
    sim = drive(sim, 1, { speedKmh: 30, gpsCourse: 90, roadBearing: 180 });
    expect(near(sim.state.target!, 180)).toBe(true);
  });
});

// ---- turn directions -------------------------------------------------------------------------

const P = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
// Around Sydney: ~0.0009° lat = 100 m.
const NORTH = [P(-33.9, 151.0), P(-33.8991, 151.0)];
const eastFrom = (p: { latitude: number; longitude: number }) => [p, P(p.latitude, p.longitude + 0.0011)];
const westFrom = (p: { latitude: number; longitude: number }) => [p, P(p.latitude, p.longitude - 0.0011)];
const step = (maneuver: RouteStep["maneuver"], polyline: RouteStep["polyline"], instruction = "Turn"): RouteStep =>
  ({ instruction, maneuver, distanceMeters: 100, durationSeconds: 10, startLocation: polyline[0], endLocation: polyline[polyline.length - 1], polyline }) as RouteStep;

describe("turn directions", () => {
  it("measures the real turn from the geometry (+ = right)", () => {
    expect(turnAngleDeg(NORTH, eastFrom(NORTH[1]))).toBeCloseTo(90, 0);
    expect(turnAngleDeg(NORTH, westFrom(NORTH[1]))).toBeCloseTo(-90, 0);
    expect(turnAngleDeg([NORTH[0]], eastFrom(NORTH[1]))).toBeNull();
  });

  it("every left/right turn type agrees with the geometry, or the geometry wins", () => {
    const rights = ["turn-right", "turn-slight-right", "turn-sharp-right", "fork-right", "ramp-right"] as const;
    const lefts = ["turn-left", "turn-slight-left", "turn-sharp-left", "fork-left", "ramp-left"] as const;
    for (const m of rights) {
      expect(crossCheckTurn(m, 90)).toEqual({ maneuver: m, corrected: false });
      expect(crossCheckTurn(m, -90).corrected).toBe(true);
      expect(crossCheckTurn(m, -90).maneuver).toBe(m.replace("right", "left"));
    }
    for (const m of lefts) {
      expect(crossCheckTurn(m, -90)).toEqual({ maneuver: m, corrected: false });
      expect(crossCheckTurn(m, 90).maneuver).toBe(m.replace("left", "right"));
    }
  });

  it("small disagreements (≤45°), roundabouts, U-turns and straight are left to the provider", () => {
    expect(crossCheckTurn("turn-slight-right", -30)).toEqual({ maneuver: "turn-slight-right", corrected: false });
    expect(crossCheckTurn("roundabout-left", 90).corrected).toBe(false);
    expect(crossCheckTurn("uturn-right", -170).corrected).toBe(false);
    expect(crossCheckTurn("straight", 90).corrected).toBe(false);
    expect(crossCheckTurn("turn-left", null).corrected).toBe(false);
  });

  it("a wrong provider side is corrected in the steps, the instruction too, and logged", () => {
    const logged: unknown[] = [];
    const steps = crossCheckSteps([step("turn-left", NORTH, "Turn left onto Smith St"), step("straight", eastFrom(NORTH[1]))], (i) => logged.push(i));
    expect(steps[0].maneuver).toBe("turn-right");
    expect(steps[0].instruction).toBe("Turn right onto Smith St");
    expect(logged).toHaveLength(1);
    const ok = crossCheckSteps([step("turn-right", NORTH, "Turn right onto Smith St"), step("straight", eastFrom(NORTH[1]))]);
    expect(ok[0].instruction).toBe("Turn right onto Smith St");
  });

  it("driving side: AU/UK/NZ/JP (left) vs US/EU (right) roundabouts and U-turns", () => {
    expect(maneuverTypeFor("roundabout", "right", "left")).toBe("roundabout-left");
    expect(maneuverTypeFor("roundabout", "right", "right")).toBe("roundabout-right");
    expect(maneuverTypeFor("turn", "uturn", "left")).toBe("uturn-right");
    expect(maneuverTypeFor("turn", "uturn", "right")).toBe("uturn-left");
    expect(maneuverTypeFor("turn", "left", "left")).toBe("turn-left");
    expect(maneuverTypeFor("turn", "right", "right")).toBe("turn-right");
  });

  it("the voice words are swapped in every app language, whole words only", () => {
    expect(swapDirectionWords("Turn left onto Leftbank Rd")).toBe("Turn right onto Leftbank Rd");
    expect(swapDirectionWords("Keep right, then left")).toBe("Keep left, then right");
    expect(swapDirectionWords("انعطف يسارًا")).toBe("انعطف يمينًا");
    expect(swapDirectionWords("انعطف يمينًا")).toBe("انعطف يسارًا");
    expect(swapDirectionWords("Gira a la izquierda")).toBe("Gira a la derecha");
    expect(swapDirectionWords("Поверните налево")).toBe("Поверните направо");
    expect(swapDirectionWords("Sola dönün")).toBe("Sağa dönün");
  });
});

// ---- RTL and mirroring -----------------------------------------------------------------------

describe("never mirrored", () => {
  it("lane arrows keep their left-to-right order in Arabic (RTL)", async () => {
    const wasRTL = I18nManager.isRTL;
    Object.defineProperty(I18nManager, "isRTL", { value: true, configurable: true });
    try {
      const lanes = [
        { indications: ["left"], valid: true, active: true },
        { indications: ["straight"], valid: false, active: false },
        { indications: ["right"], valid: false, active: false },
      ] as never;
      const r = await render(<LaneStrip lanes={lanes} drivingSide="left" />);
      const json = JSON.stringify(r.toJSON());
      expect(json).toContain('"direction":"ltr"');
      expect(json).not.toMatch(/"scaleX":-1|"scale":-1/);
    } finally {
      Object.defineProperty(I18nManager, "isRTL", { value: wasRTL, configurable: true });
    }
  });

  it("no negative scale anywhere on the map, markers, overlays or nav icons", () => {
    const roots = ["src/map-v2", "src/components", "src/screens/MapScreen.tsx", "src/nav"];
    const files: string[] = [];
    const walk = (p: string) => {
      const full = path.join(process.cwd(), p);
      if (fs.statSync(full).isDirectory()) for (const f of fs.readdirSync(full)) walk(path.join(p, f));
      else if (/\.(tsx?|json)$/.test(p)) files.push(full);
    };
    roots.forEach(walk);
    const offenders = files.filter((f) => /scaleX\s*:\s*-|scale\s*:\s*-\s*1|scaleY\s*:\s*-/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    // StyleSheet sanity: the lane row is pinned LTR.
    const row = StyleSheet.flatten({ direction: "ltr" });
    expect(row.direction).toBe("ltr");
  });
});
