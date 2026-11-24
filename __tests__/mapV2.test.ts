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
  SHIELD_PLATES,
  SHIELD_PLATE_FOR,
  STYLE_VERSION,
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
import { speedZoomFor } from "../src/map/speedZoom";

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

  it("uses the requested colours (map polish §1)", () => {
    expect(layer("land").paint!["background-color"]).toBe("#FAFAF9");
    expect(layer("parks").paint!["fill-color"]).toBe("#D3F0CC");
    // Bright clear water, in the #9EDBFA range.
    expect(layer("water").paint!["fill-color"]).toBe("#9EDBFA");
    // Very light flat buildings, light grey roads with crisp white casing, darker motorways.
    expect(layer("buildings").paint!["fill-color"]).toBe("#F0F1F3");
    expect(layer("road-residential").paint!["line-color"]).toBe("#DDE1E6");
    expect(layer("road-motorway").paint!["line-color"]).toBe("#B4BBC4");
    expect(layer("road-casing-residential").paint!["line-color"]).toBe("#FFFFFF");
    expect(layer("suburb-labels").paint!["text-color"]).toBe("#4F6F8A");
    expect(layer("road-label-primary").paint!["text-color"]).toBe("#3A3F44");
  });

  it("suburbs in mixed case, semi-bold, white halo -- never ALL CAPS", () => {
    for (const id of ["suburb-labels", "suburb-labels-intl"]) {
      expect(layer(id).layout!["text-transform"]).toBe("none");
      expect((layer(id).layout!["text-font"] as string[])[0]).toBe("DIN Pro Bold");
      expect(layer(id).paint!["text-halo-color"]).toBe("#FFFFFF");
    }
    for (const l of light.layers) expect([l.id, l.layout?.["text-transform"] === "uppercase"]).toEqual([l.id, false]);
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

  it("road widths: motorway 9->22, primary 7->17, secondary 5.5->13, residential 3->9, service 2->6 (z14->z18)", () => {
    const at = (cls: RoadClass) => {
      const e = roadWidthExpression(cls) as number[];
      return [e[6], e[8]]; // values at z14 and z18
    };
    expect(at("motorway")).toEqual([9, 22]);
    expect(at("primary")).toEqual([7, 17]);
    expect(at("secondary")).toEqual([5.5, 13]);
    expect(at("residential")).toEqual([3, 9]);
    expect(at("service")).toEqual([2, 6]);
    // Casing is 2px wider than the road it outlines.
    expect((layer("road-casing-primary").paint!["line-width"] as number[])[6]).toBe(9);
  });

  it("motorways draw over the streets they cross", () => {
    const ids = light.layers.map((l) => l.id);
    expect(ids.indexOf("road-motorway")).toBeGreaterThan(ids.indexOf("road-residential"));
  });

  // Evaluates the style's shield expressions for one road, the way Mapbox does.
  const evalMatch = (expr: unknown, props: Record<string, string>): unknown => {
    const e = expr as unknown[];
    if (e[0] === "case") return evalMatch(e[1], props) ? evalMatch(e[2], props) : evalMatch(e[3], props);
    if (e[0] === "!=") return evalMatch(e[1], props) !== e[2];
    if (e[0] !== "match") return expr;
    const value = props[(e[1] as unknown[])[1] as string];
    for (let i = 2; i < e.length - 1; i += 2) if (e[i] === value) return evalMatch(e[i + 1], props);
    return evalMatch(e[e.length - 1], props);
  };

  it("highway shields follow each country's own shield, from the tile data", () => {
    const shields = layer("road-shields");
    const plate = (props: Record<string, string>) => evalMatch(shields.layout!["icon-image"], props);
    const text = (props: Record<string, string>) => evalMatch(shields.paint!["text-color"], props);
    // Australia: national highways and the alphanumeric M/A/B routes on green plates, with the
    // data's yellow text.
    expect(plate({ shield: "au-national-highway" })).toBe("tl-shield-green");
    expect(text({ shield: "au-national-highway", shield_text_color: "yellow" })).toBe("#FFD400");
    // Bold yellow on green for every Australian route plate, whatever the tile data says.
    expect(text({ shield: "au-national-route", shield_text_color: "white" })).toBe("#FFD400");
    expect(plate({ shield: "au-state" })).toBe("tl-shield-green");
    expect(plate({ shield: "au-national-route" })).toBe("tl-shield-green");
    // The generic plates Mapbox uses for alphanumeric routes (M5, A22) follow the data too.
    expect(plate({ shield: "rectangle-green" })).toBe("tl-shield-green");
    // US Interstate blue, US highway white with black text, UK motorway blue, NZ red.
    expect(plate({ shield: "us-interstate" })).toBe("tl-shield-blue");
    expect(plate({ shield: "us-highway" })).toBe("tl-shield-white");
    expect(text({ shield: "us-highway" })).toBe("#1A1A1A");
    expect(plate({ shield: "de-motorway" })).toBe("tl-shield-blue");
    expect(plate({ shield: "nz-state" })).toBe("tl-shield-red");
    // Unknown shield type: a neutral white plate, not another country's colours.
    expect(plate({ shield: "zz-something-new" })).toBe("tl-shield-white");
    expect(text({ shield: "zz-something-new" })).toBe("#1A1A1A");
    // Every plate the style can ask for is one TrackLineMap draws.
    for (const p of Object.values(SHIELD_PLATE_FOR)) expect(SHIELD_PLATES).toContain(p);
  });

  it("labels are in the local language and script, everywhere", () => {
    for (const id of ["suburb-labels", "suburb-labels-intl", "road-label-residential", "road-label-motorway", "poi-labels"]) {
      expect(layer(id).layout!["text-field"]).toEqual(["coalesce", ["get", "name"], ["get", "name_en"]]);
    }
    // The fallback font covers Arabic, CJK and Cyrillic.
    expect(layer("road-label-residential").layout!["text-font"]).toContain("Arial Unicode MS Regular");
    // Main roads' names are bold (with the same wide-coverage fallback).
    expect(layer("road-label-primary").layout!["text-font"]).toContain("Arial Unicode MS Bold");
  });

  it("Map labels: local by default; my app language; both (app language underneath where different)", () => {
     
    const { labelText, mapboxNameField } = require("../src/map-v2/styles/buildStyle");
    expect(mapboxNameField("en-AU")).toBe("name_en");
    expect(mapboxNameField("ar-SA")).toBe("name_ar");
    expect(mapboxNameField("zh-TW")).toBe("name_zh-Hant");
    expect(mapboxNameField("zh-CN")).toBe("name_zh-Hans");
    expect(mapboxNameField("el-GR")).toBeNull(); // no Greek field in Mapbox Streets: local names
    expect(labelText("local", "name_en")).toEqual(["coalesce", ["get", "name"], ["get", "name_en"]]);
    expect(labelText("app", "name_en")).toEqual(["coalesce", ["get", "name_en"], ["get", "name"]]);
    const both = labelText("both", "name_en") as unknown[];
    expect(both[0]).toBe("case");
    expect(JSON.stringify(both[2])).toContain('"format"');
    expect(labelText("app", null)).toEqual(["coalesce", ["get", "name"], ["get", "name_en"]]);
    const built = buildStyle(LIGHT_PALETTE, { labels: { mode: "app", field: "name_ja" } }) as { layers: Layer[] };
    for (const id of ["suburb-labels", "road-label-primary", "poi-labels"]) {
      expect(built.layers.find((l) => l.id === id)!.layout!["text-field"]).toEqual(["coalesce", ["get", "name_ja"], ["get", "name"]]);
    }
  });

  it("no rule is tied to one place: no country, coordinate or region filters in any layer", () => {
    for (const style of [light, buildStyle(DARK_PALETTE) as { layers: Layer[] }]) {
      // The one exception, by design: Australian suburb labels from z11 come from the ABS layer
      // (with postcodes), so Mapbox's own are left out there -- "suburb-labels-intl".
      const text = JSON.stringify(style.layers.filter((l) => l.id !== "suburb-labels-intl"));
      expect(text).not.toMatch(/iso_3166|worldview|"within"|"distance"|\bAU\b|Sydney|NSW/);
    }
    expect((light as unknown as { metadata: Record<string, unknown> }).metadata["trackline:styleVersion"]).toBe(STYLE_VERSION);
  });

  it("Settings > About says which map engine, style version and commit are running", () => {
    const { mapEngineLine } = require("../src/config/mapEngine");
    expect(mapEngineLine(true, "edc9485b22352e1e")).toBe(`Map engine: Mapbox · style v${STYLE_VERSION} · commit edc9485`);
    expect(mapEngineLine(false, undefined)).toBe(`Map engine: none (Mapbox isn't set up in this build) · style v${STYLE_VERSION} · commit unknown`);
  });

  it("satellite style draws imagery under the labels; every theme builds", () => {
    const sat = buildStyle(SATELLITE_LABEL_PALETTE, { satellite: true }) as { layers: Layer[]; sources: Record<string, unknown> };
    // A neutral ground first (no grey flashes while tiles load), then the softened imagery.
    expect(sat.layers[0]).toMatchObject({ id: "satellite-ground", type: "background" });
    expect(sat.layers[1].type).toBe("raster");
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

describe("navigation zoom by speed (the bands MapScreen applies)", () => {
  it("closer in town, further out on the motorway", () => {
    expect(speedZoomFor(10)).toBe(18.5);
    expect(speedZoomFor(40)).toBe(18.5);
    expect(speedZoomFor(41)).toBe(17.5);
    expect(speedZoomFor(80)).toBe(17.5);
    expect(speedZoomFor(110)).toBe(16.5);
  });
  it("no speed yet (or a bad reading) is treated as stopped", () => {
    expect(speedZoomFor(null)).toBe(18.5);
    expect(speedZoomFor(NaN)).toBe(18.5);
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

describe("Waze-style look (Pass 3 §4)", () => {
  it("dark style: navy-grey roads on a dark background", () => {
     
    const { DARK_PALETTE } = require("../src/map-v2/styles/buildStyle");
    expect(DARK_PALETTE.road).toBe("#3F4D66");
    expect(DARK_PALETTE.land).toBe("#1B2230");
    expect(DARK_PALETTE.streetLabel).toBe("#EEF1F4");
  });
  it("3D buildings: off by default; when on, low and see-through", () => {
     
    const { BUILDING_EXTRUSION_STYLE } = require("../src/map-v2/styles/buildStyle");
     
    expect(require("../src/services/settings").DEFAULT_SETTINGS.show3DBuildings).toBe(false);
    expect(BUILDING_EXTRUSION_STYLE.opacity).toBeLessThanOrEqual(0.5);
    expect(BUILDING_EXTRUSION_STYLE.maxHeightM).toBeLessThanOrEqual(40);
    // Permanent fix §6: ~40% height, fade in from z16, more see-through with a route, theme colours.
    expect(BUILDING_EXTRUSION_STYLE.heightScale).toBeLessThanOrEqual(0.4);
    const { buildingExtrusionPaint } = require("../src/map-v2/styles/buildStyle");
    const light = buildingExtrusionPaint(false, false);
    const dark = buildingExtrusionPaint(true, true);
    expect(light.fillExtrusionOpacity).toEqual(["interpolate", ["linear"], ["zoom"], 16, 0, 17, 0.45]);
    expect(dark.fillExtrusionOpacity[6]).toBeLessThan(light.fillExtrusionOpacity[6]);
    expect(light.fillExtrusionColor).not.toBe(dark.fillExtrusionColor);
    // No white towers on the dark map: the dark colour is darker than mid-grey.
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) * 0.299 + parseInt(hex.slice(3, 5), 16) * 0.587 + parseInt(hex.slice(5, 7), 16) * 0.114;
    expect(lum(dark.fillExtrusionColor)).toBeLessThan(128);
    expect(lum(light.fillExtrusionColor)).toBeGreaterThan(200);
    const src = require("fs").readFileSync("src/map-v2/TrackLineMap.tsx", "utf8");
    expect(src).toMatch(/belowLayerID="road-label-service"\s+filter=\{\["==", \["get", "extrude"\], "true"\]\}\s+minZoomLevel=\{16\}/);
  });
});
