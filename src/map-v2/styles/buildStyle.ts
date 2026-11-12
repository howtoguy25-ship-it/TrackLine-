// TrackLine's own Mapbox map style, built from rules rather than hand-written JSON: the road
// widths, which streets get a name at which zoom, the colours. One function turns a palette
// into a full Mapbox Style Specification document over Mapbox Streets v8 vector tiles.
//
// The three shipped files (trackline-light.json, trackline-dark.json,
// trackline-satellite-streets.json) are written from this by `npx tsx scripts/build-map-styles.ts`,
// and a test checks they're up to date. The other colour themes in Settings are built at runtime
// with the same function. No React Native imports -- unit-tested directly.

export type RoadClass = "motorway" | "trunk" | "primary" | "secondary" | "tertiary" | "residential" | "service";

/** Mapbox Streets v8 `road` layer `class` values that make up each of our road classes. */
export const ROAD_CLASS_SOURCES: Record<RoadClass, string[]> = {
  motorway: ["motorway", "motorway_link"],
  trunk: ["trunk", "trunk_link"],
  primary: ["primary", "primary_link"],
  secondary: ["secondary", "secondary_link"],
  tertiary: ["tertiary", "tertiary_link"],
  residential: ["street", "street_limited"],
  service: ["service"],
};

/** Drawn bottom to top, so a motorway always sits over the streets it crosses. */
export const ROAD_DRAW_ORDER: RoadClass[] = ["service", "residential", "tertiary", "secondary", "primary", "trunk", "motorway"];

/** Line width in px at zoom 14 and zoom 18 (Mapbox interpolates between and beyond). */
export const ROAD_WIDTHS: Record<RoadClass, { z14: number; z18: number }> = {
  motorway: { z14: 7, z18: 18 },
  trunk: { z14: 7, z18: 18 },
  primary: { z14: 6, z18: 14 },
  secondary: { z14: 5, z18: 12 },
  tertiary: { z14: 4, z18: 10 },
  residential: { z14: 3, z18: 9 },
  service: { z14: 2, z18: 6 },
};

/** The zoom a road class first gets its name drawn. */
export const LABEL_MIN_ZOOM: Record<RoadClass, number> = {
  motorway: 10,
  trunk: 10,
  primary: 11,
  secondary: 12.5,
  tertiary: 13.5,
  residential: 14.5,
  service: 16,
};

/** Road lines are drawn from this zoom up (the tiles decide which roads exist that far out). */
export const ROAD_LINE_MIN_ZOOM = 9;
/** px between repeated labels of one road. */
export const LABEL_SPACING_PX = 250;
/** Lower wins when labels compete for space. */
export const LABEL_PRIORITY: Record<RoadClass, number> = {
  motorway: 1,
  trunk: 2,
  primary: 3,
  secondary: 4,
  tertiary: 5,
  residential: 6,
  service: 7,
};
/** Above this camera pitch the buildings are raised (handled by TrackLineMap, not the style). */
export const BUILDING_EXTRUSION_MIN_PITCH = 30;

// Mapbox-hosted fonts. Rubik isn't on Mapbox's glyph server (uploading it needs a Mapbox
// Studio account step), so labels use the closest geometric sans Mapbox hosts, with a
// wide-coverage fallback for non-Latin names.
export const LABEL_FONT = ["DIN Pro Medium", "Arial Unicode MS Regular"];
export const LABEL_FONT_BOLD = ["DIN Pro Bold", "Arial Unicode MS Bold"];

/** Name of the runtime image the highway shields are drawn on (TrackLineMap adds it). */
export const SHIELD_IMAGE = "tl-shield";

export interface StylePalette {
  name: string;
  land: string;
  park: string;
  water: string;
  building: string;
  road: string;
  roadCasing: string;
  /** Motorways can be tinted apart from other roads. */
  motorway: string;
  suburbLabel: string;
  streetLabel: string;
  labelHalo: string;
  shieldText: string;
}

export const LIGHT_PALETTE: StylePalette = {
  name: "TrackLine Light",
  land: "#F7F8F7",
  park: "#C9EFC9",
  water: "#A9D3F5",
  building: "#E6E8EA",
  road: "#D5D9DD",
  roadCasing: "#FFFFFF",
  motorway: "#D5D9DD",
  suburbLabel: "#6E8FA6",
  streetLabel: "#3A3F44",
  labelHalo: "#FFFFFF",
  shieldText: "#FFD400",
};

export const DARK_PALETTE: StylePalette = {
  name: "TrackLine Dark",
  land: "#1B1F24",
  park: "#1F3324",
  water: "#132B44",
  building: "#2A2F36",
  road: "#3A4049",
  roadCasing: "#14171B",
  motorway: "#4A515C",
  suburbLabel: "#8FAFC6",
  streetLabel: "#D7DBE0",
  labelHalo: "#14171B",
  shieldText: "#FFD400",
};

/** Satellite imagery underneath, with the road names and shields drawn on top of it. */
export const SATELLITE_LABEL_PALETTE: StylePalette = {
  ...LIGHT_PALETTE,
  name: "TrackLine Satellite Streets",
  streetLabel: "#FFFFFF",
  labelHalo: "#1F2125",
  suburbLabel: "#FFFFFF",
};

export interface BuildOptions {
  /** Multiplies every road width (Settings > Road thickness). */
  roadScale?: number;
  /** Satellite imagery as the base, roads drawn as thin overlays. */
  satellite?: boolean;
  /** Fades the base map while routes are being chosen, so the route lines stand out. */
  dimmed?: boolean;
}

type Json = Record<string, unknown>;

function roadFilter(cls: RoadClass): unknown[] {
  return ["match", ["get", "class"], ROAD_CLASS_SOURCES[cls], true, false];
}

/** Width expression for a road class: grows from z9 up to its z14 and z18 sizes. */
export function roadWidthExpression(cls: RoadClass, scale = 1, extra = 0): unknown[] {
  const { z14, z18 } = ROAD_WIDTHS[cls];
  const z9 = Math.max(0.5, z14 * 0.25);
  return [
    "interpolate",
    ["exponential", 1.5],
    ["zoom"],
    ROAD_LINE_MIN_ZOOM,
    round2(z9 * scale + extra),
    14,
    round2(z14 * scale + extra),
    18,
    round2(z18 * scale + extra),
  ];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const LABEL_SIZES: Record<RoadClass, [number, number]> = {
  motorway: [12, 16],
  trunk: [12, 16],
  primary: [12, 15],
  secondary: [11, 14],
  tertiary: [11, 14],
  residential: [11, 13],
  service: [10, 12],
};

/** The street-name layer for one road class. */
export function roadLabelLayer(cls: RoadClass, palette: StylePalette): Json {
  const [small, large] = LABEL_SIZES[cls];
  return {
    id: `road-label-${cls}`,
    type: "symbol",
    source: "composite",
    "source-layer": "road",
    minzoom: LABEL_MIN_ZOOM[cls],
    filter: ["all", roadFilter(cls), ["has", "name"]],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": LABEL_SPACING_PX,
      "symbol-sort-key": LABEL_PRIORITY[cls],
      "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
      "text-font": LABEL_FONT,
      "text-size": ["interpolate", ["linear"], ["zoom"], LABEL_MIN_ZOOM[cls], small, 18, large],
      "text-max-angle": 30,
      "text-padding": 4,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-pitch-alignment": "viewport",
      "text-rotation-alignment": "map",
    },
    paint: {
      "text-color": palette.streetLabel,
      "text-halo-color": palette.labelHalo,
      "text-halo-width": 1.5,
    },
  };
}

function shieldLayer(palette: StylePalette): Json {
  return {
    id: "road-shields",
    type: "symbol",
    source: "composite",
    "source-layer": "road",
    minzoom: 10,
    filter: ["all", ["has", "ref"], ["match", ["get", "class"], [...ROAD_CLASS_SOURCES.motorway, ...ROAD_CLASS_SOURCES.trunk, ...ROAD_CLASS_SOURCES.primary], true, false]],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 400,
      "symbol-sort-key": 0,
      // A road with several route numbers ("A1;M1") shows the first.
      "text-field": [
        "case",
        [">=", ["index-of", ";", ["get", "ref"]], 0],
        ["slice", ["get", "ref"], 0, ["index-of", ";", ["get", "ref"]]],
        ["get", "ref"],
      ],
      "text-font": LABEL_FONT_BOLD,
      "text-size": 12,
      "text-rotation-alignment": "viewport",
      "icon-image": SHIELD_IMAGE,
      "icon-text-fit": "both",
      "icon-text-fit-padding": [3, 6, 3, 6],
      "icon-rotation-alignment": "viewport",
    },
    paint: { "text-color": palette.shieldText },
  };
}

function dim(hex: string, amount: number): string {
  // Blend toward mid-grey, keeping it a plain hex colour.
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (0xb4 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

/** A complete Mapbox style document. */
export function buildStyle(input: StylePalette, options: BuildOptions = {}): Json {
  const roadScale = options.roadScale ?? 1;
  const p: StylePalette = options.dimmed
    ? { ...input, land: dim(input.land, 0.08), park: dim(input.park, 0.25), water: dim(input.water, 0.25), road: dim(input.road, 0.15) }
    : input;
  const layers: Json[] = [];

  if (options.satellite) {
    layers.push({ id: "satellite", type: "raster", source: "satellite" });
  } else {
    layers.push(
      { id: "land", type: "background", paint: { "background-color": p.land } },
      {
        id: "parks",
        type: "fill",
        source: "composite",
        "source-layer": "landuse",
        filter: ["match", ["get", "class"], ["park", "grass", "pitch", "cemetery", "golf_course", "wood", "scrub"], true, false],
        paint: { "fill-color": p.park },
      },
      {
        id: "national-parks",
        type: "fill",
        source: "composite",
        "source-layer": "landuse_overlay",
        filter: ["==", ["get", "class"], "national_park"],
        paint: { "fill-color": p.park, "fill-opacity": 0.6 },
      },
      { id: "water", type: "fill", source: "composite", "source-layer": "water", paint: { "fill-color": p.water } },
      {
        id: "waterways",
        type: "line",
        source: "composite",
        "source-layer": "waterway",
        paint: { "line-color": p.water, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 18, 6] },
      },
      {
        // Flat footprints; TrackLineMap adds a raised version once the camera is tilted.
        id: "buildings",
        type: "fill",
        source: "composite",
        "source-layer": "building",
        minzoom: 14,
        filter: ["==", ["get", "underground"], "false"],
        paint: { "fill-color": p.building, "fill-outline-color": dim(p.building, 0.2) },
      }
    );
  }

  // Casings first (all classes), then fills, so every junction looks continuous.
  for (const cls of ROAD_DRAW_ORDER) {
    layers.push({
      id: `road-casing-${cls}`,
      type: "line",
      source: "composite",
      "source-layer": "road",
      minzoom: ROAD_LINE_MIN_ZOOM,
      filter: roadFilter(cls),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": p.roadCasing,
        "line-width": roadWidthExpression(cls, roadScale, options.satellite ? 0 : 2),
        "line-opacity": options.satellite ? 0 : 1,
      },
    });
  }
  for (const cls of ROAD_DRAW_ORDER) {
    layers.push({
      id: `road-${cls}`,
      type: "line",
      source: "composite",
      "source-layer": "road",
      minzoom: ROAD_LINE_MIN_ZOOM,
      filter: roadFilter(cls),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": cls === "motorway" || cls === "trunk" ? p.motorway : p.road,
        "line-width": roadWidthExpression(cls, options.satellite ? roadScale * 0.4 : roadScale),
        "line-opacity": options.satellite ? 0.55 : 1,
      },
    });
  }

  // Labels: suburbs, then street names (most important first), then shields on top.
  layers.push({
    id: "suburb-labels",
    type: "symbol",
    source: "composite",
    "source-layer": "place_label",
    filter: ["match", ["get", "class"], ["settlement", "settlement_subdivision"], true, false],
    minzoom: 9,
    maxzoom: 16,
    layout: {
      "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
      "text-font": LABEL_FONT,
      "text-size": ["interpolate", ["linear"], ["zoom"], 9, 14, 13, 20, 16, 22],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.06,
      "text-max-width": 8,
      "symbol-sort-key": ["get", "symbolrank"],
    },
    paint: { "text-color": p.suburbLabel, "text-halo-color": p.labelHalo, "text-halo-width": 2 },
  });
  for (const cls of [...ROAD_DRAW_ORDER].reverse()) layers.push(roadLabelLayer(cls, p));
  layers.push(shieldLayer(p));
  // Places of interest: small, from close zoom only. Tapping one opens its details
  // (TrackLineMap reads these features at the tap point).
  layers.push({
    id: "poi-labels",
    type: "symbol",
    source: "composite",
    "source-layer": "poi_label",
    minzoom: 15.5,
    filter: ["<=", ["get", "filterrank"], 2],
    layout: {
      "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
      "text-font": LABEL_FONT,
      "text-size": 11,
      "text-max-width": 8,
      "symbol-sort-key": 10,
    },
    paint: { "text-color": dim(p.streetLabel, 0.25), "text-halo-color": p.labelHalo, "text-halo-width": 1.2 },
  });

  const sources: Json = {
    composite: { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" },
  };
  if (options.satellite) sources.satellite = { type: "raster", url: "mapbox://mapbox.satellite", tileSize: 512 };

  return {
    version: 8,
    name: p.name,
    sources,
    glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
    layers,
  };
}

// ---------------------------------------------------------------------------------------------
// The colour themes in Settings > Map appearance, as palettes over the same rules.

export type ThemeKey = "normal" | "purpleBlue" | "blueGrey" | "greenYellow" | "blue" | "light" | "dark";

export const THEME_PALETTES: Record<ThemeKey, StylePalette> = {
  normal: LIGHT_PALETTE,
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
  purpleBlue: { ...LIGHT_PALETTE, name: "Purple & Blue", land: "#F4F2FA", road: "#D8D3EC", motorway: "#C7BCEB", water: "#9FC6F2", suburbLabel: "#7563A8" },
  blueGrey: { ...LIGHT_PALETTE, name: "Blue & Grey", land: "#EEF1F4", road: "#C9D2DC", motorway: "#B3C3D6", water: "#8FB7E3", suburbLabel: "#5C7690" },
  greenYellow: { ...LIGHT_PALETTE, name: "Green & Yellow", land: "#F4F6EC", park: "#BFE6A8", road: "#E3DFB8", motorway: "#F1D97A", water: "#A6D2E8", suburbLabel: "#6E8A4E" },
  blue: { ...LIGHT_PALETTE, name: "Blue", land: "#EEF5FB", road: "#C5DCF0", motorway: "#9CC4EA", water: "#7FB6EC", suburbLabel: "#3E6E9A" },
};

export const ROAD_SCALES: Record<"thin" | "normal" | "bold" | "extraBold", number> = {
  thin: 0.75,
  normal: 1,
  bold: 1.3,
  extraBold: 1.6,
};
