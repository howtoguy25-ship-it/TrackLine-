import { useSettings } from "@/context/SettingsContext";
import type { Scheme } from "@/theme/colors";

/**
 * Light or dark for the controls drawn over the map. Dark follows the map's own Dark theme, so
 * the buttons always sit right on the map under them; every other theme is light.
 */
export function schemeForMapTheme(mapTheme: string): Scheme {
  return mapTheme === "dark" ? "dark" : "light";
}

export function useUiScheme(): Scheme {
  const { settings } = useSettings();
  return schemeForMapTheme(settings.mapTheme);
}
