// The nav-fix acceptance drive: Stacey St, Bankstown (near no. 323) to 40 Bazentin St, Belfield,
// a real road route (recorded from OpenStreetMap routing by scripts/record-osrm-test-routes.mjs),
// driven second by second through the app's own pipeline (route matcher -> guidance -> approach),
// clean and with phone-like GPS noise. Checks every part of the permanent fix on the way:
// preview fits every route + start + end inside the free space on 4 phone sizes; the arrow and
// route line start at the same point; the camera follows at pitch 45 with the arrow at 70%;
// no floating control overlaps another; every turn is announced and the drive arrives.
import { describe, expect, it } from "@jest/globals";
import fx from "../fixtures/manoeuvres/stacey-to-bazentin.json";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { detailedRoutePolyline } from "@/services/directions";
import { driveNav } from "../support/navDrive";
import { boundsOf, previewEdgePadding, previewFitCoordinates, projectFitted, allVisible, MAX_SHEET_FRACTION, PREVIEW_PITCH } from "@/nav/previewCamera";
import { navFollowPose, navFollowPadding, NAV_ARROW_FRACTION, NAV_FOLLOW_PITCH } from "@/nav/navCamera";
import { navControlFrames, overlaps } from "@/nav/navControlsLayout";
import { routeAheadOf } from "@/map-v2/geo";

const route = parseMapboxResponse(fx)[0];
const line = detailedRoutePolyline(route);
const PHONES = [
  { width: 320, height: 568, safeTop: 20, safeBottom: 0 },
  { width: 375, height: 812, safeTop: 44, safeBottom: 34 },
  { width: 390, height: 844, safeTop: 47, safeBottom: 34 },
  { width: 430, height: 932, safeTop: 59, safeBottom: 34 },
];

describe("323 Stacey St → 40 Bazentin St", () => {
  it("is a real multi-turn route", () => {
    expect(route.distanceMeters).toBeGreaterThan(4000);
    expect(route.steps.length).toBeGreaterThan(8);
  });

  it("route preview: flat, and the whole route + start + destination fit the free space on every phone", () => {
    expect(PREVIEW_PITCH).toBe(0);
    for (const p of PHONES) {
      const pad = previewEdgePadding(p.safeTop + 150, p.height * MAX_SHEET_FRACTION);
      const pts = previewFitCoordinates([line], line[0], line[line.length - 1]);
      const fit = boundsOf(pts)!;
      expect([p.width, allVisible(projectFitted(pts, fit, p, pad), p, pad)]).toEqual([p.width, true]);
    }
  });

  for (const [name, noise] of [
    ["clean GPS", undefined],
    ["phone-like GPS (12 m drift, wild fixes, two signal drops)", { seed: 11, jitterMeters: 12, jumpChance: 0.02, signalLoss: [[40, 3], [120, 5]] as [number, number][] }],
  ] as const) {
    it(`drive with ${name}: every turn, no reroute, arrives; arrow and line start together`, () => {
      const o = driveNav(route, line, { noise });
      expect(o.arrived).toBe(true);
      expect(o.reroutes).toEqual([]);
      expect([...o.missed]).toEqual([]);
      // Progress only ever moves forward (within the matcher's small back window).
      for (let i = 1; i < o.along.length; i++) expect(o.along[i]).toBeGreaterThanOrEqual(o.along[i - 1] - 25);
      // The purple line drawn ahead starts exactly where the arrow is drawn.
      for (const t of o.ticks.filter((_, i) => i % 15 === 0)) {
        const ahead = routeAheadOf(line, t.match.snapped);
        expect(ahead[0].latitude).toBeCloseTo(t.match.snapped.latitude, 4);
        expect(ahead[0].longitude).toBeCloseTo(t.match.snapped.longitude, 4);
      }
    });
  }

  it("camera: pitch 45 while driving, arrow at 70% of the screen height", () => {
    const pose = navFollowPose(line[5], 90, 50);
    expect(pose.pitch).toBe(NAV_FOLLOW_PITCH);
    for (const p of PHONES) {
      const pad = navFollowPadding(p.height);
      expect((p.height + pad.top) / 2 / p.height).toBeCloseTo(NAV_ARROW_FRACTION, 2);
    }
  });

  it("controls: nothing overlaps on any phone, with or without Re-centre and the speed sign", () => {
    for (const p of PHONES) {
      for (const showRecenter of [false, true]) {
        for (const showSpeedLimit of [false, true]) {
          const frames = navControlFrames({ ...p, bottomBarHeight: 110, topBarHeight: 120, showRecenter, showSpeedLimit });
          expect([p.width, showRecenter, showSpeedLimit, overlaps(frames)]).toEqual([p.width, showRecenter, showSpeedLimit, []]);
        }
      }
    }
  });
});
