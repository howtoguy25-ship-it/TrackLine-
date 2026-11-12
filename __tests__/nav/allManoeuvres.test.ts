// Every turn and exit, on every recorded route, both ways: drive the route as planned and every
// manoeuvre must end "taken" (never "missed"); drive the REAL carry-straight-on road at each
// manoeuvre instead and that manoeuvre must end "missed" (never "taken").
//
// Five real Sydney routes (motorway exits and merges, CBD grid turns, suburban roundabouts),
// recorded from OSRM / OpenStreetMap by scripts/record-osrm-test-routes.mjs.
import { afterAll, describe, expect, it } from "@jest/globals";
import m4 from "../fixtures/manoeuvres/m4-silverwater.json";
import m5 from "../fixtures/manoeuvres/m5-marsh-st.json";
import cbd from "../fixtures/manoeuvres/cbd-central-to-quay.json";
import parramatta from "../fixtures/manoeuvres/parramatta-local.json";
import castleHill from "../fixtures/manoeuvres/castle-hill-roundabouts.json";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { createGuidanceState, evaluateGuidance, remainingStepMeters } from "@/services/navigationGuidance";
import { decodePolyline, type LatLng } from "@/utils/polyline";
import { INITIAL_APPROACH, continuationOf, distanceToLineMeters, kindOfStep, metersBetween, reduceApproach, roadAfterSplit, type ApproachState } from "@/nav/approach";
import { shouldTrack } from "@/nav/manoeuvre";
import type { Route } from "@/services/directions";

interface Fixture {
  routes: unknown[];
  missed: { step: number; type: string; modifier: string; name: string; geometry: string }[];
}

const ROUTES: { name: string; fixture: Fixture; speedKmh: number }[] = [
  { name: "M4 Silverwater", fixture: m4 as Fixture, speedKmh: 90 },
  { name: "M5 Marsh St", fixture: m5 as Fixture, speedKmh: 90 },
  { name: "CBD Central to Circular Quay", fixture: cbd as Fixture, speedKmh: 40 },
  { name: "Parramatta local", fixture: parramatta as Fixture, speedKmh: 45 },
  { name: "Castle Hill roundabouts", fixture: castleHill as Fixture, speedKmh: 45 },
];

interface Outcome {
  confirmed: Set<number>;
  missed: Set<number>;
}

/**
 * GPS fixes once a second along a track. `speedAt` gives the speed for each part of the track, so
 * city streets are driven at city speed and motorways at motorway speed (from the recorded
 * route's own durations).
 */
function fixes(track: LatLng[], speedAt: (p: LatLng) => number): { latitude: number; longitude: number; elapsedMs: number }[] {
  const out = [{ ...track[0], elapsedMs: 0 }];
  let t = 0;
  let carried = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const seg = metersBetween(a, b);
    const mps = Math.max(4, speedAt(a) / 3.6);
    let along = mps - carried;
    while (along <= seg) {
      const f = seg === 0 ? 0 : along / seg;
      t += 1000;
      out.push({ latitude: a.latitude + (b.latitude - a.latitude) * f, longitude: a.longitude + (b.longitude - a.longitude) * f, elapsedMs: t });
      along += mps;
    }
    carried = seg - (along - mps);
  }
  return out;
}

/** The recorded speed of the route step nearest a point (km/h). */
function speedNear(nav: Route, fallbackKmh: number): (p: LatLng) => number {
  return (p) => {
    let best = Infinity;
    let kmh = fallbackKmh;
    for (const s of nav.steps) {
      if (s.durationSeconds <= 0 || s.distanceMeters < 1) continue;
      const d = distanceToLineMeters(p, s.polyline);
      if (d < best) {
        best = d;
        kmh = (s.distanceMeters / s.durationSeconds) * 3.6;
      }
    }
    return best < 60 ? kmh : fallbackKmh;
  };
}

/** Navigate `nav` while the car follows `track`; returns which manoeuvres ended taken / missed. */
function drive(nav: Route, track: LatLng[], speedKmh: number, stopAtMiss: boolean): Outcome {
  const guidance = createGuidanceState();
  let state: ApproachState = INITIAL_APPROACH;
  const confirmed = new Set<number>();
  const missed = new Set<number>();
  const speedAt = speedNear(nav, speedKmh);
  for (const p of fixes(track, speedAt)) {
    const position = { latitude: p.latitude, longitude: p.longitude };
    const g = evaluateGuidance(guidance, nav.steps, position.latitude, position.longitude, []);
    const step = nav.steps[g.activeStepIndex];
    const out = reduceApproach(state, {
      type: "tick",
      nowMs: p.elapsedMs,
      position,
      speedKmh: speedAt(position),
      activeStepIndex: g.activeStepIndex,
      steps: nav.steps,
      metersToManoeuvre: remainingStepMeters(step, position.latitude, position.longitude),
      offRouteMeters: distanceToLineMeters(position, nav.polyline),
    });
    for (const e of out.effects) {
      if (e.kind === "confirmed") confirmed.add(e.stepIndex);
      if (e.kind === "missed") missed.add(e.stepIndex);
    }
    state = out.state;
    if (stopAtMiss && missed.size) break;
  }
  return { confirmed, missed };
}

/** The route up to `point` (along the steps before it), for leading into a missed path. */
function routeUpTo(nav: Route, stepIndex: number, point: LatLng): LatLng[] {
  const before = nav.steps.slice(0, stepIndex).flatMap((s) => s.polyline);
  const own = nav.steps[stepIndex].polyline;
  let cut = 0;
  let best = Infinity;
  own.forEach((q, i) => {
    const d = metersBetween(q, point);
    if (d < best) {
      best = d;
      cut = i;
    }
  });
  return [...before, ...own.slice(0, cut + 1)];
}

const summary: string[] = [];

describe.each(ROUTES)("$name", ({ name, fixture, speedKmh }) => {
  const nav = parseMapboxResponse(fixture)[0];
  const tracked = nav.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => shouldTrack(kindOfStep(s)) && i < nav.steps.length - 1)
    .map(({ i }) => i);

  it("driven as planned: every turn and exit is taken, none missed", () => {
    const { confirmed, missed } = drive(nav, nav.polyline, speedKmh, false);
    expect([...missed]).toEqual([]);
    expect(tracked.filter((i) => !confirmed.has(i))).toEqual([]);
    summary.push(`${name}: ${confirmed.size}/${tracked.length} manoeuvres taken when driven as planned`);
  });

  it("carrying straight on at each turn/exit instead: that manoeuvre is missed, never taken", () => {
    let checked = 0;
    let noDifferentRoad = 0;
    for (const m of fixture.missed) {
      // OSRM step m.step is the manoeuvre; in the app it's the END of step m.step - 1.
      const stepIndex = m.step - 1;
      if (!tracked.includes(stepIndex)) continue;
      const path = decodePolyline(m.geometry, 6);
      // Only meaningful if the recorded straight-on road really parts from the route AT this
      // manoeuvre: within 150 m past the split it is well away (> 40 m) from the road the route
      // takes, and it never reaches the next manoeuvre point. OSRM sometimes can't carry straight
      // on (a merge still joins the motorway; a dead end; a route that starts 20 m before the turn)
      // and its path makes the turn anyway and leaves later -- that's an off-route at a later
      // point, not a miss of this one, so those are counted as having no different road.
      const split = nav.steps[stepIndex].endLocation;
      let nearest = 0;
      path.forEach((q, i) => {
        if (metersBetween(q, split) < metersBetween(path[nearest], split)) nearest = i;
      });
      const after = roadAfterSplit(nav.steps, stepIndex, 400);
      let along = 0;
      let parts = false;
      let leftRouteAt = Infinity;
      for (let i = nearest + 1; i < path.length; i++) {
        along += metersBetween(path[i - 1], path[i]);
        if (along > 150) break;
        if (distanceToLineMeters(path[i], after) > 40) parts = true;
        if (leftRouteAt === Infinity && distanceToLineMeters(path[i], nav.polyline) > 15) leftRouteAt = along;
      }
      // ...and it leaves the route right there, not after following the new road for a while.
      if (leftRouteAt > 80) parts = false;
      const nextPoint = nav.steps[stepIndex + 1].endLocation;
      const reachesNext = path.slice(nearest).some((q) => metersBetween(q, nextPoint) <= 10);
      if (!parts || reachesNext) {
        noDifferentRoad++;
        continue;
      }
      const track = [...routeUpTo(nav, stepIndex, path[0]), ...path];
      const { confirmed, missed } = drive(nav, track, speedKmh, true);
      expect({ step: stepIndex, name: m.name, taken: confirmed.has(stepIndex) }).toEqual({ step: stepIndex, name: m.name, taken: false });
      expect({ step: stepIndex, name: m.name, missed: missed.size > 0 }).toEqual({ step: stepIndex, name: m.name, missed: true });
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    summary.push(`${name}: ${checked} missed manoeuvres caught on real roads (${noDifferentRoad} had no different road straight ahead)`);
  });

  it("every turn/exit: leaving the route at the split instead is missed, never taken", () => {
    // Coverage for every tracked manoeuvre, including those where OSRM had no separate road
    // straight ahead: drive the real route up to the split, then keep going in the approach
    // direction for 300 m (a geometric departure, not a road). Wherever that heads away from the
    // route, the manoeuvre must end "missed".
    let checked = 0;
    for (const stepIndex of tracked) {
      const step = nav.steps[stepIndex];
      // At a merge the lanes join: there is no road carrying straight on to miss it by.
      if (kindOfStep(step) === "merge") continue;
      const ahead = continuationOf(step.polyline, 300);
      const away = ahead[ahead.length - 1];
      const steps = 30; // 10 m apart
      const straight = Array.from({ length: steps }, (_, k) => ({
        latitude: ahead[0].latitude + ((away.latitude - ahead[0].latitude) * (k + 1)) / steps,
        longitude: ahead[0].longitude + ((away.longitude - ahead[0].longitude) * (k + 1)) / steps,
      }));
      // Only where straight on really leaves the route here: more than 15 m off it within 80 m and
      // never back on it. (A roundabout's straight-ahead exit, or a line that cuts back across the
      // route further on, isn't a departure at this split.)
      const off = straight.map((q) => distanceToLineMeters(q, nav.polyline));
      const leavesAt = off.findIndex((d) => d > 15);
      if (leavesAt < 0 || leavesAt > 7 || off.slice(leavesAt).some((d) => d <= 15)) continue;
      const track = [...nav.steps.slice(0, stepIndex + 1).flatMap((s) => s.polyline), ...straight];
      const { confirmed, missed } = drive(nav, track, speedKmh, true);
      expect({ step: stepIndex, taken: confirmed.has(stepIndex), missed: missed.has(stepIndex) }).toEqual({ step: stepIndex, taken: false, missed: true });
      checked++;
    }
    summary.push(`${name}: ${checked}/${tracked.length} manoeuvres missed when leaving the route at the split`);
  });
});

afterAll(() => {
  // Printed so the totals are visible in the test output.
  console.log(summary.join("\n"));
});
