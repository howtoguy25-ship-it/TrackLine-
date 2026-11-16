// The parts behind the Reports switches: reading OpenStreetMap, when an approach alert fires,
// speed-limit-change and speedometer rules, and the route-derived items.
import { describe, expect, it } from "@jest/globals";
import { classifyOverpass, overpassClauses, type OverpassElement } from "@/services/osmTrafficData";
import { FORGET_MS, MIN_M, MAX_M, lookaheadMetres, nextApproachAlert, projectOnPolyline, type ApproachFeature } from "@/alerts/approachAlerts";
import { CONFIRM_MS, INITIAL_LIMIT_CHANGE, stepLimitChange } from "@/alerts/speedLimitChange";
import { selectedThresholdKey, showLimitSign, thresholdKmhFor, thresholdOptions, thresholdPatch } from "@/settings/speedometer";
import { DEFAULT_SETTINGS } from "@/services/settings";
import { anyOsmWanted, liveTrafficItem, osmFetchWanted, prefPatch, routeItemFor, isShown, alertsWhileDriving } from "@/settings/reportCatalog";
import { planPhrase, shouldSpeakPhrase } from "@/services/navSpeechPlan";
import type { TrafficIncident } from "@/services/trafficNswModel";
import type { ReportItemId } from "@/settings/reportCatalog";

// Overpass-shaped JSON (the shape the public Overpass API returns for `out body;`), using the
// documented OSM tags for each feature.
const ELEMENTS: OverpassElement[] = [
  { type: "relation", id: 900, lat: 0, lon: 0, tags: { type: "enforcement", enforcement: "traffic_signals" }, members: [{ type: "node", ref: 1, role: "device" }] },
  { type: "relation", id: 901, lat: 0, lon: 0, tags: { type: "enforcement", enforcement: "maxspeed" }, members: [{ type: "node", ref: 2, role: "device" }] },
  { type: "relation", id: 902, lat: 0, lon: 0, tags: { type: "enforcement", enforcement: "traffic_signals" }, members: [{ type: "node", ref: 2, role: "device" }] },
  { type: "relation", id: 903, lat: 0, lon: 0, tags: { type: "enforcement", enforcement: "mobile_phone;seatbelt" }, members: [{ type: "node", ref: 3, role: "device" }] },
  { type: "relation", id: 904, lat: 0, lon: 0, tags: { type: "enforcement", enforcement: "mindistance" }, members: [{ type: "node", ref: 4, role: "device" }] },
  { type: "node", id: 1, lat: -33.1, lon: 151.1, tags: {} },
  { type: "node", id: 14, lat: -34.4, lon: 152.4, tags: { highway: "speed_camera" } },
  { type: "node", id: 2, lat: -33.2, lon: 151.2, tags: {} },
  { type: "node", id: 3, lat: -33.3, lon: 151.3, tags: {} },
  { type: "node", id: 4, lat: -33.4, lon: 151.4, tags: {} },
  { type: "node", id: 5, lat: -33.5, lon: 151.5, tags: { railway: "level_crossing" } },
  { type: "node", id: 6, lat: -33.6, lon: 151.6, tags: { barrier: "toll_booth" } },
  { type: "node", id: 7, lat: -33.7, lon: 151.7, tags: { highway: "toll_gantry" } },
  { type: "node", id: 8, lat: -33.8, lon: 151.8, tags: { traffic_calming: "hump" } },
  { type: "node", id: 9, lat: -33.9, lon: 151.9, tags: { hazard: "curve" } },
  { type: "node", id: 10, lat: -34.0, lon: 152.0, tags: { highway: "crossing", crossing: "marked", traffic_calming: "table" } },
  { type: "node", id: 11, lat: -34.1, lon: 152.1, tags: { highway: "crossing", crossing: "traffic_signals" } },
  { type: "node", id: 12, lat: -34.2, lon: 152.2, tags: { highway: "crossing", crossing: "no" } },
  { type: "node", id: 13, lat: -34.3, lon: 152.3, tags: { highway: "traffic_signals" } },
];
const ALL = { wantTrafficLights: true, wantSpeedCameras: true, wantFeatures: ["redLightCamera", "redLightSpeedCamera", "mobilePhoneCamera", "seatBeltCamera", "safeDistanceCamera", "railwayCrossing", "tollBooth", "speedBump", "sharpCurve", "raisedCrossing", "pedestrianCrossing"] as const };

describe("OpenStreetMap features", () => {
  const out = classifyOverpass(ELEMENTS, { ...ALL, wantFeatures: [...ALL.wantFeatures] });
  const ids = (k: keyof typeof out.features) => (out.features[k] ?? []).map((p) => p.id);
  it("reads each kind from its documented tag", () => {
    expect(ids("redLightCamera")).toEqual([1]);
    expect(ids("redLightSpeedCamera")).toEqual([2]);
    expect(ids("mobilePhoneCamera")).toEqual([3]);
    expect(ids("seatBeltCamera")).toEqual([3]);
    expect(ids("safeDistanceCamera")).toEqual([4]);
    expect(ids("railwayCrossing")).toEqual([5]);
    expect(ids("tollBooth")).toEqual([6, 7]);
    expect(ids("speedBump")).toEqual([8]);
    expect(ids("sharpCurve")).toEqual([9]);
    expect(ids("raisedCrossing")).toEqual([10]);
    expect(ids("pedestrianCrossing")).toEqual([11]);
    expect(out.trafficLights.map((p) => p.id)).toEqual([13]);
  });
  it("a red light camera that also checks speed isn't drawn twice as a plain speed camera", () => {
    expect(out.speedCameras.map((p) => p.id)).toEqual([14]);
  });
  it("only returns (and only queries) what's switched on", () => {
    const some = classifyOverpass(ELEMENTS, { wantTrafficLights: false, wantSpeedCameras: false, wantFeatures: ["railwayCrossing"] });
    expect(Object.keys(some.features)).toEqual(["railwayCrossing"]);
    expect(some.trafficLights).toEqual([]);
    expect(overpassClauses("b", { wantTrafficLights: false, wantSpeedCameras: false, wantFeatures: ["railwayCrossing"] })).toEqual(['node["railway"="level_crossing"](b);']);
    expect(overpassClauses("b", { wantTrafficLights: false, wantSpeedCameras: false })).toEqual([]);
  });
  it("fetches what's shown OR alerting, and nothing when everything is off", () => {
    const w = osmFetchWanted(DEFAULT_SETTINGS);
    expect(w.trafficLights && w.speedCameras).toBe(true);
    expect(w.features).toContain("railwayCrossing");
    let s = { ...DEFAULT_SETTINGS };
    for (const id of ["trafficLights", "speedCamera", ...w.features] as const) {
      s = { ...s, ...prefPatch(s, id, "show", false) };
      s = { ...s, ...prefPatch(s, id, "alert", false) };
    }
    expect(anyOsmWanted(s)).toBe(false);
    // shown off but alerting on: still fetched (the alert needs the data)
    const alertOnly = { ...s, ...prefPatch(s, "railwayCrossing", "alert", true) };
    expect(osmFetchWanted(alertOnly).features).toEqual(["railwayCrossing"]);
  });
});

describe("Approach alerts", () => {
  const car = { latitude: -33.87, longitude: 151.2 };
  const at = (metresNorth: number, metresEast = 0) => ({ lat: -33.87 + metresNorth / 111_320, lng: 151.2 + metresEast / (111_320 * Math.cos((33.87 * Math.PI) / 180)) });
  const f = (key: string, m: number, e = 0): ApproachFeature => ({ key, item: "railwayCrossing", ...at(m, e) });
  const base = { nowMs: 1000, position: car, headingDeg: 0, speedKmh: 60 };

  it("warns earlier at higher speed, within limits", () => {
    expect(lookaheadMetres(30)).toBe(MIN_M);
    expect(lookaheadMetres(100)).toBeCloseTo((100 / 3.6) * 25, 0);
    expect(lookaheadMetres(200)).toBe(MAX_M);
  });
  it("only things ahead, nearest first, once each", () => {
    const features = [f("behind", -200), f("far", 380), f("near", 150), f("side", 10, 300)];
    const first = nextApproachAlert(features, base, {});
    expect(first.alert?.key).toBe("near");
    const second = nextApproachAlert(features, { ...base, nowMs: 2000 }, first.memory);
    expect(second.alert?.key).toBe("far");
    const third = nextApproachAlert(features, { ...base, nowMs: 3000 }, second.memory);
    expect(third.alert).toBeNull();
  });
  it("nothing while parked or walking", () => {
    expect(nextApproachAlert([f("x", 100)], { ...base, speedKmh: 5 }, {}).alert).toBeNull();
  });
  it("a second pass, long after, alerts again", () => {
    const one = nextApproachAlert([f("x", 100)], base, {});
    expect(nextApproachAlert([f("x", 100)], { ...base, nowMs: base.nowMs + FORGET_MS + 1 }, one.memory).alert?.key).toBe("x");
  });
  it("while navigating: on the route ahead only, not a parallel street", () => {
    const polyline = [car, { latitude: at(1000).lat, longitude: 151.2 }];
    const route = { polyline, alongM: 0 };
    const onRoute = f("on", 200);
    const parallel = f("parallel", 200, 80);
    const r = nextApproachAlert([parallel, onRoute], { ...base, route }, {});
    expect(r.alert?.key).toBe("on");
    expect(projectOnPolyline(polyline, { latitude: onRoute.lat, longitude: onRoute.lng })?.alongM).toBeCloseTo(200, -1);
  });
});

describe("Speed limit changes", () => {
  it("says a new limit once it has held for a moment, never the first one", () => {
    let st = INITIAL_LIMIT_CHANGE;
    let r = stepLimitChange(st, 60, 0, 50);
    expect(r.announce).toBeNull();
    st = r.state;
    r = stepLimitChange(st, 80, 1000, 60);
    expect(r.announce).toBeNull();
    st = r.state;
    r = stepLimitChange(st, 80, 1000 + CONFIRM_MS, 60);
    expect(r.announce).toBe(80);
    st = r.state;
    expect(stepLimitChange(st, 80, 9000, 60).announce).toBeNull();
  });
  it("a one-fix blip to a side street's limit says nothing", () => {
    let st = stepLimitChange(INITIAL_LIMIT_CHANGE, 60, 0, 50).state;
    st = stepLimitChange(st, 40, 1000, 50).state;
    const back = stepLimitChange(st, 60, 2000, 50);
    expect(back.announce).toBeNull();
    expect(stepLimitChange(back.state, 60, 9000, 50).announce).toBeNull();
  });
  it("is spoken in each language, and only when its switch is on", () => {
    expect(planPhrase({ kind: "speedLimit", limit: 80 }).fullText).toBe("Speed limit 80");
    expect(planPhrase({ kind: "speedLimit", limit: 80 }, { language: "es" }).fullText).toContain("80");
    expect(shouldSpeakPhrase("onlyAlerts", { kind: "speedLimit", limit: 80 })).toBe(true);
    expect(alertsWhileDriving({ ...DEFAULT_SETTINGS, ...prefPatch(DEFAULT_SETTINGS, "speedLimitChanges", "alert", false) }, "speedLimitChanges")).toBe(false);
  });
});

describe("Sudden slowdown", () => {
  it("has its own spoken line and switch", () => {
    expect(planPhrase({ kind: "slowdown" }).fullText).toBe("Slowdown ahead");
    expect(alertsWhileDriving(DEFAULT_SETTINGS, "suddenSlowdown")).toBe(true);
    expect(alertsWhileDriving({ ...DEFAULT_SETTINGS, ...prefPatch(DEFAULT_SETTINGS, "suddenSlowdown", "alert", false) }, "suddenSlowdown")).toBe(false);
  });
});

describe("Route items", () => {
  it("complex intersections and merges are controlled by their own switches", () => {
    expect(routeItemFor("complex")).toBe("complexIntersection");
    expect(routeItemFor("merge")).toBe("multiLaneMerge");
    expect(routeItemFor("exit")).toBeNull();
    const off = { ...DEFAULT_SETTINGS, ...prefPatch(DEFAULT_SETTINGS, "complexIntersection", "show", false) };
    expect(isShown(off, "complexIntersection")).toBe(false);
    expect(isShown(off, "multiLaneMerge")).toBe(true);
  });
});

describe("Live Traffic NSW incidents go to the right item", () => {
  it.each([
    [{ kind: "roadwork", category: "Roadwork", headline: "" }, "roadwork"],
    [{ kind: "flood", category: "Flooding", headline: "" }, "badWeather"],
    [{ kind: "incident", category: "Crash", headline: "Crash" }, "crash"],
    [{ kind: "incident", category: "Breakdown", headline: "" }, "carOnShoulder"],
    [{ kind: "incident", category: "Hazard", headline: "Lane closed" }, "blockedLane"],
    [{ kind: "incident", category: "Hazard", headline: "Road closed" }, "closures"],
    [{ kind: "incident", category: "Hazard", headline: "Livestock on road" }, "animals"],
    [{ kind: "incident", category: "Heavy Traffic", headline: "" }, "traffic"],
    [{ kind: "fire", category: "Fire", headline: "Grass fire" }, "otherHazards"],
  ] as [{ kind: TrafficIncident["kind"]; category: string; headline: string }, ReportItemId][])("%o -> %s", (incident, item) => {
    expect(liveTrafficItem(incident)).toBe(item);
  });
});

describe("Speedometer", () => {
  it("limit sign: always / when above / never", () => {
    expect(showLimitSign("always", 50, 60)).toBe(true);
    expect(showLimitSign("whenAbove", 50, 60)).toBe(false);
    expect(showLimitSign("whenAbove", 61, 60)).toBe(true);
    expect(showLimitSign("never", 90, 60)).toBe(false);
    expect(showLimitSign("always", 50, null)).toBe(false); // never a guessed limit
  });
  it("thresholds in km/h, mph and percent", () => {
    expect(thresholdOptions("km").map((o) => o.label)).toEqual(["At the limit", "+5 km/h", "+10 km/h", "+15 km/h", "+20 km/h", "+5%", "+10%", "+15%"]);
    expect(thresholdOptions("miles")[1]).toMatchObject({ label: "+5 mph", kmh: 8 });
    const pct10 = thresholdOptions("km").find((o) => o.key === "pct:10")!;
    const s = { ...DEFAULT_SETTINGS, ...thresholdPatch(pct10) };
    expect(thresholdKmhFor(s, 100)).toBe(10);
    expect(thresholdKmhFor(s, 40)).toBe(4);
    expect(selectedThresholdKey(s, "km")).toBe("pct:10");
    const atLimit = { ...DEFAULT_SETTINGS, ...thresholdPatch(thresholdOptions("km")[0]) };
    expect(thresholdKmhFor(atLimit, 60)).toBe(1);
    expect(selectedThresholdKey(atLimit, "km")).toBe("abs:0");
    expect(selectedThresholdKey({ ...DEFAULT_SETTINGS, speedingThresholdKmh: 3 }, "km")).toBeNull();
  });
});
