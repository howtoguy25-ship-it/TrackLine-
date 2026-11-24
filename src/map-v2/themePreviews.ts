// The theme picker's previews: each style drawn with real Mapbox tiles over Sydney CBD at z14, with
// a route in that theme's route colours (scripts/build-theme-previews.ts renders them from
// buildStyle). Not colour swatches.
import type { ThemeKey } from "./styles/buildStyle";

export const THEME_PREVIEW_IMAGES: Record<ThemeKey | "satellite", number> = {
  normal: require("../../assets/map/theme-previews/normal.jpg"),
  light: require("../../assets/map/theme-previews/light.jpg"),
  dark: require("../../assets/map/theme-previews/dark.jpg"),
  purpleBlue: require("../../assets/map/theme-previews/purpleBlue.jpg"),
  blueGrey: require("../../assets/map/theme-previews/blueGrey.jpg"),
  greenYellow: require("../../assets/map/theme-previews/greenYellow.jpg"),
  blue: require("../../assets/map/theme-previews/blue.jpg"),
  satellite: require("../../assets/map/theme-previews/satellite.jpg"),
};
