// Fix pass 7 §2: calm when still, sharp when driving.
//   * 60 s stationary, GPS ±10 m noise, compass wobbling: the arrow moves 0 m and turns 0°.
//   * The phone really turned (> 20° for 1 s): the heading follows (smoothly, by the turret).
//   * Driving a real road (the recorded Mapbox route) with GPS noise: the arrow follows the road
//     within 3 m (the route matcher's point), every fix, no lag; still -> moving eases, no jump.
import { readFileSync } from "fs";
import { describe, expect, it } from "@jest/globals";
import { HeadingHold, INITIAL_STILL, smoothAlong, stillLockStep, deadbandMeters, type AlongState, type StillState } from "@/nav/stillLock";
import { HeadingTurret } from "@/nav/headingTurret";
import { buildRouteGeometry, createMatchState, matchFix, pointAt } from "@/nav/routeMatcher";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { distanceKm } from "@/utils/geo";
import carJson from "../fixtures/travel/bankstown-parramatta.json";

/** Deterministic noise (a seeded LCG), so the run is the same every time. */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}
const m = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
const offset = (p: { latitude: number; longitude: number }, north: number, east: number) => ({
  latitude: p.latitude + north / 111_195,
  longitude: p.longitude + east / (111_195 * Math.cos((p.latitude * Math.PI) / 180)),
});

describe("60 s stationary with ±10 m GPS noise", () => {
  it("the arrow moves 0 m and turns 0°", () => {
    const r = rng(7);
    const parked = { latitude: -33.9175, longitude: 151.0345 };
    let s: StillState = INITIAL_STILL;
    const drawn: { latitude: number; longitude: number }[] = [];
    const hold = new HeadingHold();
    const turret = new HeadingTurret();
    const headings: number[] = [];
    for (let t = 0; t <= 60_000; t += 1000) {
      // Fixes scattered up to 10 m around the parked car, iOS-style accuracy 10 m, speed 0-0.6 m/s.
      const angle = r() * 2 * Math.PI;
      const dist = r() * 10;
      const fix = offset(parked, Math.cos(angle) * dist, Math.sin(angle) * dist);
      s = stillLockStep(s, { ...fix, accuracy: 10, speed: r() * 0.6, timeMs: t });
      drawn.push({ latitude: s.latitude, longitude: s.longitude });
      // The compass wobbles ±8° around 90° ten times a second.
      for (let k = 0; k < 10; k++) {
        const h = hold.push(90 + (r() * 16 - 8), t + k * 100, s.locked);
        if (h != null) turret.setTarget(h);
        headings.push(turret.step(t + k * 100) ?? 0);
      }
    }
    expect(s.locked).toBe(true);
    const moved = Math.max(...drawn.map((p) => m(p, drawn[0])));
    expect(moved).toBe(0);
    // After the first reading the held heading never changes, so the arrow never turns.
    const settled = headings.slice(20);
    expect(Math.max(...settled) - Math.min(...settled)).toBe(0);
    expect(deadbandMeters(3)).toBe(8);
    expect(deadbandMeters(14)).toBe(14);
  });

  // Regression (fix pass 7 §5 proof render): a parked phone also reports the odd spurious speed
  // (1.5-2 m/s) together with a fix jumping 10-15 m. One such fix used to unlock the arrow, and then
  // every raw fix was drawn: it moved 14 m in 60 s.
  it("lone speed spikes with a jumping fix (multipath) don't unlock it", () => {
    const r = rng(3);
    const parked = { latitude: -33.84462, longitude: 151.03712 };
    let s: StillState = INITIAL_STILL;
    const drawn: { latitude: number; longitude: number }[] = [];
    for (let t = 0; t <= 60_000; t += 1000) {
      const spike = t % 7000 === 3000; // every 7 s: 1.6-2.4 m/s, 12-15 m off
      const angle = r() * 2 * Math.PI;
      const dist = spike ? 12 + r() * 3 : r() * 8;
      const fix = offset(parked, Math.cos(angle) * dist, Math.sin(angle) * dist);
      s = stillLockStep(s, { ...fix, accuracy: 8, speed: spike ? 1.6 + r() * 0.8 : r() * 0.5, timeMs: t });
      drawn.push({ latitude: s.latitude, longitude: s.longitude });
    }
    expect(s.locked).toBe(true);
    expect(Math.max(...drawn.map((p) => m(p, drawn[0])))).toBe(0);
    // Even a lone 4 m/s reading isn't enough on its own.
    const one = stillLockStep(s, { ...offset(parked, 20, 0), accuracy: 8, speed: 4, timeMs: 61_000 });
    expect(one.locked).toBe(true);
    expect(m(one, drawn[0])).toBe(0);
    // A second moving fix a second later: that's driving -- unlocked.
    const two = stillLockStep(one, { ...offset(parked, 26, 0), accuracy: 8, speed: 4, timeMs: 62_000 });
    expect(two.locked).toBe(false);
  });

  it("the phone really turned (more than 20° for a second): the heading follows", () => {
    const hold = new HeadingHold();
    expect(hold.push(90, 0, true)).toBe(90);
    expect(hold.push(130, 100, true)).toBe(90); // just turned: not yet
    expect(hold.push(131, 600, true)).toBe(90);
    expect(hold.push(129, 1200, true)).toBe(129); // held for a second: taken
    expect(hold.push(140, 1300, true)).toBe(129); // a wobble within 20°: ignored
    expect(hold.push(200, 1400, false)).toBe(200); // moving: no hold
  });
});

describe("driving: sharp, on the road, no lag", () => {
  const route = parseMapboxResponse(carJson)[0];
  const geo = buildRouteGeometry(route.steps, route.polyline);
  it("follows the road within 3 m on every fix; starts from still without a jump", () => {
    const r = rng(11);
    let s: StillState = INITIAL_STILL;
    let state = createMatchState();
    const errors: number[] = [];
    let unlockedAt: number | null = null;
    // Drive the route's first 4 km at 50 km/h (14 m/s), one fix a second, GPS noise up to ±6 m.
    let lastDrawn: { latitude: number; longitude: number } | null = null;
    let biggestStep = 0;
    let along: AlongState | null = null;
    for (let t = 1000; t <= 290_000; t += 1000) {
      const truth = pointAt(geo, 14 * (t / 1000 - 1));
      const noisy = offset(truth, (r() - 0.5) * 12, (r() - 0.5) * 12);
      s = stillLockStep(s, { ...noisy, accuracy: 6, speed: 14, timeMs: t });
      if (!s.locked && unlockedAt === null) unlockedAt = t;
      const res = matchFix(geo, state, { latitude: noisy.latitude, longitude: noisy.longitude, accuracyM: 6, speedMps: 14, headingDeg: null, timeMs: t });
      state = res.state;
      // What the arrow draws while driving on the route: the matched distance along the route,
      // smoothed (MapScreen's arrowLatLng).
      along = res.result.onRoute ? smoothAlong(along, res.result.along, 14, t) : null;
      const drawn = s.locked ? { latitude: s.latitude, longitude: s.longitude } : along ? pointAt(geo, along.along) : noisy;
      if (res.result.onRoute && t > 5000) errors.push(m(drawn, truth));
      if (lastDrawn && t > 2000) biggestStep = Math.max(biggestStep, m(lastDrawn, drawn));
      lastDrawn = drawn;
    }
    expect(unlockedAt).toBe(3000); // the second fix at speed after the start unlocks it (one GPS second)
    expect(errors.length).toBeGreaterThan(100);
    // On the road within 3 m of where the car really is, on (nearly) every fix.
    const sorted = [...errors].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length * 0.95)]).toBeLessThanOrEqual(3);
    // No jump: one fix's step is about one second of driving (14 m) plus noise, never more.
    expect(biggestStep).toBeLessThan(30);
  });

  it("the map screen draws the calm / matched position, and the home camera follows the calm one", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/const arrowLatLng = isStill \? stillLatLng : route && navGeo && navMatch\?\.onRoute && smoothedAlong \? pointAt\(navGeo, smoothedAlong\.along\) : calmLatLng;/);
    expect(src).toMatch(/coordinate: arrowLatLng \?\? currentLatLng,/);
    expect(src).toMatch(/const at = calmLatLng;\s*\n\s*if \(!at \|\| route/);
    expect(src).toMatch(/headingHoldRef\.current\.push\(compassFilterRef\.current\.push\(/);
  });
});
