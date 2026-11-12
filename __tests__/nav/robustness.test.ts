// Real-world robustness: the navigation pipeline (route matcher -> guidance -> approach machine
// -> reroute trigger) driven along REAL recorded routes, through the shared simulator that moves
// the car along the road geometry one fix a second. Clean drives first; the same drives with
// realistic GPS noise (drifting 5-15 m error, single wild fixes 30-80 m off, spells of no signal)
// are separate cases below.
import { describe, expect, it } from "@jest/globals";
import m4 from "../fixtures/manoeuvres/m4-silverwater.json";
import m5 from "../fixtures/manoeuvres/m5-marsh-st.json";
import cbd from "../fixtures/manoeuvres/cbd-central-to-quay.json";
import parramatta from "../fixtures/manoeuvres/parramatta-local.json";
import castleHill from "../fixtures/manoeuvres/castle-hill-roundabouts.json";
import usLa from "../fixtures/manoeuvres/us-la-i10.json";
import deFrankfurt from "../fixtures/manoeuvres/de-frankfurt-a5.json";
import frParis from "../fixtures/manoeuvres/fr-paris-etoile.json";
import ukLondon from "../fixtures/manoeuvres/uk-london-m4.json";
import jpTokyo from "../fixtures/manoeuvres/jp-tokyo.json";
import exitTaken from "@/dev/testRoutes/m4-silverwater-taken.json";
import exitMissed from "@/dev/testRoutes/m4-silverwater-missed.json";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import type { Route } from "@/services/directions";
import type { LatLng } from "@/utils/polyline";
import { kindOfStep, metersBetween } from "@/nav/approach";
import { shouldTrack } from "@/nav/manoeuvre";
import { buildRouteGeometry } from "@/nav/routeMatcher";
import { driveTrack, routeSpeedAt, type GpsNoise } from "@/dev/simulateDrive";
import { driveNav } from "../support/navDrive";

const route = (fx: unknown): Route => parseMapboxResponse(fx)[0];
const tracked = (r: Route) => r.steps.map((s, i) => i).filter((i) => i < r.steps.length - 1 && shouldTrack(kindOfStep(r.steps[i])));

/** True progress along the route's own geometry at each simulated second (clean drive). */
function trueAlong(r: Route, speedAt = routeSpeedAt(r.steps, 50)): number[] {
  const geo = buildRouteGeometry(r.steps);
  let acc = 0;
  let prev: LatLng | null = null;
  return driveTrack(geo.points, speedAt).map((s) => {
    if (prev) acc += metersBetween(prev, s.truth);
    prev = s.truth;
    return acc;
  });
}

/** Shifts a stretch of track sideways (metres; + = right of the direction of travel). */
function shiftSideways(line: LatLng[], meters: number): LatLng[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const brg = Math.atan2((b.longitude - a.longitude) * Math.cos((p.latitude * Math.PI) / 180), b.latitude - a.latitude);
    const right = brg + Math.PI / 2;
    return {
      latitude: p.latitude + (meters * Math.cos(right)) / 111_320,
      longitude: p.longitude + (meters * Math.sin(right)) / (111_320 * Math.cos((p.latitude * Math.PI) / 180)),
    };
  });
}

describe("U-shaped car-park start (M4 route: 24 m, 19 m dogleg, 33 m, then the road)", () => {
  const r = route(m4);
  it("driven round the U: every turn taken in order, progress never runs ahead of the car", () => {
    const o = driveNav(r, r.polyline);
    expect([0, 1, 2].every((i) => o.confirmed.has(i))).toBe(true);
    expect(o.missed.size).toBe(0);
    expect(o.reroutes).toEqual([]);
    const truth = trueAlong(r);
    o.along.forEach((a, k) => expect(a - truth[k]).toBeLessThanOrEqual(15));
  });
  it("progress only ever moves forward", () => {
    const o = driveNav(r, r.polyline);
    for (let k = 1; k < o.along.length; k++) expect(o.along[k]).toBeGreaterThanOrEqual(o.along[k - 1]);
  });
});

describe("roundabout full loop (Paris, Place de l'Étoile: twice round the 12-road circle)", () => {
  const r = route(frParis);
  it("driven as planned: every roundabout exit taken, no miss, no reroute, never snaps across the circle", () => {
    const o = driveNav(r, r.polyline);
    expect(tracked(r).every((i) => o.confirmed.has(i))).toBe(true);
    expect(o.missed.size).toBe(0);
    expect(o.reroutes).toEqual([]);
    const truth = trueAlong(r);
    o.along.forEach((a, k) => expect(Math.abs(a - truth[k])).toBeLessThanOrEqual(15));
  });
});

describe("motorway with a parallel road (M4 Silverwater: the exit ramp runs 9 m beside the M4)", () => {
  const r = route(exitTaken);
  const exitIndex = r.steps.findIndex((s) => s.maneuverKind === "exit" && s.instruction.includes("Silverwater"));
  it("staying on the M4 beside the ramp is a missed exit -- never 'Exit taken'", () => {
    const o = driveNav(r, route(exitMissed).polyline, { speedKmh: 100, stopAtMiss: true });
    expect(o.confirmed.has(exitIndex)).toBe(false);
    expect(o.missed.has(exitIndex)).toBe(true);
  });
  it("taking the ramp is 'Exit taken' -- never missed", () => {
    const o = driveNav(r, r.polyline, { speedKmh: 100 });
    expect(o.confirmed.has(exitIndex)).toBe(true);
    expect(o.missed.size).toBe(0);
  });
});

describe("overpass / underpass: the Frankfurt route crosses itself in the Frankfurter Kreuz", () => {
  const r = route(deFrankfurt);
  it("passing under (and later over) its own later/earlier road never snaps progress to the other level", () => {
    const o = driveNav(r, r.polyline);
    const truth = trueAlong(r);
    o.along.forEach((a, k) => expect(Math.abs(a - truth[k])).toBeLessThanOrEqual(20));
    expect(o.missed.size).toBe(0);
    expect(o.reroutes).toEqual([]);
    expect(tracked(r).every((i) => o.confirmed.has(i))).toBe(true);
  });
});

describe("a 70 m GPS jump", () => {
  const r = route(exitTaken);
  const exitIndex = r.steps.findIndex((s) => s.maneuverKind === "exit" && s.instruction.includes("Silverwater"));
  const geo = buildRouteGeometry(r.steps);
  // One wild fix 70 m to the side, 15 s before the exit; another 70 m AHEAD along the route.
  const jumpAt = Math.round((geo.stepEnds[exitIndex] - 400) / (100 / 3.6));
  for (const kind of ["sideways", "ahead"] as const) {
    it(`${kind}: no reroute, no miss, progress not dragged, the exit still taken`, () => {
      const seconds = driveTrack(r.polyline, () => 100);
      const s = seconds[jumpAt];
      const target = kind === "sideways" ? shiftSideways([seconds[jumpAt - 1].truth, s.truth, seconds[jumpAt + 1].truth], 70)[1] : seconds[jumpAt + 3].truth;
      // (ahead: about 83 m further along the road -- three seconds' driving at 100 km/h)
      const noisy = seconds.map((x, k) => (k === jumpAt && x.fix ? { ...x, fix: { ...x.fix, latitude: target.latitude, longitude: target.longitude } } : x));
      const o = driveNav(r, r.polyline, { speedKmh: 100, injected: noisy });
      expect(o.reroutes).toEqual([]);
      expect(o.missed.size).toBe(0);
      expect(o.confirmed.has(exitIndex)).toBe(true);
      // The jump fix doesn't move progress more than it could have moved.
      expect(o.along[jumpAt] - o.along[jumpAt - 1]).toBeLessThanOrEqual((100 / 3.6) * 1.5 + 30);
    });
  }
});

describe("tunnel signal loss (M5 East Tunnel, 2.8 km underground)", () => {
  const r = route(m5);
  const tunnel = r.steps.findIndex((s) => s.instruction.includes("M5 East Tunnel"));
  const geo = buildRouteGeometry(r.steps);
  const speedAt = routeSpeedAt(r.steps, 64);
  // Second at which the car is ~800 m into the tunnel road.
  const truth = trueAlong(r, speedAt);
  const inTunnel = truth.findIndex((a) => a > geo.stepEnds[tunnel - 1] + 800);
  for (const lossS of [3, 5, 25, 45]) {
    it(`${lossS} s without a fix: progress carried on (dead reckoning <= 30 s), no reroute, no miss, everything after still taken`, () => {
      const noise: GpsNoise = { seed: 7, jitterMeters: 0, signalLoss: [[inTunnel, lossS]] };
      const o = driveNav(r, r.polyline, { speedAt, noise });
      expect(o.missed.size).toBe(0);
      expect(o.reroutes).toEqual([]);
      expect(tracked(r).every((i) => o.confirmed.has(i))).toBe(true);
      // While dark, progress moves on (it doesn't freeze), but never more than 30 s worth.
      const during = o.ticks.filter((t) => t.match.status === "deadReckoning");
      expect(during.length).toBeLessThanOrEqual(30);
      expect(during.length).toBeGreaterThanOrEqual(Math.min(lossS, 30) - 2);
      if (during.length > 1) expect(during[during.length - 1].match.along).toBeGreaterThan(during[0].match.along);
    });
  }
});

describe("correct exit, missed exit (M4 Silverwater, 100 km/h)", () => {
  const r = route(exitTaken);
  const exitIndex = r.steps.findIndex((s) => s.maneuverKind === "exit" && s.instruction.includes("Silverwater"));
  it("correct: zoom in, Exit taken, no reroute", () => {
    const o = driveNav(r, r.polyline, { speedKmh: 100 });
    expect(o.effects.some((e) => e.effect.kind === "zoomIn" && e.effect.stepIndex === exitIndex)).toBe(true);
    expect(o.confirmed.has(exitIndex)).toBe(true);
    expect(o.reroutes).toEqual([]);
  });
  it("missed: missed, then a missed-turn reroute (one), never taken", () => {
    const o = driveNav(r, route(exitMissed).polyline, { speedKmh: 100 });
    expect(o.confirmed.has(exitIndex)).toBe(false);
    expect(o.missed.has(exitIndex)).toBe(true);
    expect(o.reroutes[0]?.reason).toBe("missed-turn");
  });
});

describe("late lane change: in the straight-on lane until 30 m before the exit, then across", () => {
  const r = route(exitTaken);
  const exitIndex = r.steps.findIndex((s) => s.maneuverKind === "exit" && s.instruction.includes("Silverwater"));
  it("still 'Exit taken', no miss, no reroute", () => {
    const geo = buildRouteGeometry(r.steps);
    const split = geo.stepEnds[exitIndex];
    // The route's own line, one lane (3.5 m) to the right until 30 m before the split.
    const pts = geo.points;
    const lateAt = pts.findIndex((_, i) => geo.cum[i] >= split - 30);
    const startAt = pts.findIndex((_, i) => geo.cum[i] >= split - 600);
    const track = [...pts.slice(0, startAt), ...shiftSideways(pts.slice(startAt, lateAt), 3.5), ...pts.slice(lateAt)];
    const o = driveNav(r, track, { speedKmh: 90 });
    expect(o.confirmed.has(exitIndex)).toBe(true);
    expect(o.missed.size).toBe(0);
    expect(o.reroutes).toEqual([]);
  });
});

// ---- the same real routes with realistic GPS noise (separate from the clean cases) ----

const ALL: [string, unknown][] = [
  ["M4 Silverwater", m4],
  ["M5 Marsh St (with the tunnel)", m5],
  ["CBD Central to Circular Quay", cbd],
  ["Parramatta local", parramatta],
  ["Castle Hill roundabouts", castleHill],
  ["USA: I-10", usLa],
  ["Germany: Frankfurt A5", deFrankfurt],
  ["France: Place de l'Étoile", frParis],
  ["UK: Heathrow roundabouts", ukLondon],
  ["Japan: Tokyo", jpTokyo],
];

describe.each(ALL)("noisy GPS: %s", (_name, fx) => {
  const r = route(fx);
  const noise = (seed: number): GpsNoise => ({ seed, jitterMeters: 12, jumpChance: 0.02, signalLoss: [[40, 3], [120, 5]] });
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: driven as planned -- no false miss, no reroute, progress forward only`, () => {
      const o = driveNav(r, r.polyline, { noise: noise(seed) });
      expect([...o.missed]).toEqual([]);
      expect(o.reroutes).toEqual([]);
      for (let k = 1; k < o.along.length; k++) expect(o.along[k]).toBeGreaterThanOrEqual(o.along[k - 1]);
    });
  }
  it("most turns still get their chip despite the noise (none wrongly)", () => {
    const o = driveNav(r, r.polyline, { noise: noise(4) });
    const t = tracked(r);
    expect(o.confirmed.size / t.length).toBeGreaterThanOrEqual(0.8);
    for (const i of o.confirmed) expect(t).toContain(i);
  });
});
