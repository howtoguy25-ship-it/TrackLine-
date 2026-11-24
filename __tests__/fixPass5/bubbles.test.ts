// Fix pass 5 §2: time bubbles beside their own stretch of route, tail touching the line, never on
// top of another route, another bubble, the flag, the start dot, the top card or the sheet.
// Alternatives say "+N min"; the selected route its time and tag.
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/services/firebase", () => ({ db: {}, functions: {} }));

import transitJson from "../fixtures/travel/bankstown-parramatta-transit.json";
import manlyJson from "../fixtures/travel/circular-quay-manly-transit.json";
import carJson from "../fixtures/travel/bankstown-parramatta.json";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { detailedRoutePolyline, parseRoute } from "@/services/directions";
import { boundsOf, previewEdgePadding, previewFitCoordinates, projectFitted } from "@/nav/previewCamera";
import { BUBBLE_TAIL, bubbleBody, bubbleRect, layoutRouteBubbles, lineHitsRect, markerAnchorFor, rectsOverlap, timeDifferenceText, type Obstacle } from "@/map/bubbleLayout";
import type { LatLng } from "@/utils/polyline";

const viewport = { width: 390, height: 844 };
const FLAG = { x0: -11, x1: 33, y0: -50, y1: 2 };
const START = { x0: -22, x1: 22, y0: -22, y1: 22 };

function check(lines: LatLng[][], selected: number, sheet: number) {
  const start = lines[0][0];
  const end = lines[0][lines[0].length - 1];
  const padding = previewEdgePadding(216, sheet);
  const fitPoints = previewFitCoordinates(lines, start, end);
  const routes = lines.map((line, i) => ({ line, text: i === selected ? "12 min" : "+3 min", compactText: i === selected ? "12 min" : "+3 min" }));
  const obstacles: Obstacle[] = [
    { at: end, box: FLAG },
    { at: start, box: START },
  ];
  const placed = layoutRouteBubbles(routes, selected, fitPoints, viewport, padding, obstacles);
  const fit = boundsOf(fitPoints)!;
  const screenLines = lines.map((l) => projectFitted(l, fit, viewport, padding));
  const project = (p: LatLng) => projectFitted([p], fit, viewport, padding)[0];
  const rects = placed.flatMap((p) => (p ? [p.rect] : []));
  return { placed, rects, screenLines, padding, flag: project(end), startPt: project(start) };
}

const realSets: [string, LatLng[][]][] = [
  ["transit Bankstown→Parramatta (Google)", (transitJson as { routes: unknown[] }).routes.slice(0, 3).map((r) => detailedRoutePolyline(parseRoute(r)))],
  ["transit Circular Quay→Manly (Google)", (manlyJson as { routes: unknown[] }).routes.slice(0, 3).map((r) => detailedRoutePolyline(parseRoute(r)))],
];
// Drive: the recorded route plus two real-shaped alternatives that share its start and end.
const car = detailedRoutePolyline(parseMapboxResponse(carJson)[0]);
const bend = (dLat: number) => car.map((p, i) => ({ latitude: p.latitude + dLat * Math.sin((Math.PI * i) / (car.length - 1)), longitude: p.longitude }));
realSets.push(["drive Bankstown→Parramatta + 2 alternatives", [car, bend(0.01), bend(-0.012)]]);

describe("bubbles never cover routes, each other, the flag, the start or the UI", () => {
  for (const [name, lines] of realSets) {
    for (const sheet of [263, 460]) {
      for (const selected of [0, lines.length - 1]) {
        it(`${name}, sheet ${sheet}, selected ${selected}`, () => {
          const { placed, rects, screenLines, padding, flag, startPt } = check(lines, selected, sheet);
          expect(placed[selected]).not.toBeNull(); // the selected route always shows its time
          for (let a = 0; a < rects.length; a++) {
            const r = rects[a];
            // inside the map area left by the top card and the sheet
            expect(r.x0).toBeGreaterThanOrEqual(padding.left);
            expect(r.x1).toBeLessThanOrEqual(viewport.width - padding.right);
            expect(r.y0).toBeGreaterThanOrEqual(padding.top);
            expect(r.y1).toBeLessThanOrEqual(viewport.height - padding.bottom);
            // no route line crosses a bubble (the tail sits outside the box and touches its line)
            for (const l of screenLines) expect(lineHitsRect(l, r)).toBe(false);
            for (let b = a + 1; b < rects.length; b++) expect(rectsOverlap(r, rects[b])).toBe(false);
            expect(rectsOverlap(r, { x0: flag.x + FLAG.x0, x1: flag.x + FLAG.x1, y0: flag.y + FLAG.y0, y1: flag.y + FLAG.y1 })).toBe(false);
            expect(rectsOverlap(r, { x0: startPt.x + START.x0, x1: startPt.x + START.x1, y0: startPt.y + START.y0, y1: startPt.y + START.y1 })).toBe(false);
          }
        });
      }
    }
  }

  it("each tail touches its own line: the anchor is a point of that route", () => {
    const lines = realSets[2][1];
    const { placed } = check(lines, 0, 263);
    placed.forEach((p, i) => {
      if (!p) return;
      const near = Math.min(...lines[i].map((q) => Math.hypot(q.latitude - p.anchor.latitude, q.longitude - p.anchor.longitude)));
      expect(near).toBeLessThan(0.002);
    });
  });

  it("the box sits beside the tail tip on its side, and the marker anchor is the tail tip", () => {
    const size = bubbleBody("12 min", "selected");
    const p = { x: 100, y: 200 };
    expect(bubbleRect(p, "above", size).y1).toBe(200 - BUBBLE_TAIL);
    expect(bubbleRect(p, "below", size).y0).toBe(200 + BUBBLE_TAIL);
    expect(bubbleRect(p, "right", size).x0).toBe(100 + BUBBLE_TAIL);
    expect(bubbleRect(p, "left", size).x1).toBe(100 - BUBBLE_TAIL);
    expect(markerAnchorFor("above")).toEqual({ x: 0.5, y: 1 });
    expect(markerAnchorFor("right")).toEqual({ x: 0, y: 0.5 });
  });

  it("no room at full size: an alternative shrinks to the compact chip (or has none), never overlaps", () => {
    // Two lines a few metres apart and a tall sheet: full bubbles can't both fit.
    const a = Array.from({ length: 40 }, (_, i) => ({ latitude: -33.9 - i * 0.0005, longitude: 151.0 + i * 0.0005 }));
    const b = a.map((p) => ({ latitude: p.latitude + 0.0003, longitude: p.longitude + 0.0001 }));
    const { placed, rects } = check([a, b], 0, 460);
    expect(placed[0]).not.toBeNull();
    for (let x = 0; x < rects.length; x++) for (let y = x + 1; y < rects.length; y++) expect(rectsOverlap(rects[x], rects[y])).toBe(false);
  });
});

describe("bubble text", () => {
  it("alternatives show the difference from the selected route", () => {
    expect(timeDifferenceText(13 * 60, 12 * 60)).toBe("+1 min");
    expect(timeDifferenceText(9 * 60, 12 * 60)).toBe("−3 min");
    expect(timeDifferenceText(12 * 60 + 20, 12 * 60)).toBe("Same time");
  });
});
