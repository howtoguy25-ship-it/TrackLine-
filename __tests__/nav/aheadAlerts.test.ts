// Ahead alerts §1-2: one feed from every source, on the route and ahead only, de-duplicated,
// jams merged with crashes; warning distances by speed; priority tiers; toggles respected.
import { describe, expect, it } from "@jest/globals";
import { buildAheadFeed, trafficSources, type AheadSource } from "@/nav/ahead/aheadFeed";
import { CRITICAL_KINDS, KIND_TIER, MINOR_KINDS, kindOfItem, spokenLine, titleFor } from "@/nav/ahead/aheadKinds";
import { bannerMs, closingProgress, distanceText, warnDistanceM } from "@/nav/ahead/aheadTiming";

// A straight 3 km road heading east from Bankstown; 1 deg lng here ~ 92.4 km.
const LAT = -33.92;
const LNG = 151.03;
const M_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);
const at = (eastM: number, northM = 0) => ({ lat: LAT + northM / 111320, lng: LNG + eastM / M_PER_DEG_LNG });
const ROUTE = Array.from({ length: 31 }, (_, i) => ({ latitude: LAT, longitude: LNG + (i * 100) / M_PER_DEG_LNG }));
const src = (key: string, kind: AheadSource["kind"], eastM: number, extra: Partial<AheadSource> = {}): AheadSource => ({
  key,
  kind,
  item: null,
  source: "community",
  ...at(eastM, extra.lat ?? 0),
  ...extra,
  ...(extra.lat !== undefined ? at(eastM, extra.lat) : {}),
});

describe("the ahead feed (§1)", () => {
  it("only things within 30 m of the route line: a parallel road 60 m away is ignored", () => {
    const feed = buildAheadFeed([src("on", "police", 800), src("near", "police", 1500, { lat: 20 }), src("parallel", "police", 1200, { lat: 60 })], ROUTE, 0);
    expect(feed.map((a) => a.key)).toEqual(["on", "near"]);
  });

  it("only ahead of the car, nearest first, with live distance", () => {
    const feed = buildAheadFeed([src("behind", "hazard", 200), src("far", "hazard", 2000), src("near", "camera", 900)], ROUTE, 500);
    expect(feed.map((a) => a.key)).toEqual(["near", "far"]);
    expect(feed[0].aheadM).toBeCloseTo(400, -1);
  });

  it("a source with a direction must match the route's (the other carriageway is ignored)", () => {
    const feed = buildAheadFeed([src("ours", "heavyTraffic", 1000, { source: "traffic", bearingDeg: 92 }), src("theirs", "standstill", 1400, { source: "traffic", bearingDeg: 270 })], ROUTE, 0);
    expect(feed.map((a) => a.key)).toEqual(["ours"]);
  });

  it("de-duplicates within 50 m: official beats a confirmed report beats a report beats the map", () => {
    const feed = buildAheadFeed(
      [
        src("osm", "roadwork", 1000, { source: "map" }),
        src("report", "roadwork", 1020, { source: "community" }),
        src("confirmed", "roadwork", 1010, { source: "community", confirmCount: 2 }),
        src("ltn", "roadwork", 1030, { source: "official" }),
        src("other", "roadwork", 1200, { source: "map" }),
      ],
      ROUTE,
      0
    );
    expect(feed.map((a) => a.key)).toEqual(["ltn", "other"]);
    expect(feed[0].confirmCount).toBe(2);
  });

  it("a crash inside a jam becomes one alert: 'Crash causing heavy traffic', from the jam's start", () => {
    const feed = buildAheadFeed([src("jam", "heavyTraffic", 1000, { source: "traffic", lengthM: 500 }), src("crash", "crash", 1300, { source: "official" })], ROUTE, 0);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ key: "crash", title: "Crash causing heavy traffic", mergedTraffic: "heavyTraffic", lengthM: 500 });
    expect(feed[0].alongM).toBeCloseTo(1000, -1);
  });

  it("missing data is skipped and logged, never a broken alert", () => {
    const logged: string[] = [];
    const bad = [
      { key: "nan", kind: "police", item: null, source: "community", lat: NaN, lng: 151 } as AheadSource,
      { key: "nokind", item: null, source: "community", ...at(500) } as unknown as AheadSource,
      undefined as unknown as AheadSource,
    ];
    const feed = buildAheadFeed([...bad, src("ok", "police", 600)], ROUTE, 0, (_m, k) => logged.push(k));
    expect(feed.map((a) => a.key)).toEqual(["ok"]);
    expect(logged).toEqual(["nan", "nokind", "?"]);
  });

  it("live traffic stretches from the route's own speed annotations, with their length", () => {
    const s = trafficSources(ROUTE, [
      { startIndex: 5, endIndex: 9, speed: "SLOW" },
      { startIndex: 12, endIndex: 14, speed: "TRAFFIC_JAM" },
      { startIndex: 20, endIndex: 22, speed: "NORMAL" },
    ]);
    expect(s.map((x) => x.kind)).toEqual(["heavyTraffic", "standstill"]);
    expect(s[0].lengthM!).toBeCloseTo(400, -1);
    const along = buildAheadFeed(s, ROUTE, 0).map((a) => a.alongM);
    expect(along[0]).toBeCloseTo(500, -1);
    expect(along[1]).toBeCloseTo(1200, -1);
  });
});

describe("kinds, priority and wording (§2)", () => {
  it("priority: closure/crash/standstill > police/hazard/lights/object > cameras/school > roadwork/traffic > humps/crossings", () => {
    expect(KIND_TIER.closure).toBeLessThan(KIND_TIER.police);
    expect(KIND_TIER.brokenLight).toBeLessThan(KIND_TIER.camera);
    expect(KIND_TIER.schoolZone).toBeLessThan(KIND_TIER.roadwork);
    expect(KIND_TIER.heavyTraffic).toBeLessThan(KIND_TIER.hump);
    expect([...CRITICAL_KINDS].sort()).toEqual(["brokenLight", "closure", "crash", "object", "standstill"]);
    expect([...MINOR_KINDS].sort()).toEqual(["crossing", "curve", "hump", "signal"]);
  });

  it("items map to kinds; a driver's traffic-light report is a broken light, a mapped one is just lights", () => {
    expect(kindOfItem("trafficLights", true)).toBe("brokenLight");
    expect(kindOfItem("trafficLights", false)).toBe("signal");
    expect(kindOfItem("redLightCamera", false)).toBe("camera");
    expect(kindOfItem("speedBump", false)).toBe("hump");
    expect(kindOfItem("closures", true)).toBe("closure");
    expect(kindOfItem("speedLimitChanges", false)).toBeNull();
    expect(titleFor("camera", "redLightCamera")).toBe("Red light camera");
    expect(titleFor("object", "blockedLane")).toBe("Lane blocked");
  });

  it("warning distance scales with speed", () => {
    const base = { critical: false, minor: false };
    expect(warnDistanceM(base, 10)).toBe(300);
    expect(warnDistanceM(base, 30)).toBe(450);
    expect(warnDistanceM({ critical: true, minor: false }, 10)).toBe(600);
    expect(warnDistanceM({ critical: true, minor: false }, 30)).toBe(750);
    expect(warnDistanceM({ critical: false, minor: true }, 10)).toBe(150);
    expect(warnDistanceM({ critical: false, minor: true }, 30)).toBe(240);
  });

  it("7 s banners, 6 s for minor features, 4 s reminders; 'Now' under 30 m; progress closes to 1", () => {
    expect(bannerMs({ minor: false }, false)).toBe(7000);
    expect(bannerMs({ minor: true }, false)).toBe(6000);
    expect(bannerMs({ minor: false }, true)).toBe(4000);
    expect(distanceText(400, "km")).toBe("400 m");
    expect(distanceText(29, "km")).toBe("Now");
    expect(closingProgress(300, 300)).toBe(0);
    expect(closingProgress(0, 300)).toBe(1);
  });

  it("spoken lines in our own words", () => {
    expect(spokenLine("hump", "Speed hump", null)).toBe("Speed hump ahead");
    expect(spokenLine("brokenLight", "Traffic light not working", null)).toBe("Traffic light not working ahead");
    expect(spokenLine("heavyTraffic", "Heavy traffic", 4)).toBe("Heavy traffic ahead, about four minutes");
    expect(spokenLine("crash", "Crash", null)).toBe("Crash reported ahead");
    expect(spokenLine("police", "Police", null)).toBe("Police reported ahead");
    expect(spokenLine("camera", "Speed camera", null)).toBe("Speed camera ahead");
  });
});
