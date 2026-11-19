import { useContext } from "react";
import { useSettings } from "@/context/SettingsContext";
import { SurfaceSchemeContext } from "@/components/ui/surfaceScheme";
import type { Scheme } from "@/theme/colors";

/**
 * Light or dark for things drawn on the map. Dark follows the map's own Dark theme, so floating
 * buttons always sit right on the map under them; every other theme is light.
 */
export function schemeForMapTheme(mapTheme: string): Scheme {
  return mapTheme === "dark" ? "dark" : "light";
}

/** The map's scheme: floating map buttons, and the sheets that sit on the map. */
export function useMapScheme(): Scheme {
  const { settings } = useSettings();
  return schemeForMapTheme(settings.mapTheme);
}

/** The scheme of the surface a control is drawn on (light unless inside a dark SurfaceScheme). */
export function useUiScheme(): Scheme {
  return useContext(SurfaceSchemeContext);
}
