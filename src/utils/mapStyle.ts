// The map colour themes and road-thickness choices offered in Settings > Map appearance.
// The map itself is drawn by Mapbox from src/map-v2/styles/buildStyle.ts (THEME_PALETTES and
// ROAD_SCALES there use these same keys); this file only names the choices.

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
