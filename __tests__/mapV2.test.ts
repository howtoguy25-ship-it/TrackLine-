// The Mapbox map's pure rules: the style (label zoom rules, road widths), route drawing, camera
// conversions, the re-centre gesture state, auto-zoom, and pin clustering.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "@jest/globals";
import {
  DARK_PALETTE,
  LABEL_MIN_ZOOM,
  LABEL_SPACING_PX,
  LIGHT_PALETTE,
  ROAD_LINE_MIN_ZOOM,
  SATELLITE_LABEL_PALETTE,
  THEME_PALETTES,
  buildStyle,
  roadWidthExpression,
  type RoadClass,
} from "../src/map-v2/styles/buildStyle";
import {
  boundsOfPoints,
  cameraStopFrom,
  googleZoomFromMapbox,
  isDrawableLine,
  lineFeature,
  mapboxZoomFromGoogle,
  metersPerPoint,
  metersRadiusExpression,
  regionFromBounds,
  splitRouteAt,
  turnArrowAt,
} from "../src/map-v2/geo";
import { GestureTracker } from "../src/map-v2/gestures";
import { clusteredPins, groupByCell, iconsUsed, pinsToFeatures, type MapPin } from "../src/map-v2/pins";
import { computeAutoZoom, shouldAnimateZoomChange } from "../src/map/cameraZoom";

type Layer = { id: string; type: string; minzoom?: number; layout?: Record<string, unknown>; paint?: Record<string, unknown>; filter?: unknown };
const STYLE_DIR = path.join(__dirname, "../src/map-v2/styles");
const light = buildStyle(LIGHT_PALETTE) as { layers: Layer[]; sources: Record<string, unknown>; glyphs: string };
const layer = (id: string) => light.layers.find((l) => l.id === id)!;

describe("map style", () => {
  it("the shipped style files are exactly what the rules produce", () => {
    const expected: [string, object][] = [
      ["trackline-light.json", buildStyle(LIGHT_PALETTE)],
      ["trackline-dark.json", buildStyle(DARK_PALETTE)],
      ["trackline-satellite-streets.json", buildStyle(SATELLITE_LABEL_PALETTE, { satellite: true })],
    ];
    for (const [file, style] of expected) {
      expect(JSON.parse(fs.readFileSync(path.join(STYLE_DIR, file), "utf8"))).toEqual(style);
    }
  });

  it("uses the requested colours", () => {
    expect(layer("land").paint!["background-color"]).toBe("#F7F8F7");
    expect(layer("parks").paint!["fill-color"]).toBe("#C9EFC9");
    expect(layer("water").paint!["fill-color"]).toBe("#A9D3F5");
    expect(layer("buildings").paint!["fill-color"]).toBe("#E6E8EA");
    expect(layer("road-residential").paint!["line-color"]).toBe("#D5D9DD");
    expect(layer("road-casing-residential").paint!["line-color"]).toBe("#FFFFFF");
    expect(layer("suburb-labels").paint!["text-color"]).toBe("#6E8FA6");
    expect(layer("road-label-primary").paint!["text-color"]).toBe("#3A3F44");
  });

  it.each([
    ["motorway", 10],
    ["trunk", 10],
    ["primary", 11],
    ["secondary", 12.5],
    ["tertiary", 13.5],
    ["residential", 14.5],
    ["service", 16],
  ] as [RoadClass, number][])("%s street names appear from zoom %s", (cls, zoom) => {
    expect(LABEL_MIN_ZOOM[cls]).toBe(zoom);
    expect(layer(`road-label-${cls}`).minzoom).toBe(zoom);
  });

  it("labels follow the road, repeat every 250px, never overlap, and the bigger road wins", () => {
    const primary = layer("road-label-primary").layout!;
    const residential = layer("road-label-residential").layout!;
    expect(primary["symbol-placement"]).toBe("line");
    expect(primary["symbol-spacing"]).toBe(LABEL_SPACING_PX);
    expect(LABEL_SPACING_PX).toBe(250);
    expect(primary["text-allow-overlap"]).toBe(false);
    expect(primary["symbol-sort-key"] as number).toBeLessThan(residential["symbol-sort-key"] as number);
  });

  it("road lines are drawn from zoom 9 up", () => {
    for (const l of light.layers.filter((x) => x.id.startsWith("road-") && x.type === "line")) {
      expect(l.minzoom).toBe(ROAD_LINE_MIN_ZOOM);
    }
    expect(ROAD_LINE_MIN_ZOOM).toBe(9);
  });

  it("road widths: motorway 7->18, primary 6->14, secondary 5->12, residential 3->9, service 2->6 (z14->z18)", () => {
    const at = (cls: RoadClass) => {
      const e = roadWidthExpression(cls) as number[];
      return [e[6], e[8]]; // values at z14 and z18
    };
    expect(at("motorway")).toEqual([7, 18]);
    expect(at("primary")).toEqual([6, 14]);
    expect(at("secondary")).toEqual([5, 12]);
    expect(at("residential")).toEqual([3, 9]);
    expect(at("service")).toEqual([2, 6]);
    // Casing is 2px wider than the road it outlines.
    expect((layer("road-casing-primary").paint!["line-width"] as number[])[6]).toBe(8);
  });

  it("motorways draw over the streets they cross", () => {
    const ids = light.layers.map((l) => l.id);
    expect(ids.indexOf("road-motorway")).toBeGreaterThan(ids.indexOf("road-residential"));
  });

  it("highway shields show the first route number in yellow on the green plate", () => {
    const shields = layer("road-shields");
    expect(shields.layout!["icon-image"]).toBe("tl-shield");
    expect(shields.paint!["text-color"]).toBe("#FFD400");
  });

  it("satellite style draws imagery under the labels; every theme builds", () => {
    const sat = buildStyle(SATELLITE_LABEL_PALETTE, { satellite: true }) as { layers: Layer[]; sources: Record<string, unknown> };
    expect(sat.layers[0].type).toBe("raster");
    expect(sat.sources.satellite).toBeDefined();
    for (const palette of Object.values(THEME_PALETTES)) {
      expect((buildStyle(palette) as { version: number }).version).toBe(8);
    }
  });
});

describe("route drawing", () => {
  const route = Array.from({ length: 11 }, (_, i) => ({ latitude: -33.87, longitude: 151.2 + i * 0.001 }));

  it("splits the route at the car: driven part behind, the rest ahead", () => {
    const car = { latitude: -33.87, longitude: 151.2042 };
    const { travelled, ahead } = splitRouteAt(route, car);
    expect(travelled[travelled.length - 1]).toEqual(car);
    expect(ahead[0]).toEqual(car);
    expect(travelled.length + ahead.length).toBe(route.length + 2);
  });

  it("with no position yet, the whole route is ahead", () => {
    expect(splitRouteAt(route, null)).toEqual({ travelled: [], ahead: route });
  });

  it("the turn arrow covers a short stretch either side of the turn", () => {
    const arrow = turnArrowAt(route, route[5], 150, 150);
    expect(arrow.length).toBeGreaterThanOrEqual(3);
    expect(arrow).toContainEqual(route[5]);
    expect(arrow.length).toBeLessThan(route.length);
  });

  it("never sends Mapbox a line with fewer than two points", () => {
    expect(isDrawableLine([])).toBe(false);
    expect(isDrawableLine([route[0]])).toBe(false);
    expect(isDrawableLine(route.slice(0, 2))).toBe(true);
    expect(lineFeature("r", route.slice(0, 2)).geometry.coordinates).toEqual([
      [151.2, -33.87],
      [151.201, -33.87],
    ]);
  });
});

describe("camera", () => {
  it("keeps the screen's tuned zoom levels looking the same (Mapbox = Google - 1)", () => {
    expect(mapboxZoomFromGoogle(17)).toBe(16);
    expect(googleZoomFromMapbox(16)).toBe(17);
    expect(cameraStopFrom({ zoom: 18.5, pitch: 60, heading: 370 }, 600)).toEqual({
      zoomLevel: 17.5,
      pitch: 60,
      heading: 10,
      animationDuration: 600,
      animationMode: "easeTo",
    });
    expect(cameraStopFrom({ heading: -90 }, 0).animationMode).toBe("none");
  });

  it("turns visible bounds into the region the screen works with", () => {
    const r = regionFromBounds([151.22, -33.86], [151.2, -33.88]);
    expect(r.latitude).toBeCloseTo(-33.87);
    expect(r.longitude).toBeCloseTo(151.21);
    expect(r.latitudeDelta).toBeCloseTo(0.02);
    expect(r.longitudeDelta).toBeCloseTo(0.02);
  });

  it("fits a set of points", () => {
    expect(boundsOfPoints([])).toBeNull();
    expect(boundsOfPoints([{ latitude: -33.9, longitude: 151.1 }, { latitude: -33.8, longitude: 151.3 }])).toEqual({
      ne: [151.3, -33.8],
      sw: [151.1, -33.9],
    });
  });

  it("an accuracy circle keeps its size in metres at every zoom", () => {
    const e = metersRadiusExpression(20, -33.87) as number[];
    expect(e[4]).toBeCloseTo(20 / metersPerPoint(0, -33.87));
    expect(e[6] / e[4]).toBeCloseTo(2 ** 22); // doubles every zoom level
  });
});

describe("re-centre state", () => {
  it("a drag is reported once when it starts and makes the next rest a gesture", () => {
    const t = new GestureTracker();
    expect(t.cameraChanged(true)).toBe(true);
    expect(t.cameraChanged(true)).toBe(false);
    expect(t.cameraChanged(false)).toBe(false);
    expect(t.idle()).toBe(true);
    expect(t.idle()).toBe(false);
  });

  it("the app's own camera moves never count as the driver moving the map", () => {
    const t = new GestureTracker();
    for (let i = 0; i < 20; i++) expect(t.cameraChanged(false)).toBe(false);
    expect(t.idle()).toBe(false);
  });
});

describe("auto-zoom by speed and near turns", () => {
  it("zooms out with speed, in near a turn, furthest on a long fast straight", () => {
    expect(computeAutoZoom({ speedKmh: 10, distanceToNextManeuverMeters: 1000 })).toBe(17.5);
    expect(computeAutoZoom({ speedKmh: 60, distanceToNextManeuverMeters: 1000 })).toBe(16);
    expect(computeAutoZoom({ speedKmh: 90, distanceToNextManeuverMeters: 200 })).toBe(17.5);
    expect(computeAutoZoom({ speedKmh: 100, distanceToNextManeuverMeters: 5000 })).toBe(14);
  });
  it("ignores changes under 0.2 of a zoom level", () => {
    expect(shouldAnimateZoomChange(16, 16.1)).toBe(false);
    expect(shouldAnimateZoomChange(16, 16.2)).toBe(true);
  });
});

describe("pin clustering", () => {
  const near = (i: number) => ({ id: `p${i}`, at: { latitude: -33.87 + i * 0.00001, longitude: 151.2 } });

  it("pins in the same cell become one counted cluster; far ones stay single", () => {
    const items = [near(1), near(2), near(3), { id: "far", at: { latitude: -33.5, longitude: 151.5 } }];
    const pins = clusteredPins("fuel", items, (x) => x.at, 0.01, (x) => ({ id: x.id, coordinate: x.at, icon: "fuel" }));
    expect(pins).toHaveLength(2);
    const cluster = pins.find((p) => p.icon === "fuel-cluster")!;
    expect(cluster.label).toBe("3");
    expect(pins.find((p) => p.id === "far")!.icon).toBe("fuel");
  });

  it("groups are stable: the same points always give the same groups", () => {
    const items = [near(3), near(1), near(2)];
    expect(groupByCell(items, (x) => x.at, 0.01)).toEqual(groupByCell([...items].reverse(), (x) => x.at, 0.01).map((g) => ({ ...g, members: [...g.members].reverse() })));
  });

  it("pins become one GeoJSON layer with their icon, size and order", () => {
    const pins: MapPin[] = [
      { id: "a", coordinate: { latitude: 1, longitude: 2 }, icon: "alert:POLICE", size: 1.2, priority: 30, anchor: "bottom" },
      { id: "b", coordinate: { latitude: 3, longitude: 4 }, icon: "fuel" },
    ];
    const fc = pinsToFeatures(pins);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].properties).toMatchObject({ id: "a", icon: "alert:POLICE", size: 1.2, priority: 30, anchor: "bottom" });
    expect(fc.features[1].geometry.coordinates).toEqual([4, 3]);
    expect(iconsUsed([...pins, pins[1]])).toEqual(["alert:POLICE", "fuel"]);
  });
});

describe("simulate drive", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { routeToReplayPoints } = require("../src/dev/simulateDrive") as typeof import("../src/dev/simulateDrive");
  // ~1 km straight east.
  const line = [
    { latitude: -33.87, longitude: 151.2 },
    { latitude: -33.87, longitude: 151.21082 },
  ];

  it("drives the route at the set speed: one fix a second, ~14 m apart at 50 km/h", () => {
    const pts = routeToReplayPoints(line, 50);
    expect(pts[0]).toMatchObject(line[0]);
    expect(pts[pts.length - 1]).toMatchObject(line[1]);
    expect(pts[1].elapsedMs - pts[0].elapsedMs).toBe(1000);
    // 1000 m at 13.9 m/s is ~72 ticks.
    expect(pts.length).toBeGreaterThan(70);
    expect(pts.length).toBeLessThan(76);
  });

  it("an empty route simulates nothing", () => {
    expect(routeToReplayPoints([], 50)).toEqual([]);
  });
});
