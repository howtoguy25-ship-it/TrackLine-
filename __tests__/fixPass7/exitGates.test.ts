// Fix pass 7 §1: smart exit gates. A warehouse (OSM Overpass JSON, the format our pipeline gets)
// with two exits:
//   * "Closed" -> the route goes out the other exit; "Open" -> nothing changes;
//   * no question when the route passes no gate;
//   * no question while moving (10 km/h+);
//   * 3 agreeing answers at that time -> used automatically (avoid / no question), other times
//     still asked; this driver's own recent answer -> not asked again;
//   * arriving: the entrance the route uses, closed by pattern -> another entrance.
import { readFileSync } from "fs";
import { describe, expect, it } from "@jest/globals";
import {
  alternativeExit,
  canAskNow,
  decideExit,
  exitAnswerPlan,
  exitLabel,
  exitQuestion,
  gatesOnRouteStart,
  overpassQuery,
  parseOverpass,
  patternFor,
  privateRoadExit,
  routeExitGate,
  exitReroute,
  holdRerouteWhileLeaving,
  siteAt,
  START_GATE_M,
  siteGates,
  SITE_MIN_AREA_M2,
  type ExitAnswer,
  type OsmElement,
} from "@/nav/exitGates";

// A 150 x 100 m warehouse lot in Wetherill Park (Sydney's industrial west), two gates: one on the
// north fence onto the street, one on the east fence. A route that leaves through the north gate.
const base = { latitude: -33.8460, longitude: 150.9000 };
const at = (north: number, east: number) => ({ lat: base.latitude + north / 111_195, lon: base.longitude + east / (111_195 * Math.cos((base.latitude * Math.PI) / 180)) });
const ll = (p: { lat: number; lon: number }) => ({ latitude: p.lat, longitude: p.lon });
const overpass: { elements: OsmElement[] } = {
  elements: [
    { type: "way", id: 1001, tags: { building: "warehouse", name: "Depot 7" }, geometry: [at(0, 0), at(0, 150), at(100, 150), at(100, 0), at(0, 0)] },
    { type: "node", id: 501, ...at(100, 75), tags: { barrier: "gate", access: "private" } }, // north fence
    { type: "node", id: 502, ...at(50, 150), tags: { barrier: "lift_gate", opening_hours: "Mo-Fr 06:00-18:00" } }, // east fence
    { type: "way", id: 3001, tags: { highway: "service", access: "private" }, geometry: [at(50, 75), at(100, 75)] },
    { type: "node", id: 999, ...at(400, 400), tags: { barrier: "gate" } }, // somewhere else
  ],
};
const data = parseOverpass(overpass.elements);
const parked = ll(at(50, 60)); // in the yard
// Out through the north gate and up the street.
const routeNorth = [parked, ll(at(70, 75)), ll(at(100, 75)), ll(at(130, 75)), ll(at(130, 300))];
// Out the east side without passing any gate (an open driveway).
const routeNoGate = [parked, ll(at(20, 60)), ll(at(-30, 60)), ll(at(-30, 300))];
const now = Date.UTC(2026, 10, 24, 22); // a weekday evening in Sydney
const bucket = "weekday-morning";
const ans = (open: boolean, b = bucket, ago = 3600_000): ExitAnswer => ({ open, bucket: b, atMs: now - ago });

describe("OSM: the site, its exits, the route", () => {
  it("parses the warehouse, its two gates and the private yard road; the site is large enough", () => {
    expect(data.sites).toHaveLength(1);
    expect(data.sites[0]).toMatchObject({ id: "w1001", kind: "warehouse", name: "Depot 7" });
    expect(data.sites[0].areaM2).toBeGreaterThan(SITE_MIN_AREA_M2);
    expect(Math.round(data.sites[0].areaM2 / 100) * 100).toBe(15000);
    expect(data.gates.map((g) => g.id).sort()).toEqual(["n501", "n502", "n999"]);
    expect(data.privateRoads.map((r) => r.id)).toEqual(["w3001"]);
    expect(overpassQuery(parked)).toMatch(/barrier~"\^\(gate\|lift_gate/);
  });

  it("the route starting in the yard: the site, its 2 exits, and the gate the route passes", () => {
    const site = siteAt(parked, data.sites)!;
    expect(site.id).toBe("w1001");
    const gates = siteGates(site, data.gates);
    expect(gates.map((g) => g.id).sort()).toEqual(["n501", "n502"]);
    expect(gatesOnRouteStart(routeNorth, gates).map((g) => g.gate.id)).toEqual(["n501"]);
    expect(gatesOnRouteStart(routeNoGate, gates)).toEqual([]);
    expect(privateRoadExit(routeNorth, data.privateRoads)?.id).toBe("w3001");
    // 150 m+ away and not inside: no site.
    expect(siteAt(ll(at(400, 400)), data.sites)).toBeNull();
    expect(exitQuestion(exitLabel(gates.find((g) => g.id === "n501")!, site, null))).toBe("Is the exit on the north side open?");
    expect(exitQuestion(exitLabel(gates[0], site, "Vanessa St"))).toBe("Is the exit on Vanessa St open?");
  });
});

describe("when to ask", () => {
  const site = siteAt(parked, data.sites)!;
  const gates = siteGates(site, data.gates);
  const north = gates.find((g) => g.id === "n501")!;

  it("asks for the gate on the route when nothing is known yet", () => {
    expect(decideExit({ site, exit: north, doc: null, myLast: null, nowMs: now, bucket })).toEqual({ kind: "ask", exit: north });
  });
  it("no question when the route passes no gate", () => {
    const exit = gatesOnRouteStart(routeNoGate, gates)[0]?.gate ?? null;
    expect(decideExit({ site, exit, doc: null, myLast: null, nowMs: now, bucket })).toEqual({ kind: "none" });
  });
  it("no question while moving: only stopped or under 10 km/h", () => {
    expect(canAskNow(0)).toBe(true);
    expect(canAskNow(9.9)).toBe(true);
    expect(canAskNow(10)).toBe(false);
    expect(canAskNow(40)).toBe(false);
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/route && exitQuestion && canAskNow\(currentSpeedKmh\) \? \(\s*<ExitGateCard/);
    expect(src).toMatch(/if \(exitQuestion && \(!route \|\| !canAskNow\(currentSpeedKmh\)\)\) setExitQuestion\(null\);/);
  });
  it("3 agreeing answers at this time: used automatically -- closed is avoided before anyone asks; open isn't asked", () => {
    const closed3 = { answers: [ans(false), ans(false, bucket, 7200_000), ans(false, bucket, 86400_000)] };
    expect(patternFor(closed3.answers, bucket, now).state).toBe("closed");
    expect(decideExit({ site, exit: north, doc: closed3, myLast: null, nowMs: now, bucket })).toEqual({ kind: "avoid", exit: north });
    const open3 = { answers: [ans(true), ans(true), ans(true)] };
    expect(decideExit({ site, exit: north, doc: open3, myLast: null, nowMs: now, bucket })).toEqual({ kind: "none" });
    // Two answers aren't a pattern yet; at another time of day the closed pattern doesn't apply.
    expect(decideExit({ site, exit: north, doc: { answers: [ans(false), ans(false)] }, myLast: null, nowMs: now, bucket }).kind).toBe("ask");
    expect(decideExit({ site, exit: north, doc: closed3, myLast: null, nowMs: now, bucket: "weekend-day" }).kind).toBe("ask");
  });
  it("not asked again if this driver answered within 7 days at a similar time", () => {
    expect(decideExit({ site, exit: north, doc: null, myLast: ans(true, bucket, 3 * 86400_000), nowMs: now, bucket }).kind).toBe("none");
    expect(decideExit({ site, exit: north, doc: null, myLast: ans(true, bucket, 8 * 86400_000), nowMs: now, bucket }).kind).toBe("ask");
    expect(decideExit({ site, exit: north, doc: null, myLast: ans(true, "weekend-night", 3600_000), nowMs: now, bucket }).kind).toBe("ask");
  });
});

describe("the answer", () => {
  const site = siteAt(parked, data.sites)!;
  const gates = siteGates(site, data.gates);
  const north = gates.find((g) => g.id === "n501")!;
  const q = { exit: north, gates, docs: {}, from: parked, bucket, arrivalVia: null };

  it("Closed -> the route goes out the other exit (the east gate), and says so", () => {
    expect(exitAnswerPlan(false, q, now)).toEqual({ action: "reroute", via: [gates.find((g) => g.id === "n502")], say: "Using another exit" });
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    // The new route starts AT that exit (a yard has no mapped roads), an arrival entrance stays a
    // via-point, stops kept.
    expect(src).toMatch(/const \{ origin, vias \} = exitReroute\(plan\.depart, plan\.arrive, from\);\s*const fresh = await getRouteThrough\(origin, destination, \[\.\.\.vias\.map\(\(p\) => \(\{ point: p, via: true \}\)\), \.\.\.stops\]\);/);
  });
  it("Open -> keep the route", () => {
    expect(exitAnswerPlan(true, q, now)).toEqual({ action: "keep" });
  });
  it("no other exit -> 'No other exit found', the route stays", () => {
    expect(exitAnswerPlan(false, { ...q, gates: [north] }, now)).toEqual({ action: "noOtherExit", say: "No other exit found" });
  });
  it("a gate right beside the closed one (a double gate, 20 m apart) is the same exit: 'No other exit found'", () => {
    const twin = { id: "n503", point: ll(at(100, 95)), barrier: "gate", access: null, openingHours: null }; // 20 m east of n501
    expect(alternativeExit([north, twin], "n501", {}, parked, bucket, now)).toBeNull();
    expect(exitAnswerPlan(false, { ...q, gates: [north, twin] }, now)).toEqual({ action: "noOtherExit", say: "No other exit found" });
    // With the real other exit there too, that one is chosen.
    expect(alternativeExit([north, twin, ...gates.filter((g) => g.id === "n502")], "n501", {}, parked, bucket, now)?.id).toBe("n502");
  });
  it("an exit that's itself known closed now is never offered as the other way out", () => {
    const docs = { n502: { answers: [ans(false), ans(false), ans(false)] } };
    expect(alternativeExit(gates, "n501", docs, parked, bucket, now)).toBeNull();
  });
});

describe("arriving", () => {
  it("the entrance the route arrives through is found from the end of the route", () => {
    const site = siteAt(parked, data.sites)!;
    const gates = siteGates(site, data.gates);
    const arriving = [...routeNorth].reverse(); // driving in from the street, through the north gate
    expect(gatesOnRouteStart([...arriving].reverse(), gates)[0].gate.id).toBe("n501");
    const docs = { n501: { answers: [ans(false), ans(false), ans(false)] } };
    expect(alternativeExit(gates, "n501", docs, parked, bucket, now)?.id).toBe("n502");
    expect(readFileSync("src/screens/MapScreen.tsx", "utf8")).toMatch(/routeExitGate\(\[\.\.\.chosen\.polyline\]\.reverse\(\), gates, endSite, destination\)/);
  });
});

// Regression (found in the proof run): a router snaps a start inside a yard onto the public street
// outside, so the route begins outside the site and passes no gate -- on ~100 real Sydney lots the
// app would never have asked. You still leave through a gate: the one nearest where the route begins.
describe("the route begins on the street outside the yard", () => {
  const site = siteAt(parked, data.sites)!;
  const gates = siteGates(site, data.gates);
  // Snapped onto the street 30 m north of the north gate, then away along it.
  const snapped = [ll(at(130, 80)), ll(at(130, 200)), ll(at(130, 400))];

  it("the exit is the gate nearest where the route begins", () => {
    expect(gatesOnRouteStart(snapped, gates)).toEqual([]);
    expect(routeExitGate(snapped, gates, site, parked)?.id).toBe("n501");
    expect(decideExit({ site, exit: routeExitGate(snapped, gates, site, parked), doc: null, myLast: null, nowMs: now, bucket }).kind).toBe("ask");
  });
  it("a gate the route really passes still wins", () => {
    expect(routeExitGate(routeNorth, gates, site, parked)?.id).toBe("n501");
  });
  it("no gate when you're not inside the site, the route starts inside it, or the nearest gate is too far", () => {
    expect(routeExitGate(snapped, gates, site, ll(at(200, 300)))).toBeNull(); // parked on the street
    expect(routeExitGate([ll(at(60, 60)), ll(at(70, 70))], gates, site, parked)).toBeNull(); // still in the yard
    const far = [ll(at(100 + START_GATE_M + 20, 75)), ll(at(400, 75))];
    expect(routeExitGate(far, gates, site, parked)).toBeNull();
  });
  it("the map screen uses it for leaving and arriving", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/const exit = routeExitGate\(chosen\.polyline, gates, site, from\) \?\? privateRoadExit/);
  });
});

// Regression (found in the proof run): "via the other gate" from a start the router snapped onto
// the street outside the CLOSED gate meant leaving through the closed gate and driving round. The
// new route starts at the other gate; the off-route reroute waits until you're out of the site.
describe("after Closed: the new route starts at the other gate", () => {
  const site = siteAt(parked, data.sites)!;
  const gates = siteGates(site, data.gates);
  const east = gates.find((g) => g.id === "n502")!;
  it("starts at the departure gate; an arrival entrance stays a via-point", () => {
    expect(exitReroute(east, null, parked)).toEqual({ origin: east.point, vias: [] });
    const entrance = { id: "n9", point: ll(at(900, 900)), barrier: "gate", access: null, openingHours: null };
    expect(exitReroute(null, entrance, parked)).toEqual({ origin: parked, vias: [entrance.point] });
    expect(exitReroute(east, entrance, parked)).toEqual({ origin: east.point, vias: [entrance.point] });
  });
  it("no off-route reroute while still crossing the yard; normal again once out", () => {
    expect(holdRerouteWhileLeaving(parked, { site })).toBe(true);
    expect(holdRerouteWhileLeaving(ll(at(60, 120)), { site })).toBe(true);
    expect(holdRerouteWhileLeaving(ll(at(50, 200)), { site })).toBe(false); // out on the street
    expect(holdRerouteWhileLeaving(parked, null)).toBe(false); // not leaving through a chosen gate
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/if \(holdRerouteWhileLeaving\(currentLatLng, leavingSiteRef\.current\)\) return;\s*leavingSiteRef\.current = null;\s*const missedManoeuvre/);
    expect(src).toMatch(/rerouteVia\(\{ depart: plan\.via\[0\], arrive: q\.arrivalVia, site: q\.site \}/);
  });
});
