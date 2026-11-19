// Regression tests for street / back-lane shortcuts (root causes in src/nav/shortcuts.ts):
// shortcuts must be found without a jam in the next 1 km, from Google's alternatives and not only
// "avoid highways", judged against the live time of the road you're on, with a saving threshold
// that scales with the trip, and shown with the road's name.
import { describe, expect, it } from "@jest/globals";
import {
  isBackLane,
  minSavingFor,
  pickShortcut,
  shortcutText,
  slowTrafficAhead,
  throughPointsAhead,
  withSideStreets,
  type ShortcutRoute,
} from "@/nav/shortcuts";
import { routeTags, routeSummaryLine } from "@/map/routeChoices";
import type { LatLng } from "@/utils/polyline";

const LAT = -33.9;
const line = (lat: number, from: number, to: number, n = 40): LatLng[] =>
  Array.from({ length: n }, (_, i) => ({ latitude: lat, longitude: from + ((to - from) * i) / (n - 1) }));

// Your road: straight east ~4.6 km.
const yourRoad = line(LAT, 151.0, 151.05);
// A shortcut: same start and end, but the middle runs 250 m north along a back lane.
const offset = -33.8978;
const lane = line(offset, 151.01, 151.04, 30);
const shortcutLine = [...line(LAT, 151.0, 151.01, 8), ...lane, ...line(LAT, 151.04, 151.05, 8)];

const route = (polyline: LatLng[], seconds: number, extra: Partial<ShortcutRoute> = {}): ShortcutRoute => ({
  polyline,
  distanceMeters: 4600,
  durationSeconds: seconds,
  durationInTrafficSeconds: seconds,
  ...extra,
});

const laneSteps = [
  { targetStreetName: "Main Rd", polyline: line(LAT, 151.0, 151.01, 8) },
  { targetStreetName: "Smith Ln", polyline: lane },
  { targetStreetName: "Main Rd", polyline: line(LAT, 151.04, 151.05, 8) },
];

describe("minSavingFor", () => {
  it("scales with the trip: 1 min floor, 3 min cap", () => {
    expect(minSavingFor(300)).toBe(60);
    expect(minSavingFor(1200)).toBe(120);
    expect(minSavingFor(7200)).toBe(180);
  });
  it("a 2-minute saving on a 12-minute drive is now worth showing (was 3 min fixed)", () => {
    const s = pickShortcut({ currentSeconds: 720, currentAhead: yourRoad, candidates: [route(shortcutLine, 600, { steps: laneSteps })] });
    expect(s?.savedSeconds).toBe(120);
  });
});

describe("pickShortcut", () => {
  it("finds a back-lane shortcut from Google's alternatives (no avoid-highways, no jam needed)", () => {
    const s = pickShortcut({ currentSeconds: 900, currentAhead: yourRoad, candidates: [route(shortcutLine, 700, { steps: laneSteps })] });
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("backLane");
    expect(s!.road).toBe("Smith Ln");
    expect(s!.savedSeconds).toBe(200);
  });

  it("never offers your own road back as a 'shortcut' (root cause 3)", () => {
    const same = route(yourRoad, 500);
    expect(pickShortcut({ currentSeconds: 900, currentAhead: yourRoad, candidates: [same] })).toBeNull();
  });

  it("judges against your road's live time, so Google's best already being the shortcut still shows it", () => {
    // Google's best route now IS the shortcut (700 s); your road is 900 s. Old code compared the
    // shortcut with Google's best (itself) and got 0.
    const googleBest = route(shortcutLine, 700, { steps: laneSteps });
    expect(pickShortcut({ currentSeconds: 900, currentAhead: yourRoad, candidates: [googleBest] })?.savedSeconds).toBe(200);
  });

  it("picks the biggest saving and labels side streets", () => {
    const side = route(shortcutLine, 650, { viaSideStreets: true, steps: [{ targetStreetName: "Oak St", polyline: lane }] });
    const lanes = route(shortcutLine, 700, { steps: laneSteps });
    const s = pickShortcut({ currentSeconds: 900, currentAhead: yourRoad, candidates: [lanes, side] });
    expect(s!.route).toBe(side);
    expect(s!.kind).toBe("sideStreets");
    expect(s!.road).toBe("Oak St");
  });

  it("shows nothing when no saving is real", () => {
    expect(pickShortcut({ currentSeconds: 900, currentAhead: yourRoad, candidates: [route(shortcutLine, 880)] })).toBeNull();
    expect(pickShortcut({ currentSeconds: 0, currentAhead: yourRoad, candidates: [route(shortcutLine, 100)] })).toBeNull();
  });
});

describe("throughPointsAhead", () => {
  it("pins the request to the road ahead with via points, all on that road", () => {
    const at = { latitude: LAT, longitude: 151.02 };
    const pts = throughPointsAhead(yourRoad, at, null);
    expect(pts.length).toBe(6);
    for (const p of pts) {
      expect(p.via).toBe(true);
      expect(p.point.longitude).toBeGreaterThan(151.02);
      expect(p.point.latitude).toBeCloseTo(LAT, 6);
    }
  });
  it("keeps a stop as a real stop, in order along the road", () => {
    const stop = { latitude: LAT, longitude: 151.03 };
    const pts = throughPointsAhead(yourRoad, { latitude: LAT, longitude: 151.0 }, stop);
    const i = pts.findIndex((p) => !p.via);
    expect(pts[i].point).toEqual(stop);
    expect(pts.slice(0, i).every((p) => p.point.longitude < 151.03)).toBe(true);
    expect(pts.slice(i + 1).every((p) => p.point.longitude > 151.03)).toBe(true);
  });
});

describe("labels", () => {
  it("recognises back lanes", () => {
    expect(isBackLane("Smith Ln")).toBe(true);
    expect(isBackLane("Rear Lane")).toBe(true);
    expect(isBackLane("Lane Cove Rd")).toBe(false);
    expect(isBackLane("Oak St")).toBe(false);
  });
  it("banner text names the road and the saving", () => {
    expect(shortcutText({ kind: "backLane", road: "Smith Ln", savedSeconds: 200 }, "5:42 pm")).toEqual({
      title: "Back-lane shortcut",
      body: "Save 3 min via Smith Ln — arrive 5:42 pm",
    });
    expect(shortcutText({ kind: "sideStreets", road: null, savedSeconds: 61 }, "5:42 pm").body).toBe("Save 1 min via side streets — arrive 5:42 pm");
  });
});

describe("slowTrafficAhead", () => {
  it("only counts slow stretches that start within the window", () => {
    expect(slowTrafficAhead(yourRoad, [{ startIndex: 2, endIndex: 5, speed: "SLOW" }], 1000)).toBe(true);
    expect(slowTrafficAhead(yourRoad, [{ startIndex: 30, endIndex: 35, speed: "TRAFFIC_JAM" }], 1000)).toBe(false);
    expect(slowTrafficAhead(yourRoad, [{ startIndex: 0, endIndex: 39, speed: "NORMAL" }], 1000)).toBe(false);
  });
});

describe("route preview includes side streets", () => {
  const best = { polyline: yourRoad, distanceMeters: 4600, durationSeconds: 800 };
  const alt1 = { polyline: line(-33.905, 151.0, 151.05), distanceMeters: 5000, durationSeconds: 900 };
  const alt2 = { polyline: line(-33.91, 151.0, 151.05), distanceMeters: 5200, durationSeconds: 1000 };
  const side = { polyline: shortcutLine, distanceMeters: 4700, durationSeconds: 850, viaSideStreets: true };

  it("adds it when there's room, tagged 'Side streets'", () => {
    const out = withSideStreets([best, alt1], side);
    expect(out).toHaveLength(3);
    expect(routeTags(out)[2]).toBe("Side streets");
    expect(routeSummaryLine("Side streets", null, false)).toBe("Side streets");
  });
  it("replaces the slowest alternative when it's quicker, never the best route", () => {
    const out = withSideStreets([best, alt1, alt2], side);
    expect(out).toEqual([best, alt1, side]);
  });
  it("is left out when it's the same road as one listed", () => {
    expect(withSideStreets([best], { ...side, polyline: yourRoad })).toEqual([best]);
  });
});
