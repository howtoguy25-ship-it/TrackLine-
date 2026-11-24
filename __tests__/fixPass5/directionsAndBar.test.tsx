// Fix pass 5 §6-7: the top bar sits under the status bar with its black behind it and light
// status-bar text; our own roundabout picture (circle, exit arm highlighted, exit number,
// clockwise for left-hand traffic) in the bar, the directions list and on the route; the
// directions list merges repeats and shows big icon / bold distance / bold street + shield /
// grey detail, no trailing full stops, current step highlighted, light or dark with the map.
import React from "react";
import { readFileSync } from "fs";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";

jest.mock("@/services/firebase", () => ({ db: {}, functions: {} }));
jest.mock("expo-haptics", () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock("@gorhom/bottom-sheet", () => {
  const React = require("react");
  const { View, FlatList } = require("react-native");
  const Sheet = React.forwardRef(function Sheet(p: { children: React.ReactNode; backgroundStyle?: unknown }, _r: unknown) {
    return React.createElement(View, { testID: "sheet", style: p.backgroundStyle }, p.children);
  });
  return { __esModule: true, default: Sheet, BottomSheetFlatList: FlatList, BottomSheetView: View };
});

import carJson from "../fixtures/travel/bankstown-parramatta.json";
import ferryJson from "../fixtures/travel/putney-mortlake-ferry.json";
import bikeJson from "../fixtures/travel/circular-quay-opera-house-bike.json";
import footJson from "../fixtures/travel/circular-quay-opera-house-foot.json";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import type { RouteStep } from "@/services/directions";
import { directionsRows, noTrailingStop, activeRowIndex } from "@/nav/directionsRows";
import { roundaboutDrawing, roundaboutExitAngle, sweepDegrees } from "@/nav/roundabout";
import { RouteDirectionsSheet } from "@/screens/RouteDirectionsSheet";
import { NavigationInstructionCard } from "@/components/NavigationInstructionCard";
import { SURFACES } from "@/theme/colors";

const realRoutes = [...parseMapboxResponse(carJson), ...parseMapboxResponse(ferryJson), ...parseMapboxResponse(bikeJson), ...parseMapboxResponse(footJson)];
const flat = (x: unknown): string => JSON.stringify(x);

describe("roundabout picture (§6)", () => {
  it("left-hand traffic goes round clockwise: 1st exit left, 2nd straight on, 3rd right", () => {
    expect(roundaboutExitAngle({ exit: 1, drivingSide: "left" })).toBe(-90);
    expect(roundaboutExitAngle({ exit: 2, drivingSide: "left" })).toBe(0);
    expect(roundaboutExitAngle({ exit: 3, drivingSide: "left" })).toBe(90);
    expect(roundaboutExitAngle({ exit: 4, drivingSide: "left" })).toBe(180);
    expect(roundaboutExitAngle({ exit: 1, drivingSide: "right" })).toBe(90);
    // Going clockwise from the bottom: left is a quarter round, right three quarters.
    expect(sweepDegrees(-90, "left")).toBe(90);
    expect(sweepDegrees(0, "left")).toBe(180);
    expect(sweepDegrees(90, "left")).toBe(270);
    expect(sweepDegrees(90, "right")).toBe(90);
  });
  it("uses the real geometry when there's enough: a right turn at the roundabout points right", () => {
    // Heading north into the roundabout, out heading east.
    const approach = Array.from({ length: 6 }, (_, i) => ({ latitude: -33.9 + i * 0.0001, longitude: 151.0 }));
    const entry = approach[approach.length - 1];
    const after = [entry, ...Array.from({ length: 12 }, (_, i) => ({ latitude: entry.latitude + 0.0002, longitude: entry.longitude + (i + 1) * 0.0001 }))];
    const a = roundaboutExitAngle({ exit: 1, drivingSide: "left", approach, after });
    expect(a).toBeGreaterThan(70);
    expect(a).toBeLessThan(110);
  });
  it("the drawing: path enters at the bottom, the arc's direction follows the traffic side", () => {
    const left = roundaboutDrawing(90, "left");
    expect(left.route.startsWith("M32 63")).toBe(true);
    expect(left.route).toMatch(/A13 13 0 1 1 /); // 270° clockwise: large arc, sweep 1
    const right = roundaboutDrawing(90, "right");
    expect(right.route).toMatch(/A13 13 0 0 0 /); // 90° anticlockwise
  });
  it("our picture with the exit number is in the top bar, the list and the callout on the route", async () => {
    const step: RouteStep = {
      instruction: "At the roundabout, take the 2nd exit onto King Street.",
      maneuver: "roundabout-left",
      distanceMeters: 240,
      durationSeconds: 20,
      startLocation: { latitude: -33.9, longitude: 151 },
      endLocation: { latitude: -33.901, longitude: 151 },
      polyline: [],
      targetStreetName: "King St",
      drivingSide: "left",
    } as RouteStep;
    const r = await render(<NavigationInstructionCard step={step} roadName={null} themeKey="dark" onExpandDirections={jest.fn()} />);
    const j = flat(r.toJSON());
    expect(j).toMatch(/"testID":"roundabout-icon"/);
    expect(j).toMatch(/Roundabout, exit 2/);
    await r.unmount();
    expect(readFileSync("src/screens/RouteDirectionsSheet.tsx", "utf8")).toMatch(/<ManeuverIcon/);
    expect(readFileSync("src/map-v2/MapboxLayers.tsx", "utf8")).toMatch(/<RoundaboutIcon/);
    expect(readFileSync("src/screens/MapScreen.tsx", "utf8")).toMatch(/roundabout: isRoundabout\(step\.maneuver\)/);
  });
});

describe("top bar under the status bar (§6)", () => {
  it("black runs behind the status bar, content starts below it, status-bar text light", async () => {
    const src = readFileSync("src/components/NavigationInstructionCard.tsx", "utf8");
    expect(src).toMatch(/<StatusBar style="light" \/>/);
    expect(src).toMatch(/paddingTop: insets\.top \+ 6/);
    expect(src).toMatch(/wrap: \{ position: "absolute", top: 0/);
  });
});

describe("directions list (§7)", () => {
  it("no two consecutive rows are the same, on every recorded route", () => {
    for (const route of realRoutes) {
      const rows = directionsRows(route.steps);
      expect(rows.length).toBeGreaterThan(0);
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1];
        const b = rows[i];
        expect([a.maneuver, a.street, a.shield, a.detail].join("|")).not.toBe([b.maneuver, b.street, b.shield, b.detail].join("|"));
      }
      // Nothing lost: the distances add up to the route's steps.
      const total = rows.reduce((s, r) => s + r.meters, 0);
      expect(Math.abs(total - route.steps.reduce((s, st) => s + st.distanceMeters, 0))).toBeLessThan(1);
      for (const r of rows) {
        expect(r.street).not.toMatch(/\.$/);
        if (r.detail) expect(r.detail).not.toMatch(/\.$/);
      }
    }
  });
  it("repeats and zero-length steps are merged into the row before", () => {
    const base = { durationSeconds: 10, startLocation: { latitude: 0, longitude: 0 }, endLocation: { latitude: 0, longitude: 0 }, polyline: [] };
    const steps = [
      { ...base, instruction: "Continue on George St.", maneuver: "straight", distanceMeters: 300, targetStreetName: "George St" },
      { ...base, instruction: "Continue on George St.", maneuver: "straight", distanceMeters: 200, targetStreetName: "George St" },
      { ...base, instruction: "Turn left onto King St.", maneuver: "turn-left", distanceMeters: 150, targetStreetName: "King St" },
      { ...base, instruction: "Turn left onto King St.", maneuver: "turn-left", distanceMeters: 0, targetStreetName: "King St" },
      { ...base, instruction: "You have arrived.", maneuver: "straight", distanceMeters: 50 },
    ] as RouteStep[];
    const rows = directionsRows(steps);
    expect(rows.map((r) => [r.street, r.meters])).toEqual([
      ["George St", 500],
      ["King St", 150],
      ["Arrive at your destination", 50],
    ]);
    expect(rows[1].detail).toBe("Turn left onto King St");
    expect(activeRowIndex(rows, 1)).toBe(0);
    expect(activeRowIndex(rows, 3)).toBe(1);
    expect(noTrailingStop("Turn right. ")).toBe("Turn right");
  });
  it("rows: icon, bold distance, street, grey detail; the current one marked; follows the theme", async () => {
    const route = parseMapboxResponse(carJson)[0];
    for (const scheme of ["light", "dark"] as const) {
      const r = await render(<RouteDirectionsSheet route={route} activeStepIndex={2} onClose={jest.fn()} scheme={scheme} />);
      const j = flat(r.toJSON());
      expect(j).toMatch(/"testID":"directions-row-current"/);
      expect((j.match(/"testID":"directions-row-current"/g) ?? []).length).toBe(1);
      expect(j).toMatch(/"testID":"directions-distance"/);
      expect(j).toMatch(/"testID":"directions-street"/);
      expect(j).toContain(`"backgroundColor":"${SURFACES[scheme].sheet}"`);
      expect(j).toContain(`"color":"${SURFACES[scheme].text}"`);
      await r.unmount();
    }
  });
  it("closing it leaves the map as it was: the sheet never touches the camera", () => {
    const src = readFileSync("src/screens/RouteDirectionsSheet.tsx", "utf8");
    expect(src).not.toMatch(/camera\.|useCamera|setCamera|flyTo|fitBounds/);
    const map = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(map).toMatch(/onClose=\{\(\) => directionsSheetRef\.current\?\.close\(\)\}/);
  });
});
