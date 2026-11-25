// Map styles add-on: which style the map draws right now, and its route colours. The map theme
// (Settings > Map theme) is the driver's pick; the map dark mode (Off / On / Only at night / Same
// as phone) switches it to TrackLine Dark when it applies. Satellite swaps the base for imagery
// with our roads and labels on top. Pure; tested in __tests__/map/mapAppearance.test.ts.
import { SATELLITE_LABEL_PALETTE, THEME_PALETTES, type StylePalette, type ThemeKey } from "./buildStyle";

export type MapDarkMode = "off" | "on" | "night" | "system";
export const MAP_DARK_MODE_LABELS: Record<MapDarkMode, string> = {
  off: "Off",
  on: "On",
  night: "Only at night",
  system: "Same as phone",
};

export function effectiveMapTheme(theme: ThemeKey, mode: MapDarkMode | undefined, ctx: { systemDark: boolean; night: boolean }): ThemeKey {
  switch (mode) {
    case "on":
      return "dark";
    case "night":
      return ctx.night ? "dark" : theme;
    case "system":
      return ctx.systemDark ? "dark" : theme;
    default:
      return theme;
  }
}

export function stylePaletteFor(theme: ThemeKey, satellite: boolean): StylePalette {
  return satellite ? SATELLITE_LABEL_PALETTE : (THEME_PALETTES[theme] ?? THEME_PALETTES.light);
}

export function routeColoursFor(theme: ThemeKey, satellite: boolean): { route: string; routeCasing: string; routeAlt: string } {
  const p = stylePaletteFor(theme, satellite);
  return { route: p.route, routeCasing: p.routeCasing, routeAlt: p.routeAlt };
}
