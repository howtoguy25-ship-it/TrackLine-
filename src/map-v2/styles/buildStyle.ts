// TrackLine's own Mapbox map style, built from rules rather than hand-written JSON: the road
// widths, which streets get a name at which zoom, the colours. One function turns a palette
// into a full Mapbox Style Specification document over Mapbox Streets v8 vector tiles.
//
// The three shipped files (trackline-light.json, trackline-dark.json,
// trackline-satellite-streets.json) are written from this by `npx tsx scripts/build-map-styles.ts`,
// and a test checks they're up to date. The other colour themes in Settings are built at runtime
// with the same function. No React Native imports -- unit-tested directly.

import { BADGE_LAYER_IDS, BADGE_MIN_ZOOM, BADGE_PADDING_PX, EARLY_MIN_ZOOM, badgeFilter, badgeIconExpression, isBadgeFeature } from "../../map/poiBadges";
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
  // Main roads clearly thicker than streets, Waze-style.
  motorway: { z14: 9, z18: 22 },
  trunk: { z14: 8.5, z18: 21 },
  primary: { z14: 7, z18: 17 },
  secondary: { z14: 5.5, z18: 13 },
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
/**
 * Raised buildings (only when the driver turns 3D buildings on), permanent fix §6: 40% of their
 * real height (capped at 40 m), a soft colour for the theme (light grey / slate, never white towers
 * on a dark map), fading in from z16, and more see-through while a route is drawn so the line
 * always reads. Labels stay on top (the layer goes under the road labels).
 */
export const BUILDING_EXTRUSION_STYLE = {
  color: { light: "#DCDFE4", dark: "#3A4558" },
  opacity: 0.45,
  opacityNearRoute: 0.28,
  heightScale: 0.4,
  maxHeightM: 40,
  fadeInFromZoom: 16,
  fullFromZoom: 17,
} as const;

/** The extrusion paint for a theme, and whether a route is on the map. */
export function buildingExtrusionPaint(dark: boolean, routeShown: boolean) {
  const s = BUILDING_EXTRUSION_STYLE;
  const opacity = routeShown ? s.opacityNearRoute : s.opacity;
  return {
    fillExtrusionColor: dark ? s.color.dark : s.color.light,
    fillExtrusionOpacity: ["interpolate", ["linear"], ["zoom"], s.fadeInFromZoom, 0, s.fullFromZoom, opacity],
    fillExtrusionHeight: ["min", ["*", ["get", "height"], s.heightScale], s.maxHeightM],
    fillExtrusionBase: ["min", ["*", ["get", "min_height"], s.heightScale], s.maxHeightM],
  };
}

// Mapbox-hosted fonts. Rubik isn't on Mapbox's glyph server (uploading it needs a Mapbox
// Studio account step), so labels use the closest geometric sans Mapbox hosts, with a
// wide-coverage fallback for non-Latin names.
export const LABEL_FONT = ["DIN Pro Medium", "Arial Unicode MS Regular"];
export const LABEL_FONT_BOLD = ["DIN Pro Bold", "Arial Unicode MS Bold"];

/** Bumped whenever the style's rules change (shown in Settings > About). */
export const STYLE_VERSION = 6;

/** Australian suburb names with postcodes (ABS data) are drawn from this zoom up to 16. */
export const AU_SUBURB_MIN_ZOOM = 11;
export const AU_SUBURB_LAYER_ID = "au-suburb-labels";

/** The Australian suburb layer's look: the same as every other suburb label. */
export function auSuburbLabelStyle(palette: StylePalette) {
  return {
    textField: ["case", ["has", "postcode"], ["concat", ["get", "name"], " ", ["get", "postcode"]], ["get", "name"]],
    // Mixed case, semi-bold (map polish §1): "Punchbowl 2196", not "PUNCHBOWL 2196".
    textFont: LABEL_FONT_BOLD,
    textSize: ["interpolate", ["linear"], ["zoom"], 11, 14, 13, 18, 16, 20],
    textTransform: "none" as const,
    textLetterSpacing: 0.02,
    textMaxWidth: 9,
    textColor: palette.suburbLabel,
    textHaloColor: palette.labelHalo,
    textHaloWidth: 2,
    textAllowOverlap: false,
  };
}

/**
 * Every label is the place's own name in the local language and script (Mapbox Streets `name`):
 * Arabic in Riyadh and Beirut, Japanese in Tokyo, Cyrillic in Moscow -- like the road signs.
 * English only where a feature has no local name. No rule anywhere is tied to one country.
 */
export const LOCAL_NAME = ["coalesce", ["get", "name"], ["get", "name_en"]];

/** Settings > Map appearance > Map labels. */
export type LabelLanguage = "local" | "app" | "both";

/** The languages Mapbox Streets v8 carries name_* fields for. */
export const MAPBOX_NAME_LANGUAGES = ["ar", "en", "es", "fr", "de", "it", "pt", "ru", "zh-Hans", "zh-Hant", "ja", "ko", "vi"] as const;

/** "en-AU" -> "name_en", "zh-TW" -> "name_zh-Hant", "zh-CN" -> "name_zh-Hans"; null if Mapbox has no field. */
export function mapboxNameField(locale: string | null | undefined): string | null {
  if (!locale) return null;
  const [lang, ...rest] = locale.replace("_", "-").split("-");
  const l = lang.toLowerCase();
  if (l === "zh") {
    const r = rest.join("-").toLowerCase();
    return /hant|tw|hk|mo/.test(r) ? "name_zh-Hant" : "name_zh-Hans";
  }
  return (MAPBOX_NAME_LANGUAGES as readonly string[]).includes(l) ? `name_${l}` : null;
}

/**
 * A label's text for the chosen mode. "app": the name in the app's language where the tiles have
 * it, else the local name. "both": the local name, with the app-language name smaller underneath
 * only where it's different. "local" (default): the local name.
 */
export function labelText(mode: LabelLanguage = "local", appField: string | null = null): unknown {
  if (mode === "local" || !appField) return LOCAL_NAME;
  if (mode === "app") return ["coalesce", ["get", appField], ["get", "name"]];
  return [
    "case",
    ["all", ["has", appField], ["has", "name"], ["!=", ["get", appField], ["get", "name"]]],
    ["format", ["get", "name"], {}, "\n", {}, ["get", appField], { "font-scale": 0.8 }],
    LOCAL_NAME,
  ];
}

/** Prefix of the runtime plate images the highway shields are drawn on (TrackLineMap adds them). */
export const SHIELD_IMAGE = "tl-shield";

/** The plate colours TrackLineMap draws (`tl-shield-<colour>`). */
export const SHIELD_PLATES = ["green", "blue", "white", "red", "yellow", "orange", "brown"] as const;
export type ShieldPlate = (typeof SHIELD_PLATES)[number];

export const SHIELD_PLATE_COLOURS: Record<ShieldPlate, string> = {
  green: "#1F8A3B",
  blue: "#1E4FA3",
  white: "#FFFFFF",
  red: "#C8102E",
  yellow: "#FFD400",
  orange: "#E87722",
  brown: "#7A4A21",
};

/**
 * Which plate a road's route number goes on, from the tiles' own `shield` value (Mapbox Streets
 * v8 gives each road the shield style used where it is). The data decides -- US Interstates blue,
 * German motorways blue, Swiss red, Australian national highways green -- and anything unknown a
 * plain white plate, never one country's look applied to another.
 */
export const SHIELD_PLATE_FOR: Record<string, ShieldPlate> = {
  // Only values documented for Mapbox Streets v8 (docs.mapbox.com > mapbox-streets-v8 > road >
  // shield; "No further shield values will be added in v8"). Anything else, and every
  // country-specific value whose real plate colour isn't certain, gets the neutral white plate
  // with the tiles' own text colour.
  "rectangle-white": "white",
  "rectangle-red": "red",
  "rectangle-orange": "orange",
  "rectangle-yellow": "yellow",
  "rectangle-green": "green",
  "rectangle-blue": "blue",
  "circle-white": "white",
  "au-national-highway": "green",
  // Australia's alphanumeric routes (M1, A6, B83) are signed on green plates.
  "au-national-route": "green",
  "au-state": "green",
  "au-tourist": "brown",
  "nz-state": "red",
  "us-interstate": "blue",
  "us-interstate-duplex": "blue",
  "us-interstate-truck": "blue",
  "us-interstate-business": "green",
  "us-highway": "white",
  "us-highway-duplex": "white",
  "us-highway-alternate": "white",
  "us-highway-bypass": "white",
  "us-highway-truck": "white",
  "us-highway-business": "green",
  "de-motorway": "blue",
  "hu-motorway": "blue",
  "ch-motorway": "red",
  "gr-motorway": "green",
  "hr-motorway": "green",
  "si-motorway": "green",
  "cn-nths-expy": "green",
  "mx-federal": "white",
  "mx-state": "white",
};

/** Default text colour on each plate when the tiles don't give one. */
const PLATE_TEXT: Record<ShieldPlate, string> = {
  green: "#FFFFFF",
  blue: "#FFFFFF",
  white: "#1A1A1A",
  red: "#FFFFFF",
  yellow: "#1A1A1A",
  orange: "#1A1A1A",
  brown: "#FFFFFF",
};

/** Mapbox Streets v8 `shield_text_color` values -> the colours drawn. */
export const SHIELD_TEXT_COLOURS: Record<string, string> = {
  // The documented shield_text_color values.
  black: "#1A1A1A",
  white: "#FFFFFF",
  yellow: "#FFD400",
  orange: "#E87722",
  blue: "#1E4FA3",
};

function plateExpression(): unknown[] {
  const pairs = Object.entries(SHIELD_PLATE_FOR).flatMap(([shield, plate]) => [shield, `${SHIELD_IMAGE}-${plate}`]);
  return ["match", ["get", "shield"], ...pairs, `${SHIELD_IMAGE}-white`];
}

function shieldTextExpression(): unknown[] {
  const byPlate = ["match", ["get", "shield"], ...Object.entries(SHIELD_PLATE_FOR).flatMap(([shield, plate]) => [shield, PLATE_TEXT[plate]]), PLATE_TEXT.white];
  // The tile's own text colour when it gives one, else the plate's. (Root cause of a rejected
  // style: this used to fall back to the string "none" inside a colour expression, which Mapbox
  // can't parse as a colour, so the whole road-shields layer -- or in GL JS the whole style -- failed.)
  const fromData = ["match", ["get", "shield_text_color"], ...Object.entries(SHIELD_TEXT_COLOURS).flat(), byPlate];
  // Australia's green route plates (M5, M8, A1, A3) always carry bold yellow numbers.
  const australian = ["match", ["get", "shield"], ...AU_YELLOW_TEXT_SHIELDS.flatMap((v) => [v, true]), false];
  return ["case", australian, AU_SHIELD_TEXT, fromData];
}

/** Australia's green-plate shields: yellow route numbers (map polish §1). */
export const AU_YELLOW_TEXT_SHIELDS = ["au-national-highway", "au-national-route", "au-state"];
export const AU_SHIELD_TEXT = "#FFD400";

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
  // Near-white land, light grey roads with crisp white casing, darker grey motorways, bright
  // clear water, soft green parks (map polish §1).
  land: "#FAFAF9",
  park: "#D3F0CC",
  water: "#9EDBFA",
  // Very light, flat buildings so the roads read first.
  building: "#F0F1F3",
  road: "#DDE1E6",
  roadCasing: "#FFFFFF",
  motorway: "#B4BBC4",
  suburbLabel: "#4F6F8A",
  streetLabel: "#3A3F44",
  labelHalo: "#FFFFFF",
  shieldText: "#FFD400",
};

export const DARK_PALETTE: StylePalette = {
  name: "TrackLine Dark",
  // Dark slate background, readable navy-grey roads, bright labels: clear, not murky.
  land: "#1B2230",
  park: "#1E3229",
  water: "#12304F",
  building: "#232B39",
  road: "#3F4D66",
  roadCasing: "#121722",
  motorway: "#566683",
  suburbLabel: "#A9C6DC",
  streetLabel: "#EEF1F4",
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
  /** Label language (default: local names). */
  labels?: { mode: LabelLanguage; field: string | null };
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

// Bigger street names than before (Waze-style): readable at a glance while driving.
const LABEL_SIZES: Record<RoadClass, [number, number]> = {
  // Street names a touch larger than before, so they read first along the road (map polish §1).
  motorway: [14, 19],
  trunk: [14, 19],
  primary: [13.5, 18],
  secondary: [13, 17],
  tertiary: [12.5, 16],
  residential: [12.5, 16],
  service: [11, 13.5],
};
/** Main roads' names in bold. */
const BOLD_LABEL_CLASSES: RoadClass[] = ["motorway", "trunk", "primary", "secondary", "tertiary"];

/** The street-name layer for one road class. */
export function roadLabelLayer(cls: RoadClass, palette: StylePalette, text: unknown = LOCAL_NAME): Json {
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
      "text-field": text,
      "text-font": BOLD_LABEL_CLASSES.includes(cls) ? LABEL_FONT_BOLD : LABEL_FONT,
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
      "text-halo-width": 2,
    },
  };
}

function shieldLayer(): Json {
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
      "icon-image": plateExpression(),
      "icon-text-fit": "both",
      "icon-text-fit-padding": [3, 6, 3, 6],
      "icon-rotation-alignment": "viewport",
    },
    // The tiles' own shield text colour (yellow on Australia's green, white on blue motorways...).
    paint: { "text-color": shieldTextExpression() },
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
        paint: { "fill-color": p.building, "fill-outline-color": dim(p.building, 0.12), "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.5, 16, 1] },
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
  // Suburb and town names. Below zoom 11 (and outside Australia at every zoom) they're Mapbox's
  // own. From zoom 11 in Australia they come from the official ABS suburb list instead, with the
  // postcode ("PUNCHBOWL 2196") -- TrackLineMap draws that layer (AU_SUBURB_LAYER_ID). No other
  // country has an official source wired, so no postcode is shown anywhere else.
  const suburbLayout = {
    "text-field": labelText(options.labels?.mode, options.labels?.field ?? null),
    "text-font": LABEL_FONT_BOLD,
    "text-size": ["interpolate", ["linear"], ["zoom"], 9, 13, 13, 18, 16, 20],
    "text-transform": "none",
    "text-letter-spacing": 0.02,
    "text-max-width": 8,
    "symbol-sort-key": ["get", "symbolrank"],
  };
  const suburbPaint = { "text-color": p.suburbLabel, "text-halo-color": p.labelHalo, "text-halo-width": 2 };
  const settlement = ["match", ["get", "class"], ["settlement", "settlement_subdivision"], true, false];
  layers.push({
    id: "suburb-labels",
    type: "symbol",
    source: "composite",
    "source-layer": "place_label",
    filter: settlement,
    minzoom: 9,
    maxzoom: AU_SUBURB_MIN_ZOOM,
    layout: suburbLayout,
    paint: suburbPaint,
  });
  layers.push({
    id: "suburb-labels-intl",
    type: "symbol",
    source: "composite",
    "source-layer": "place_label",
    filter: ["all", settlement, ["!=", ["get", "iso_3166_1"], "AU"]],
    minzoom: AU_SUBURB_MIN_ZOOM,
    maxzoom: 16,
    layout: suburbLayout,
    paint: suburbPaint,
  });
  for (const cls of [...ROAD_DRAW_ORDER].reverse()) layers.push(roadLabelLayer(cls, p, labelText(options.labels?.mode, options.labels?.field ?? null)));
  layers.push(shieldLayer());
  // Places of interest: small, from close zoom only. Tapping one opens its details
  // (TrackLineMap reads these features at the tap point).
  layers.push({
    id: "poi-labels",
    type: "symbol",
    source: "composite",
    "source-layer": "poi_label",
    minzoom: 15.5,
    // Places that get a brand badge (below) aren't labelled twice.
    filter: ["all", ["<=", ["get", "filterrank"], 2], ["!", isBadgeFeature()]],
    layout: {
      "text-field": labelText(options.labels?.mode, options.labels?.field ?? null),
      "text-font": LABEL_FONT,
      "text-size": 11,
      "text-max-width": 8,
      "symbol-sort-key": 10,
    },
    paint: { "text-color": dim(p.streetLabel, 0.25), "text-halo-color": p.labelHalo, "text-halo-width": 1.2 },
  });

  // Brand & popular places (map/poiBadges.ts): fuel and hospitals from z13, the rest from z15.
  // Drawn after the plain labels so they win placement; most prominent first.
  for (const early of [true, false]) {
    layers.push({
      id: early ? BADGE_LAYER_IDS[0] : BADGE_LAYER_IDS[1],
      type: "symbol",
      source: "composite",
      "source-layer": "poi_label",
      minzoom: early ? EARLY_MIN_ZOOM : BADGE_MIN_ZOOM,
      filter: badgeFilter(early),
      layout: {
        "icon-image": badgeIconExpression(),
        "icon-anchor": "bottom",
        "icon-padding": BADGE_PADDING_PX,
        "symbol-sort-key": ["get", "filterrank"],
        "text-field": labelText(options.labels?.mode, options.labels?.field ?? null),
        "text-font": LABEL_FONT,
        "text-size": 12,
        "text-max-width": 9,
        "text-anchor": "left",
        "text-offset": [1.3, -1.5],
        // The badge stays even where its name would collide.
        "text-optional": true,
      },
      paint: { "text-color": p.streetLabel, "text-halo-color": p.labelHalo, "text-halo-width": 1.4 },
    });
  }

  const sources: Json = {
    composite: { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" },
  };
  if (options.satellite) sources.satellite = { type: "raster", url: "mapbox://mapbox.satellite", tileSize: 512 };

  return {
    version: 8,
    name: p.name,
    metadata: { "trackline:styleVersion": STYLE_VERSION },
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
