// Fix pass 6 (phone screenshots, build 220): routes still not all visible in the preview.
//  * Sheet down: an alternative ran off the left edge and the start arrow was clipped -- the
//    camera fitted the lines captured when the fit was asked for, not the ones drawn later.
//  * Sheet pulled up: the map zoomed right in on the middle of the route -- the map's own bounds
//    fit gives up when the padding leaves it almost no room.
// Now: the camera is worked out by previewFitCamera (same Web Mercator maths as the map), over
// exactly the drawn lines, inside a fit area that never drops below MIN_FIT_HEIGHT.
import { readFileSync } from "fs";
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/services/firebase", () => ({ db: {}, functions: {} }));

import carJson from "../fixtures/travel/bankstown-parramatta.json";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { detailedRoutePolyline } from "@/services/directions";
import { FIT_MARGIN, MIN_FIT_HEIGHT, previewEdgePadding, previewFitCamera, previewFitCoordinates, type EdgePadding } from "@/nav/previewCamera";
import type { LatLng } from "@/utils/polyline";

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
/** Where Mapbox draws a point for a camera (centre, Google-scale zoom) with the given padding. */
function project(p: LatLng, cam: { center: LatLng; zoom: number }, vp: { width: number; height: number }, pad: EdgePadding) {
  const k = (512 * 2 ** (cam.zoom - 1)) / (2 * Math.PI);
  const cx = pad.left + (vp.width - pad.left - pad.right) / 2;
  const cy = pad.top + (vp.height - pad.top - pad.bottom) / 2;
  return { x: cx + ((p.longitude - cam.center.longitude) * Math.PI) / 180 * k, y: cy - (mercY(p.latitude) - mercY(cam.center.latitude)) * k };
}
function allInside(points: LatLng[], cam: { center: LatLng; zoom: number }, vp: { width: number; height: number }, pad: EdgePadding) {
  return points.every((p) => {
    const s = project(p, cam, vp, pad);
    return s.x >= pad.left - 1 && s.x <= vp.width - pad.right + 1 && s.y >= pad.top - 1 && s.y <= vp.height - pad.bottom + 1;
  });
}

const PHONES = [
  { width: 320, height: 568, top: 20 },
  { width: 390, height: 844, top: 47 },
  { width: 430, height: 932, top: 59 },
];

// The phone case: Bankstown -> 40 Bigge St Liverpool, three routes, one swinging west past the
// destination before coming back (the line that ran off the left edge).
const start = { latitude: -33.9175, longitude: 151.0345 };
const dest = { latitude: -33.9213, longitude: 150.9248 };
const via = (pts: [number, number][]) => pts.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
const routes: LatLng[][] = [
  via([[-33.9175, 151.0345], [-33.935, 151.03], [-33.948, 150.99], [-33.942, 150.95], [-33.9213, 150.9248]]),
  via([[-33.9175, 151.0345], [-33.925, 150.99], [-33.92, 150.95], [-33.9213, 150.9248]]),
  via([[-33.9175, 151.0345], [-33.94, 151.0], [-33.93, 150.9], [-33.915, 150.905], [-33.9213, 150.9248]]),
];

describe("every drawn route + start + flag inside the free map area", () => {
  for (const p of PHONES) {
    for (const sheet of [260, 0.45 * p.height, 0.62 * p.height]) {
      it(`${p.width}x${p.height}, sheet ${Math.round(sheet)} pt`, () => {
        const vp = { width: p.width, height: p.height };
        const topCard = p.top + 180;
        const pad = previewEdgePadding(topCard, sheet, p.height);
        // The fit area never collapses, however far the sheet is pulled up.
        expect(p.height - pad.top - pad.bottom).toBeGreaterThanOrEqual(MIN_FIT_HEIGHT - 1);
        const pts = previewFitCoordinates(routes, start, dest);
        const cam = previewFitCamera(pts, vp, pad)!;
        expect(allInside(pts, cam, vp, pad)).toBe(true);
        // Not zoomed in on the middle: a ~11 km trip stays a city-scale view.
        expect(cam.zoom).toBeLessThan(14);
        // The flag (50 pt above its point) clears the top card; the start dot clears the sides.
        const flag = project(dest, cam, vp, pad);
        expect(flag.y - 50).toBeGreaterThanOrEqual(topCard - 1);
        const s = project(start, cam, vp, pad);
        expect(s.x + 20).toBeLessThanOrEqual(p.width);
        expect(s.x - 20).toBeGreaterThanOrEqual(0);
      });
    }
  }

  it("the recorded Bankstown -> Parramatta route fits the same way", () => {
    const line = detailedRoutePolyline(parseMapboxResponse(carJson)[0]);
    const vp = { width: 390, height: 844 };
    const pad = previewEdgePadding(47 + 180, 300, 844);
    const pts = previewFitCoordinates([line], line[0], line[line.length - 1]);
    expect(allInside(pts, previewFitCamera(pts, vp, pad)!, vp, pad)).toBe(true);
  });

  it("margins leave room for the flag and the start dot", () => {
    expect(FIT_MARGIN.top).toBeGreaterThanOrEqual(50);
    expect(FIT_MARGIN.side).toBeGreaterThanOrEqual(20);
  });
});

describe("one place decides the fit (regression guards)", () => {
  const map = readFileSync("src/screens/MapScreen.tsx", "utf8");
  it("the camera fits exactly the drawn lines, never a stored snapshot", () => {
    expect(map).toMatch(/previewFitCoordinates\(\s*drawnSelection\.map\(\(d\) => d\.line\)/);
    expect(map).not.toMatch(/previewFitCoordinates\(previewFit\.lines/);
    expect(map).toMatch(/const fitLines = drawnSelection\.map\(\(d\) => d\.line\);/);
  });
  it("the camera is computed (previewFitCamera), not left to the map's bounds fit; padding has the screen height", () => {
    expect(map).toMatch(/camera\.move\("previewFit", pose/);
    expect(map).not.toMatch(/camera\.fit\("previewFit"/);
    expect((map.match(/previewEdgePadding\(routeTopCardBottom, routeSheetHeight, windowHeight\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
