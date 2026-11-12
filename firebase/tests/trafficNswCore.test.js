// Pure unit tests (no emulator needed) for the Live Traffic NSW parsing. The feature objects
// below follow Transport for NSW's documented hazard GeoJSON shape; they are hand-built, not
// captured from the live feed (no API key has been available) -- see the note at the top of
// trafficNswCore.js.
const core = require("../functions/trafficNswCore");

function feature(overrides = {}, props = {}) {
  return {
    type: "Feature",
    id: 1234567,
    geometry: { type: "Point", coordinates: [151.2093, -33.8688] },
    properties: {
      mainCategory: "CRASH",
      headline: "CRASH Car and truck - SYDNEY Harbour Bridge",
      displayName: "CRASH",
      isMajor: false,
      ended: false,
      created: 1762819200000,
      lastUpdated: 1762822800000,
      roads: [{ mainStreet: "BRADFIELD HIGHWAY", suburb: "MILSONS POINT", crossStreet: "LAVENDER STREET", delay: "10 mins" }],
      adviceA: "Exercise caution",
      adviceB: "Allow extra travel time",
      otherAdvice: "<p>Two of four southbound lanes closed.</p>",
      ...props,
    },
    ...overrides,
  };
}

describe("feedUrl", () => {
  test("each feed is the documented hazards endpoint for its kind", () => {
    expect(core.feedUrl("incident")).toBe("https://api.transport.nsw.gov.au/v1/live/hazards/incident/open");
    expect(core.FEEDS.map((f) => f.kind)).toEqual(["incident", "roadwork", "majorevent", "flood", "fire"]);
  });
});

describe("parseFeature", () => {
  test("a normal incident comes through, tidied for a phone screen", () => {
    expect(core.parseFeature(feature(), "incident")).toEqual({
      id: "incident:1234567",
      kind: "incident",
      category: "Crash",
      headline: "CRASH Car and truck - SYDNEY Harbour Bridge",
      where: "Bradfield Highway at Lavender Street, Milsons Point",
      delay: "10 mins",
      advice: "Exercise caution Allow extra travel time Two of four southbound lanes closed.",
      major: false,
      lat: -33.8688,
      lng: 151.2093,
      updatedAt: 1762822800000,
    });
  });

  test("an all-capitals headline is put into normal case", () => {
    const incident = core.parseFeature(feature({}, { headline: "HEAVY TRAFFIC - M4 MOTORWAY" }), "incident");
    expect(incident.headline).toBe("Heavy Traffic - M4 Motorway");
  });

  test("an ended incident is dropped", () => {
    expect(core.parseFeature(feature({}, { ended: true }), "incident")).toBeNull();
  });

  test.each([
    ["no geometry", { geometry: null }],
    ["a line, not a point", { geometry: { type: "LineString", coordinates: [[151, -33], [151.1, -33.1]] } }],
    ["non-numeric coordinates", { geometry: { type: "Point", coordinates: ["x", "y"] } }],
    ["coordinates swapped (lat, lng)", { geometry: { type: "Point", coordinates: [-33.8688, 151.2093] } }],
    ["a point outside NSW", { geometry: { type: "Point", coordinates: [115.86, -31.95] } }],
    ["0,0", { geometry: { type: "Point", coordinates: [0, 0] } }],
    ["no id anywhere", { id: undefined }],
  ])("dropped: %s", (_name, overrides) => {
    expect(core.parseFeature(feature(overrides), "incident")).toBeNull();
  });

  test("markup and control characters never reach the app", () => {
    const incident = core.parseFeature(
      feature({}, { otherAdvice: "<script>alert(1)</script>Detour\u0007 via <b>Smith St</b>&nbsp;now", adviceA: "", adviceB: "" }),
      "incident"
    );
    expect(incident.advice).toBe("alert(1) Detour via Smith St now");
    expect(incident.advice).not.toMatch(/[<>\u0000-\u001f]/);
  });

  test("missing optional fields cost only those details", () => {
    const incident = core.parseFeature(
      feature({}, { roads: undefined, adviceA: undefined, adviceB: undefined, otherAdvice: undefined, lastUpdated: undefined }),
      "roadwork"
    );
    expect(incident).toMatchObject({ id: "roadwork:1234567", where: "", delay: "", advice: "", updatedAt: 1762819200000 });
  });

  test("over-long text is cut to a bounded length", () => {
    const incident = core.parseFeature(feature({}, { otherAdvice: "x".repeat(5000) }), "incident");
    expect(incident.advice.length).toBeLessThanOrEqual(220);
  });

  test("timestamps in seconds or ISO text are understood", () => {
    expect(core.parseFeature(feature({}, { lastUpdated: 1762822800 }), "incident").updatedAt).toBe(1762822800000);
    expect(core.parseFeature(feature({}, { lastUpdated: "2026-11-11T01:00:00Z" }), "incident").updatedAt).toBe(
      Date.parse("2026-11-11T01:00:00Z")
    );
  });

  test("the id is taken from properties when the feature has none of its own", () => {
    expect(core.parseFeature(feature({ id: undefined }, { id: 77 }), "flood").id).toBe("flood:77");
  });
});

describe("parseFeed", () => {
  test("not GeoJSON at all -> an empty list, not a throw", () => {
    expect(core.parseFeed(null, "incident")).toEqual([]);
    expect(core.parseFeed({ features: "nope" }, "incident")).toEqual([]);
    expect(core.parseFeed({ features: [null, 5, "x", {}] }, "incident")).toEqual([]);
  });

  test("duplicates are removed; major incidents come first, then most recently updated", () => {
    const feed = {
      features: [
        feature({ id: 1 }, { lastUpdated: 1000000000000 }),
        feature({ id: 2 }, { lastUpdated: 3000000000000 }),
        feature({ id: 3 }, { isMajor: true, lastUpdated: 500000000000 }),
        feature({ id: 2 }, { lastUpdated: 3000000000000 }),
      ],
    };
    expect(core.parseFeed(feed, "incident").map((i) => i.id)).toEqual(["incident:3", "incident:2", "incident:1"]);
  });

  test("each kind is capped so the snapshot always fits in one document", () => {
    const features = Array.from({ length: 1000 }, (_v, i) => feature({ id: i + 1 }));
    expect(core.parseFeed({ features }, "roadwork")).toHaveLength(core.MAX_PER_KIND.roadwork);
    const snapshot = core.buildSnapshot(
      core.FEEDS.map((f) => ({ kind: f.kind, ok: true, incidents: core.parseFeed({ features }, f.kind) })),
      null,
      1
    );
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(900 * 1024);
  });
});

describe("buildSnapshot", () => {
  const incident = (kind, id) => ({ id: `${kind}:${id}`, kind });

  test("all feeds fetched -> everything fresh, nothing flagged", () => {
    const snapshot = core.buildSnapshot(
      [
        { kind: "incident", ok: true, incidents: [incident("incident", 1)] },
        { kind: "roadwork", ok: true, incidents: [incident("roadwork", 2)] },
      ],
      null,
      5000
    );
    expect(snapshot).toEqual({
      configured: true,
      updatedAt: 5000,
      checkedAt: 5000,
      failedKinds: [],
      incidents: [incident("incident", 1), incident("roadwork", 2)],
    });
  });

  test("a feed that failed keeps its previous incidents and is named as failed", () => {
    const previous = { updatedAt: 1000, incidents: [incident("incident", 9), incident("roadwork", 8)] };
    const snapshot = core.buildSnapshot(
      [
        { kind: "incident", ok: true, incidents: [incident("incident", 1)] },
        { kind: "roadwork", ok: false, incidents: [] },
      ],
      previous,
      5000
    );
    expect(snapshot.failedKinds).toEqual(["roadwork"]);
    expect(snapshot.incidents).toEqual([incident("incident", 1), incident("roadwork", 8)]);
    expect(snapshot.updatedAt).toBe(5000);
  });

  test("every feed failing does NOT move updatedAt forward -- old data isn't passed off as fresh", () => {
    const previous = { updatedAt: 1000, incidents: [incident("incident", 9)] };
    const snapshot = core.buildSnapshot([{ kind: "incident", ok: false, incidents: [] }], previous, 5000);
    expect(snapshot.updatedAt).toBe(1000);
    expect(snapshot.checkedAt).toBe(5000);
    expect(snapshot.incidents).toEqual([incident("incident", 9)]);
  });
});
