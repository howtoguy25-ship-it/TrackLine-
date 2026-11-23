// Live road view maths: where a camera box puts a vehicle, the route in the car's frame, the
// perspective, and when the view shows at all.
import { describe, expect, it } from "@jest/globals";
import { CLOSE_AHEAD_M, SCENE_RANGE_M, liveViewHeight, liveViewShown, project, routeAhead, sceneFromTracks, toLocal, trackToScene } from "@/nav/liveScene";
import { buildRouteGeometry } from "@/nav/routeMatcher";
import { estimateDistanceM } from "@/utils/speedTracker";

const W = 720;

describe("a camera box -> a place on the road", () => {
  it("a car centred in the picture is straight ahead, at the tracker's distance", () => {
    const bw = 100;
    const v = trackToScene({ id: 1, bbox: [W / 2 - bw / 2, 300, bw, 70], cls: "car" }, W)!;
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.z).toBeCloseTo(estimateDistanceM(bw, W, 1, "car"), 5);
  });
  it("a box right of centre is to the right; left is left; uses the smoothed distance when given", () => {
    const right = trackToScene({ id: 1, bbox: [500, 300, 80, 60], cls: "car", distanceM: 20 }, W)!;
    const left = trackToScene({ id: 2, bbox: [100, 300, 80, 60], cls: "car", distanceM: 20 }, W)!;
    expect(right.z).toBe(20);
    expect(right.x).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(0);
    // (540 - 360) * 20 / (720 * 0.75) = 6.67 m
    expect(right.x).toBeCloseTo(6.67, 1);
  });
  it("close in your lane is flagged; too far or too wide is left out", () => {
    expect(trackToScene({ id: 1, bbox: [310, 300, 100, 70], cls: "car", distanceM: CLOSE_AHEAD_M - 1 }, W)!.close).toBe(true);
    expect(trackToScene({ id: 1, bbox: [310, 300, 100, 70], cls: "car", distanceM: CLOSE_AHEAD_M + 1 }, W)!.close).toBe(false);
    expect(trackToScene({ id: 1, bbox: [310, 300, 100, 70], cls: "car", distanceM: SCENE_RANGE_M + 1 }, W)).toBeNull();
    expect(trackToScene({ id: 1, bbox: [0, 300, 10, 70], cls: "car", distanceM: 60 }, W)).toBeNull();
    expect(trackToScene({ id: 1, bbox: [0, 300, 0, 70], cls: "car" }, W)).toBeNull();
  });
  it("draws far ones first so near ones sit on top", () => {
    const s = sceneFromTracks(
      [
        { id: 1, bbox: [330, 300, 60, 40], cls: "car", distanceM: 10 },
        { id: 2, bbox: [330, 300, 60, 40], cls: "truck", distanceM: 40 },
      ],
      W
    );
    expect(s.map((v) => v.id)).toEqual([2, 1]);
  });
});

describe("the route in the car's frame", () => {
  const car = { latitude: -33.9, longitude: 151.1 };
  it("north of you while heading north is straight ahead; east is to the right", () => {
    const n = toLocal(car, 0, { latitude: car.latitude + 0.0009, longitude: car.longitude });
    expect(n.z).toBeCloseTo(100, -1);
    expect(Math.abs(n.x)).toBeLessThan(0.01);
    const e = toLocal(car, 0, { latitude: car.latitude, longitude: car.longitude + 0.001 });
    expect(e.x).toBeGreaterThan(90);
    // Heading east, the same point is ahead.
    expect(toLocal(car, 90, { latitude: car.latitude, longitude: car.longitude + 0.001 }).z).toBeGreaterThan(90);
  });
  it("follows the real route: a right turn 50 m ahead bends right", () => {
    const pts = [car, { latitude: car.latitude + 0.00045, longitude: car.longitude }, { latitude: car.latitude + 0.00045, longitude: car.longitude + 0.001 }];
    const geo = buildRouteGeometry([], pts);
    const ahead = routeAhead(geo, 0, car, 0, 120, 10);
    expect(ahead[0].z).toBeCloseTo(0, 3);
    const last = ahead[ahead.length - 1];
    expect(last.x).toBeGreaterThan(40);
    expect(last.z).toBeCloseTo(50, -1);
  });
});

describe("perspective", () => {
  const v = { width: 360, height: 240 };
  it("nearer is lower and bigger; behind the eye isn't drawn", () => {
    const near = project({ x: 0, z: 5 }, v)!;
    const far = project({ x: 0, z: 60 }, v)!;
    expect(near.v).toBeGreaterThan(far.v);
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(project({ x: 0, z: -20 }, v)).toBeNull();
    expect(project({ x: 3, z: 10 }, v)!.u).toBeGreaterThan(v.width / 2);
  });
  it("your car (z = 0) sits in the panel, near the bottom", () => {
    const me = project({ x: 0, z: 0 }, v)!;
    expect(me.v).toBeGreaterThan(v.height * 0.7);
    expect(me.v).toBeLessThan(v.height);
  });
});

describe("when it shows", () => {
  it("only with the toggle on, while navigating a driving route", () => {
    expect(liveViewShown(true, true, true)).toBe(true);
    expect(liveViewShown(false, true, true)).toBe(false);
    expect(liveViewShown(true, false, true)).toBe(false);
    expect(liveViewShown(true, true, false)).toBe(false);
  });
  it("takes about a third of the screen, 200-260 pt", () => {
    expect(liveViewHeight(568)).toBe(200);
    expect(liveViewHeight(844)).toBe(253);
    expect(liveViewHeight(1366)).toBe(260);
  });
});

describe("the map arrow with the panel up", () => {
  it("sits at the same 70 % of the map that's left above the panel", () => {
    const { navFollowPadding, NAV_ARROW_FRACTION } = require("@/nav/navCamera");
    const H = 844;
    const r = 330;
    const p = navFollowPadding(H, r);
    const centre = p.top + (H - p.top - p.bottom) / 2;
    expect(centre).toBeCloseTo(NAV_ARROW_FRACTION * (H - r), 0);
    expect(navFollowPadding(H).bottom).toBe(0);
  });
});

describe("your own car in the panel", () => {
  it("is drawn whole: its back bottom edge is inside the panel", () => {
    const { ME_Z_M } = require("@/nav/liveScene");
    const v = { width: 366, height: 253 };
    const back = project({ x: 0.9, z: ME_Z_M }, v)!;
    expect(back.v).toBeLessThan(v.height - 4);
    expect(back.u).toBeLessThan(v.width);
  });
});
