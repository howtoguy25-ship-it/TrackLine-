// Step 1 (routing data): lane parsing, the Mapbox/OSRM parser on a real recorded Sydney route,
// the step convention, request building and duplicate-reroute cancelling.
import { describe, expect, it, jest } from "@jest/globals";
import taken from "@/dev/testRoutes/m4-silverwater-taken.json";
import {
  RerouteRequester,
  composeInstruction,
  congestionIntervals,
  directionsUrl,
  excludeParam,
  parseMapboxResponse,
  type MapboxRequest,
} from "@/services/mapboxDirections";
import { manoeuvresAtStepEnds, type RouteStep } from "@/services/directions";
import {
  laneSentence,
  lanesAreUseful,
  parseBannerLanes,
  parseIntersectionLanes,
  showLaneStrip,
  summariseLanes,
} from "@/nav/lanes";

describe("lane parsing", () => {
  it("reads intersection lanes left to right with valid / active / valid_indication", () => {
    const lanes = parseIntersectionLanes([
      { indications: ["slight left"], valid: true, active: true, valid_indication: "slight left" },
      { indications: ["straight"], valid: true, active: false },
      { indications: ["straight"], valid: false },
      { indications: [], valid: false },
    ])!;
    expect(lanes.map((l) => [l.indications.join("/"), l.valid, l.active])).toEqual([
      ["slight left", true, true],
      ["straight", true, false],
      ["straight", false, false],
      ["none", false, false],
    ]);
    expect(lanes[0].validIndication).toBe("slight left");
  });

  it("an OSRM lane without `active` counts as active when it's valid", () => {
    expect(parseIntersectionLanes([{ indications: ["left"], valid: true }])![0].active).toBe(true);
  });

  it("reads Mapbox banner lane components", () => {
    const lanes = parseBannerLanes([
      { type: "text", text: "M4" },
      { type: "lane", directions: ["left"], active: true, active_direction: "left" },
      { type: "lane", directions: ["straight"], active: false },
    ])!;
    expect(lanes).toHaveLength(2);
    expect(lanes[0]).toMatchObject({ valid: true, active: true, validIndication: "left" });
    expect(lanes[1]).toMatchObject({ valid: false, active: false });
  });

  it("no lane data means no lanes -- never invented", () => {
    expect(parseIntersectionLanes(undefined)).toBeNull();
    expect(parseIntersectionLanes([])).toBeNull();
    expect(parseBannerLanes([{ type: "text", text: "x" }])).toBeNull();
  });

  it("lanes are only worth showing when some, but not all, can be used", () => {
    const l = (valid: boolean) => ({ indications: ["straight" as const], valid, active: valid });
    expect(lanesAreUseful([l(true), l(true)])).toBe(false);
    expect(lanesAreUseful([l(false), l(false)])).toBe(false);
    expect(lanesAreUseful([l(true), l(false)])).toBe(true);
  });

  it("the strip shows from 1,000 m out", () => {
    const lanes = parseIntersectionLanes([
      { indications: ["left"], valid: true },
      { indications: ["straight"], valid: false },
    ]);
    expect(showLaneStrip(lanes, 1001)).toBe(false);
    expect(showLaneStrip(lanes, 1000)).toBe(true);
    expect(showLaneStrip(lanes, 50)).toBe(true);
    expect(showLaneStrip(null, 50)).toBe(false);
  });

  it("says which lanes: 'keep left, use the two left lanes to take exit 3B'", () => {
    const lanes = parseIntersectionLanes([
      { indications: ["slight left"], valid: true },
      { indications: ["slight left", "straight"], valid: true },
      { indications: ["straight"], valid: false },
      { indications: ["straight"], valid: false },
    ])!;
    expect(summariseLanes(lanes)).toEqual({ count: 2, total: 4, side: "left" });
    expect(laneSentence({ lanes, kind: "exit", side: "left", exitNumber: "3B" })).toBe(
      "keep left, use the two left lanes to take exit 3B"
    );
    expect(laneSentence({ lanes, kind: "exit", side: "left", toward: "Silverwater Road" })).toBe(
      "keep left, use the two left lanes to take the exit to Silverwater Road"
    );
    const right = parseIntersectionLanes([
      { indications: ["straight"], valid: false },
      { indications: ["right"], valid: true },
    ])!;
    expect(laneSentence({ lanes: right, kind: "turn" })).toBe("use the right lane");
    const middle = parseIntersectionLanes([
      { indications: ["left"], valid: false },
      { indications: ["straight"], valid: true },
      { indications: ["right"], valid: false },
    ])!;
    expect(laneSentence({ lanes: middle, kind: "turn" })).toBe("use the middle lane");
    expect(laneSentence({ lanes: undefined, kind: "exit" })).toBeNull();
  });
});

describe("Mapbox / OSRM route parsing (real recorded route: M4 to the Silverwater Road exit)", () => {
  const [route] = parseMapboxResponse(taken);

  it("decodes the polyline6 geometry onto the real roads", () => {
    expect(route.source).toBe("mapbox");
    expect(route.polyline.length).toBeGreaterThan(50);
    // Starts near Parramatta, ends near Silverwater.
    expect(route.polyline[0].latitude).toBeCloseTo(-33.817, 2);
    expect(route.polyline[0].longitude).toBeCloseTo(150.979, 2);
    expect(Math.round(route.distanceMeters)).toBe(10110);
  });

  it("each step carries the manoeuvre at its END (the step before the exit holds the exit)", () => {
    const exitStep = route.steps.find((s) => s.maneuverKind === "exit" && s.instruction.includes("Silverwater"))!;
    expect(exitStep).toBeTruthy();
    expect(exitStep.maneuver).toBe("ramp-left");
    expect(exitStep.maneuverSide).toBe("left");
    // The manoeuvre point is the step's end: the split, at 151.0407, -33.8409.
    expect(exitStep.endLocation.longitude).toBeCloseTo(151.0407, 3);
    expect(exitStep.endLocation.latitude).toBeCloseTo(-33.8409, 3);
    // Real OpenStreetMap lanes: four lanes, the left one goes to the exit.
    expect(exitStep.lanes?.map((l) => l.valid)).toEqual([true, false, false, false]);
    expect(exitStep.lanes?.[0].indications).toEqual(["slight left"]);
  });

  it("the merge onto the M4 is classified as a merge, and the last step is the arrival", () => {
    expect(route.steps.some((s) => s.maneuverKind === "merge" && s.instruction.includes("Western Motorway"))).toBe(true);
    expect(route.steps[route.steps.length - 1].maneuverKind).toBe("arrive");
    expect(route.steps[route.steps.length - 1].instruction).toBe("You've arrived");
  });

  it("composes an instruction when the data has none (OSRM has no banner text)", () => {
    expect(composeInstruction({ maneuver: { type: "off ramp", modifier: "slight left" }, name: "Silverwater Road Offramp", exits: "3B" })).toBe(
      "Take exit 3B to Silverwater Road Offramp"
    );
    expect(composeInstruction({ maneuver: { type: "merge", modifier: "slight right" }, name: "Western Motorway" })).toBe(
      "Merge right onto Western Motorway"
    );
    expect(composeInstruction({ maneuver: { type: "roundabout", modifier: "left", exit: 2 }, name: "New Link Road" })).toBe(
      "At the roundabout, take the second exit onto New Link Road"
    );
  });

  it("reads Mapbox's own instruction, exit number and junction view when present", () => {
    const json = {
      code: "Ok",
      routes: [
        {
          distance: 1000,
          duration: 60,
          geometry: "",
          legs: [
            {
              steps: [
                {
                  distance: 900,
                  duration: 50,
                  geometry: "",
                  name: "M5",
                  maneuver: { type: "depart", location: [151, -33.9] },
                  bannerInstructions: [
                    {
                      primary: { text: "Exit 3B Roberts Road", components: [{ type: "exit-number", text: "3B" }] },
                      sub: { components: [{ type: "lane", directions: ["left"], active: true }, { type: "lane", directions: ["straight"], active: false }] },
                      view: { components: [{ type: "guidance-view", imageURL: "https://api.mapbox.com/guidance-views/v1/x" }] },
                    },
                  ],
                  intersections: [{ bearings: [90, 270] }],
                },
                {
                  distance: 100,
                  duration: 10,
                  geometry: "",
                  name: "Roberts Road",
                  maneuver: { type: "off ramp", modifier: "slight left", instruction: "Take exit 3B towards Roberts Road", location: [151.01, -33.9] },
                  intersections: [{ bearings: [90, 270, 200] }],
                },
                { distance: 0, duration: 0, geometry: "", maneuver: { type: "arrive", location: [151.02, -33.9] }, intersections: [] },
              ],
              annotation: { congestion: ["low", "moderate", "moderate", "heavy", "unknown"], maxspeed: [{ speed: 100, unit: "km/h" }, { unknown: true }] },
            },
          ],
        },
      ],
    };
    const [r] = parseMapboxResponse(json);
    expect(r.steps[0]).toMatchObject({
      instruction: "Take exit 3B towards Roberts Road",
      exitNumber: "3B",
      maneuverKind: "exit",
      guidanceViewUrl: "https://api.mapbox.com/guidance-views/v1/x",
    });
    expect(r.steps[0].lanes?.map((l) => l.valid)).toEqual([true, false]);
    expect(r.speedIntervals).toEqual([
      { startIndex: 1, endIndex: 3, speed: "SLOW" },
      { startIndex: 3, endIndex: 4, speed: "TRAFFIC_JAM" },
    ]);
    expect(r.maxSpeedsKmh).toEqual([100, null]);
  });

  it("throws on an error response instead of inventing a route", () => {
    expect(() => parseMapboxResponse({ code: "NoRoute", message: "No route found" })).toThrow(/NoRoute/);
  });
});

describe("the request", () => {
  const req: MapboxRequest = {
    origin: { latitude: -33.8, longitude: 151.0 },
    destination: { latitude: -33.85, longitude: 151.04 },
    heading: 95,
    avoid: { tolls: true, ferries: true },
  };

  it("asks driving-traffic for steps, banners, voice, full polyline6 geometry, congestion + maxspeed, alternatives", () => {
    const url = directionsUrl(req, "TOKEN");
    expect(url).toContain("/directions/v5/mapbox/driving-traffic/151,-33.8;151.04,-33.85?");
    for (const p of [
      "steps=true",
      "banner_instructions=true",
      "voice_instructions=true",
      "overview=full",
      "geometries=polyline6",
      "annotations=congestion%2Cmaxspeed",
      "alternatives=true",
      "exclude=toll%2Cferry",
      "bearings=95%2C45%3B",
    ]) {
      expect(url).toContain(p);
    }
  });

  it("maps the Avoid settings Mapbox can express", () => {
    expect(excludeParam({ tolls: true, motorways: true, ferries: false, unpaved: true })).toBe("toll,motorway,unpaved");
    expect(excludeParam({})).toBeNull();
  });

  it("maps Mapbox congestion to slow / jammed stretches", () => {
    expect(congestionIntervals(["low", "severe", "severe"])).toEqual([{ startIndex: 1, endIndex: 3, speed: "TRAFFIC_JAM" }]);
    expect(congestionIntervals(undefined)).toBeUndefined();
  });

  it("a new reroute cancels the one still in flight (no stale answer wins)", async () => {
    const resolvers: ((v: never[]) => void)[] = [];
    const fetcher = jest.fn((_req: MapboxRequest, signal: AbortSignal) => {
      void signal;
      return new Promise<never[]>((resolve) => resolvers.push(resolve));
    });
    const requester = new RerouteRequester(fetcher as never);
    const first = requester.request(req);
    const second = requester.request(req);
    expect((fetcher.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    resolvers[0]([]);
    resolvers[1]([]);
    expect(await first).toBeNull();
    expect(await second).toEqual([]);
    expect(requester.busy).toBe(false);
  });
});

describe("Google steps are shifted so each step ends at its manoeuvre", () => {
  const step = (instruction: string, maneuver?: RouteStep["maneuver"]): RouteStep => ({
    instruction,
    maneuver,
    distanceMeters: 100,
    durationSeconds: 10,
    startLocation: { latitude: 0, longitude: 0 },
    endLocation: { latitude: 0, longitude: 0 },
    polyline: [],
  });

  it("'Head north' then 'Turn left onto B': the first step now says 'Turn left onto B'", () => {
    const out = manoeuvresAtStepEnds([
      step("Head north on A"),
      step("Turn left onto B", "turn-left"),
      step("Turn right onto C Destination will be on the left", "turn-right"),
    ]);
    expect(out.map((s) => [s.instruction, s.maneuver])).toEqual([
      ["Turn left onto B", "turn-left"],
      ["Turn right onto C Destination will be on the left", "turn-right"],
      ["Your destination is on the left", undefined],
    ]);
  });
});
