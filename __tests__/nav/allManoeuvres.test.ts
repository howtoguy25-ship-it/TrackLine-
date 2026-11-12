// Every turn and exit, on every recorded route, both ways: drive the route as planned and every
// manoeuvre must end "taken" (never "missed"); drive the REAL carry-straight-on road at each
// manoeuvre instead and that manoeuvre must end "missed" (never "taken").
//
// Ten real routes -- five around Sydney, and the USA, Germany, France, the UK and Japan (motorway
// exits, splits and merges, city-grid turns, roundabouts and Paris's Étoile) -- recorded from
// OSRM / OpenStreetMap by scripts/record-osrm-test-routes.mjs.
import { afterAll, describe, expect, it } from "@jest/globals";
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
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { decodePolyline, type LatLng } from "@/utils/polyline";
import { continuationOf, distanceToLineMeters, kindOfStep, metersBetween, roadAfterSplit } from "@/nav/approach";
import { routeSpeedAt } from "@/dev/simulateDrive";
import { driveNav } from "../support/navDrive";
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
  // The rest of the world.
  { name: "USA: Santa Monica, I-10 freeway", fixture: usLa as Fixture, speedKmh: 90 },
  { name: "Germany: Frankfurt Airport, A5 interchanges", fixture: deFrankfurt as Fixture, speedKmh: 90 },
  { name: "France: Paris, Place de l'Étoile", fixture: frParis as Fixture, speedKmh: 30 },
  { name: "UK: Heathrow, Bath Road roundabouts", fixture: ukLondon as Fixture, speedKmh: 45 },
  { name: "Japan: Tokyo, Shinjuku to Imperial Palace", fixture: jpTokyo as Fixture, speedKmh: 40 },
];

/**
 * Navigate `nav` while the car follows `track` (driven along its geometry, each road at its own
 * recorded speed, through the app's own pipeline); which manoeuvres ended taken / missed.
 */
function drive(nav: Route, track: LatLng[], speedKmh: number, stopAtMiss: boolean): { confirmed: Set<number>; missed: Set<number>; rerouted: boolean } {
  const o = driveNav(nav, track, { stopAtMiss, speedAt: routeSpeedAt(nav.steps, speedKmh) });
  return { confirmed: o.confirmed, missed: o.missed, rerouted: o.reroutes.length > 0 };
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
    let leftEarly = 0;
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
      const { confirmed, missed, rerouted } = drive(nav, track, speedKmh, true);
      expect({ step: stepIndex, name: m.name, taken: confirmed.has(stepIndex) }).toEqual({ step: stepIndex, name: m.name, taken: false });
      // A recorded road that already leaves the route BEFORE the split (OSRM found another way
      // from 250 m back) is off-route there, not a miss of this turn: the app must reroute.
      const leavesEarly =
        metersBetween(path[nearest], split) > 30 || path.slice(0, nearest).some((q) => distanceToLineMeters(q, nav.polyline) > 40);
      if (leavesEarly) {
        expect({ step: stepIndex, name: m.name, rerouted }).toEqual({ step: stepIndex, name: m.name, rerouted: true });
        leftEarly++;
      } else {
        expect({ step: stepIndex, name: m.name, missed: missed.size > 0 }).toEqual({ step: stepIndex, name: m.name, missed: true });
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    summary.push(
      `${name}: ${checked} missed manoeuvres caught on real roads (${leftEarly} left the route before the turn: rerouted; ${noDifferentRoad} had no different road straight ahead)`
    );
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
