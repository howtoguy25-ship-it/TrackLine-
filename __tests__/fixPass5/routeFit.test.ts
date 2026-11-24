// Fix pass 5 §1: the preview fits EVERY drawn route + start + destination, in every mode, on
// first load, mode change, Avoid change, route select and sheet-height change -- never one route
// on its own and never just the user. Route data is real (recorded Google / OSRM responses).
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/services/firebase", () => ({ db: {}, functions: {} }));

import carJson from "../fixtures/travel/bankstown-parramatta.json";
import bikeJson from "../fixtures/travel/circular-quay-opera-house-bike.json";
import footJson from "../fixtures/travel/circular-quay-opera-house-foot.json";
import ferryJson from "../fixtures/travel/putney-mortlake-ferry.json";
import transitJson from "../fixtures/travel/bankstown-parramatta-transit.json";
import manlyJson from "../fixtures/travel/circular-quay-manly-transit.json";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { detailedRoutePolyline, parseRoute, type Route } from "@/services/directions";
import { allVisible, boundsOf, drawnRouteIndices, previewEdgePadding, previewFitCoordinates, previewFitLines, projectFitted } from "@/nav/previewCamera";

const viewport = { width: 390, height: 844 };
const ends = (r: Route) => {
  const line = detailedRoutePolyline(r);
  return { start: line[0], end: line[line.length - 1] };
};

// Each mode's real routes. Modes with one recorded route get the alternatives a real answer
// would have (the same road shifted a little), so "several routes" is exercised everywhere.
function withAlternatives(routes: Route[], n: number): Route[] {
  const out = [...routes];
  for (let k = 1; out.length < n; k++) {
    const base = routes[0];
    const shift = (p: { latitude: number; longitude: number }) => ({ latitude: p.latitude + 0.004 * k, longitude: p.longitude - 0.003 * k });
    out.push({ ...base, polyline: base.polyline.map(shift), steps: base.steps.map((s) => ({ ...s, polyline: s.polyline.map(shift) })) });
  }
  return out;
}

const MODES: Record<string, Route[]> = {
  drive: withAlternatives(parseMapboxResponse(carJson), 4),
  motorbike: withAlternatives(parseMapboxResponse(carJson), 3),
  bike: withAlternatives(parseMapboxResponse(bikeJson), 4),
  walk: withAlternatives(parseMapboxResponse(footJson), 2),
  transit: (transitJson as { routes: unknown[] }).routes.map((r) => parseRoute(r)),
  ferry: [...(manlyJson as { routes: unknown[] }).routes.map((r) => parseRoute(r)), ...parseMapboxResponse(ferryJson)].slice(0, 5),
};

describe("every drawn route sits inside the visible map, in every mode", () => {
  for (const [mode, routes] of Object.entries(MODES)) {
    for (const sheet of [263, 460]) {
      it(`${mode}: ${routes.length} routes, sheet ${sheet} pt, last route selected`, () => {
        expect(routes.length).toBeGreaterThan(1);
        const selected = routes.length - 1; // the case that used to fall off screen
        const lines = previewFitLines(routes, selected, detailedRoutePolyline);
        const { start, end } = ends(routes[0]);
        const padding = previewEdgePadding(216, sheet);
        const fit = boundsOf(previewFitCoordinates(lines, start, end))!;
        // Everything DRAWN (drawnRouteIndices -- what the map shows) must be visible.
        for (const i of drawnRouteIndices(routes.length, selected)) {
          const coords = detailedRoutePolyline(routes[i]);
          expect(allVisible(projectFitted(coords, fit, viewport, padding), viewport, padding)).toBe(true);
        }
        expect(allVisible(projectFitted([start, end], fit, viewport, padding), viewport, padding)).toBe(true);
      });
    }
  }

  it("the selected route is always drawn and fitted, even past the first three", () => {
    expect(drawnRouteIndices(6, 5)).toEqual([0, 1, 2, 5]);
    const routes = MODES.transit;
    expect(previewFitLines(routes, 5, detailedRoutePolyline)).toHaveLength(4);
  });
});

describe("one place decides the fit (regression guard)", () => {
  const map = readFileSync(path.join(__dirname, "../../src/screens/MapScreen.tsx"), "utf8");
  it("every fit in MapScreen goes through previewFitLines -- no slice(0, 3), no single-route fit", () => {
    const calls = map.match(/fitRoutesOnScreen\(([^;]*)\);/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const c of calls) expect(c).toMatch(/fitRoutesOnScreen\(previewFitLines\(/);
    expect(map).not.toMatch(/fitRoutesOnScreen\(\[/);
  });
  it("the sheet height and the top card are part of the fit, and location updates aren't", () => {
    expect(map).toMatch(/previewEdgePadding\(routeTopCardBottom, routeSheetHeight\)/);
  });
});
