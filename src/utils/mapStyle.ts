/**
 * TrackLine's map color themes -- standard Google Maps JSON styling format, applied via
 * react-native-maps' `customMapStyle` prop. Each theme recolors the whole map consistently
 * (land, water, roads, highways, labels) rather than just tinting the background, and every
 * one keeps a deliberately high contrast between road surface and label text so street names
 * stay legible glancing at it while driving -- the actual point of a map, regardless of theme.
 *
 * Requires the Google Maps provider (MapScreen.tsx renders with provider={PROVIDER_GOOGLE} on
 * every platform) -- Apple's native MapKit has no equivalent JSON styling mechanism at all, so
 * this prop is a silent no-op there. That used to be iOS's actual renderer, which is exactly
 * why the theme picker looked like it did nothing on iOS -- every theme rendered as Apple's own
 * fixed palette regardless of which one was selected.
 *
 * Real road-level styling, not just color: every theme sets a `weight` styler (line thickness
 * in pixels -- a genuine, documented property of Google's native style JSON, not something
 * invented here) per road class, so local/arterial/highway/freeway are visually distinct in
 * actual thickness, not color alone. Road thickness is now a SEPARATE, user-picked axis from
 * color theme (see RoadThicknessKey/buildMapStyle below) -- per explicit request for a
 * dedicated road-thickness/design picker in Settings, independent of which color theme is
 * active, rather than baking one fixed thickness into each theme.
 */
export type MapThemeKey = "normal" | "purpleBlue" | "blueGrey" | "greenYellow" | "blue" | "light" | "dark";
export type RoadThicknessKey = "thin" | "normal" | "bold" | "extraBold";

export const MAP_THEME_LABELS: Record<MapThemeKey, string> = {
  normal: "Normal",
  purpleBlue: "Purple & Blue",
  blueGrey: "Blue & Grey",
  greenYellow: "Green & Yellow",
  blue: "Blue",
  light: "Light",
  dark: "Dark",
};

export const ROAD_THICKNESS_LABELS: Record<RoadThicknessKey, string> = {
  thin: "Thin",
  normal: "Normal",
  bold: "Bold",
  extraBold: "Extra Bold",
};

// Real multiplier applied to each theme's own base road weights below -- picking a thicker
// preset in Settings scales every road class by the same factor, keeping the local/arterial/
// highway/freeway hierarchy intact (a thin local road never gets thicker than a thin freeway)
// while making the whole network chunkier or finer as a single, predictable choice.
const ROAD_THICKNESS_MULTIPLIERS: Record<RoadThicknessKey, number> = {
  thin: 0.55,
  normal: 1,
  bold: 1.4,
  extraBold: 1.85,
};

// Base weights (pixels, at the "normal" multiplier) per road class -- same real Waze/Google
// Maps-style hierarchy every theme already used: local roads thinnest, arterials a step up,
// named highways thicker again, real freeways (road.highway.controlled_access -- a distinct
// feature type from a plain named "highway" that just happens to be busy) thickest of all.
const BASE_ROAD_WEIGHTS = { local: 2, arterial: 3.5, highway: 5.5, controlledAccess: 7 };

interface ThemeColors {
  background: string;
  labelStroke: string;
  labelFill: string;
  localityLabel: string;
  poiLabel: string;
  parkGeometry: string;
  parkLabel: string;
  roadLocal: string;
  roadStroke: string;
  roadLabel: string;
  roadArterial: string;
  highway: string;
  highwayLabel: string;
  water: string;
  waterLabel: string;
  // Real, explicit request -- Waze's own map renders building footprints as a distinct flat
  // block layer (a real, visible step between the land/background color and the road network),
  // not left the same flat color as the land underneath them. buildingFill sits between
  // `background` and `roadLocal` in each theme below; buildingStroke is a slightly darker/
  // lighter edge so adjacent buildings still read as separate blocks rather than one fused mass.
  buildingFill: string;
  buildingStroke: string;
}

function buildMapStyle(c: ThemeColors, thicknessKey: RoadThicknessKey) {
  const m = ROAD_THICKNESS_MULTIPLIERS[thicknessKey];
  return [
    { elementType: "geometry", stylers: [{ color: c.background }] },
    { elementType: "labels.text.stroke", stylers: [{ color: c.labelStroke }] },
    { elementType: "labels.text.fill", stylers: [{ color: c.labelFill }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: c.localityLabel }] },
    { featureType: "poi", stylers: [{ visibility: "simplified" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: c.poiLabel }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: c.parkGeometry }] },
    { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: c.parkLabel }] },
    // Real, explicit request -- Waze's own map renders building footprints as a distinct flat
    // block layer (visibly different from the bare land underneath), never left the same flat
    // color as the ground. Building NAME labels are turned off -- Waze doesn't label individual
    // buildings either, and a label on every block would be exactly the clutter this app's
    // existing `poi` simplification above is already trying to avoid. Parking lots
    // (landscape.man_made) get the same block treatment, matching how Waze renders those too.
    { featureType: "building", elementType: "geometry.fill", stylers: [{ color: c.buildingFill }] },
    { featureType: "building", elementType: "geometry.stroke", stylers: [{ color: c.buildingStroke }] },
    { featureType: "building", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: c.buildingFill }] },
    { featureType: "road.local", elementType: "geometry", stylers: [{ color: c.roadLocal, weight: BASE_ROAD_WEIGHTS.local * m }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: c.roadLocal, weight: BASE_ROAD_WEIGHTS.local * m }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: c.roadStroke }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: c.roadLabel }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: c.roadArterial, weight: BASE_ROAD_WEIGHTS.arterial * m }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: c.highway, weight: BASE_ROAD_WEIGHTS.highway * m }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: c.roadStroke }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: c.highwayLabel }] },
    { featureType: "road.highway", elementType: "labels.text.stroke", stylers: [{ color: c.roadStroke }] },
    {
      featureType: "road.highway.controlled_access",
      elementType: "geometry",
      stylers: [{ color: c.highway, weight: BASE_ROAD_WEIGHTS.controlledAccess * m }],
    },
    { featureType: "road.highway.controlled_access", elementType: "geometry.stroke", stylers: [{ color: c.roadStroke }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: c.water }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: c.waterLabel }] },
  ];
}

// TrackLine's original brand look -- black background, green highways/text.
const NORMAL_COLORS: ThemeColors = {
  background: "#14201a",
  labelStroke: "#0a120d",
  labelFill: "#a3d6ac",
  localityLabel: "#dcf2e0",
  poiLabel: "#7fa886",
  parkGeometry: "#1c3324",
  parkLabel: "#79a681",
  roadLocal: "#28352c",
  roadStroke: "#0a120d",
  roadLabel: "#9dc4a4",
  roadArterial: "#324a39",
  highway: "#34d976",
  highwayLabel: "#eafff1",
  water: "#0a2318",
  waterLabel: "#5c9c74",
  buildingFill: "#1e2f26",
  buildingStroke: "#0d1712",
};

// Deep indigo/purple land, violet-blue water, bright lavender highways.
const PURPLE_BLUE_COLORS: ThemeColors = {
  background: "#1a1033",
  labelStroke: "#1a1033",
  labelFill: "#c7bdf0",
  localityLabel: "#e4defa",
  poiLabel: "#9c8fd6",
  parkGeometry: "#201545",
  parkLabel: "#a89ae0",
  roadLocal: "#2d2159",
  roadStroke: "#140b29",
  roadLabel: "#b3a6e8",
  roadArterial: "#392c68",
  highway: "#8b7cf6",
  highwayLabel: "#f2eeff",
  water: "#16224a",
  waterLabel: "#7d93d6",
  buildingFill: "#241a46",
  buildingStroke: "#120b29",
};

// Cool slate-grey land, deep blue water, bright sky-blue highways -- a neutral, low-glare
// scheme (closest to a "night driving" feel).
const BLUE_GREY_COLORS: ThemeColors = {
  background: "#232a35",
  labelStroke: "#232a35",
  labelFill: "#b9c4d4",
  localityLabel: "#dde4ee",
  poiLabel: "#8b98aa",
  parkGeometry: "#1c2833",
  parkLabel: "#7f95a6",
  roadLocal: "#3a4451",
  roadStroke: "#171d24",
  roadLabel: "#9fadc0",
  roadArterial: "#48566a",
  highway: "#5b9bf0",
  highwayLabel: "#eaf3ff",
  water: "#16273f",
  waterLabel: "#6f93bf",
  buildingFill: "#2c3542",
  buildingStroke: "#171d24",
};

// Deep forest-green land, teal water, bright gold/yellow highways -- the highest-contrast pair
// (yellow-on-dark-green), reserved for the highway/arterial accent only.
const GREEN_YELLOW_COLORS: ThemeColors = {
  background: "#0f2417",
  labelStroke: "#0f2417",
  labelFill: "#c8e6b0",
  localityLabel: "#eef7de",
  poiLabel: "#8fb877",
  parkGeometry: "#173420",
  parkLabel: "#86b16d",
  roadLocal: "#243c26",
  roadStroke: "#0a1810",
  roadLabel: "#a8cf8f",
  roadArterial: "#33512f",
  highway: "#facc15",
  highwayLabel: "#fffbe6",
  water: "#0a2e2a",
  waterLabel: "#4fa090",
  buildingFill: "#183420",
  buildingStroke: "#09160d",
};

// Real, confirmed request -- a pure, saturated blue theme distinct from Blue & Grey's muted
// slate take: deep navy land/water, vivid electric-blue highways for a bolder, more "GPS
// nav app" look.
const BLUE_COLORS: ThemeColors = {
  background: "#0b1a33",
  labelStroke: "#0b1a33",
  labelFill: "#a9c6f5",
  localityLabel: "#dbe9ff",
  poiLabel: "#7ea3e0",
  parkGeometry: "#0f2445",
  parkLabel: "#82a8dd",
  roadLocal: "#173257",
  roadStroke: "#081326",
  roadLabel: "#a3c2f2",
  roadArterial: "#1e4b8f",
  highway: "#3b9bff",
  highwayLabel: "#eaf4ff",
  water: "#081a3d",
  waterLabel: "#5389d6",
  buildingFill: "#112747",
  buildingStroke: "#060f1f",
};

// Real, confirmed request -- the one genuinely LIGHT theme of the set (every other theme here
// is dark-background-plus-bright-accent). White/light-grey land, pale blue water, a strong
// dark-blue highway accent so the road hierarchy still reads clearly against a light
// background instead of just inverting colors and losing contrast.
//
// Real, confirmed follow-up complaint: roadLocal/roadArterial were only a couple of shades off
// the background itself (#e2e6ec/#c7cfdb against #f5f7fa) -- on an actual phone screen in
// daylight that's nowhere near enough contrast to tell "this is a street" from "this is just
// background", exactly the opposite of what a driving app's own map needs to be legible at a
// glance. Both darkened to a real, clearly-visible slate-blue now, arterial noticeably darker
// than local so the road hierarchy itself is readable too, not just "roads exist". highway now
// matches this app's own current accent blue (#1D4ED8, see theme/tokens.ts) instead of a
// slightly different blue, for one consistent brand color between the map and the rest of the
// UI. Labels darkened to match (they were legible before, just not as sharp as they could be
// against the also-darkened road colors around them).
const LIGHT_COLORS: ThemeColors = {
  background: "#eef1f6",
  labelStroke: "#ffffff",
  labelFill: "#334155",
  // Real, explicit request -- "blue-grey suburb labels" specifically (was a near-black navy,
  // #0f172a, legible but not actually blue-grey). Slate-600 reads as genuinely blue-grey while
  // staying dark enough against the light background to stay legible at a glance.
  localityLabel: "#475569",
  poiLabel: "#64748b",
  parkGeometry: "#cfe8cf",
  parkLabel: "#3f6b3f",
  // Real, explicit request -- "grey roads" (was a visibly blue-tinted slate, #a7b2c4). Neutral
  // grey now, with arterial a step darker for the same local/arterial hierarchy as every other
  // theme, white casing (roadStroke) unchanged -- that part already matched the request.
  roadLocal: "#9aa3ad",
  roadStroke: "#ffffff",
  roadLabel: "#334155",
  roadArterial: "#7b8591",
  highway: "#1d4ed8",
  highwayLabel: "#ffffff",
  water: "#bcd4f0",
  waterLabel: "#2f5a8f",
  buildingFill: "#dde3ec",
  buildingStroke: "#c3cbda",
};

// Real, explicit request -- a genuine Waze-style DARK counterpart to LIGHT_COLORS above, same
// hue families (grey roads, blue-grey suburb labels, green parks, blue water) just inverted for
// a dark background, rather than reusing any of this file's existing dark brand themes (normal/
// purpleBlue/blueGrey/greenYellow/blue), each of which is its own distinct accent color rather
// than this same light theme's own grey/blue-grey/green/blue palette. Casing (roadStroke) is a
// dark near-black here rather than white -- white road casing on an already-dark background
// would read as the brightest thing on screen, the opposite of what a casing/outline is for.
const DARK_COLORS: ThemeColors = {
  background: "#1b1f27",
  labelStroke: "#1b1f27",
  labelFill: "#c7ccd6",
  localityLabel: "#9fb0c7",
  poiLabel: "#7c8699",
  parkGeometry: "#1f3a28",
  parkLabel: "#6fae7e",
  roadLocal: "#454b57",
  roadStroke: "#11141a",
  roadLabel: "#c3c9d4",
  roadArterial: "#5a6272",
  highway: "#3b82f6",
  highwayLabel: "#eef4ff",
  water: "#16324a",
  waterLabel: "#5ea0d6",
  buildingFill: "#262b34",
  buildingStroke: "#15181e",
};

// Real, explicit request: while picking a route, the actual candidate route line(s) should
// stand out clearly from the surrounding street network, not blend into it -- the same
// "everything else recedes" treatment Google/Apple Maps both already do during route selection.
// Applied as extra style RULES appended after buildMapStyle's own explicit per-road-class color
// rules (see buildMapStyle's own comment) rather than touching any theme's actual colors --
// Google's style JSON applies same-selector stylers in array order, so a broad `saturation`/
// `lightness` adjustment on "road" here lands on top of whatever color each theme already set,
// desaturating and lightening every theme consistently without needing a second copy of each
// theme's palette. Labels are deliberately left untouched (street names stay fully legible --
// this is about de-emphasizing road GEOMETRY, not making the map harder to read), and POIs are
// hidden outright -- a dense icon layer competing for attention is exactly the clutter route
// selection is trying to cut through.
const ROUTE_PICKING_DIM_STYLERS = [
  { featureType: "road", elementType: "geometry", stylers: [{ saturation: -75 }, { lightness: 15 }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ saturation: -75 }, { lightness: 15 }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ saturation: -75 }, { lightness: 15 }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ saturation: -75 }, { lightness: 15 }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
];

export function getMapStyle(themeKey: MapThemeKey, thicknessKey: RoadThicknessKey, dimRoads = false) {
  const colors: Record<MapThemeKey, ThemeColors> = {
    normal: NORMAL_COLORS,
    purpleBlue: PURPLE_BLUE_COLORS,
    blueGrey: BLUE_GREY_COLORS,
    greenYellow: GREEN_YELLOW_COLORS,
    blue: BLUE_COLORS,
    light: LIGHT_COLORS,
    dark: DARK_COLORS,
  };
  const base = buildMapStyle(colors[themeKey], thicknessKey);
  return dimRoads ? [...base, ...ROUTE_PICKING_DIM_STYLERS] : base;
}
