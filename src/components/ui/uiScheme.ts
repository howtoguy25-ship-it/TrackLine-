import { useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import { useSettings } from "@/context/SettingsContext";
import { effectiveMapTheme } from "@/map-v2/styles/mapAppearance";
import type { ThemeKey } from "@/map-v2/styles/buildStyle";
import { isNightNow } from "@/map/nightClock";
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
  return schemeForMapTheme(useEffectiveMapTheme());
}

/**
 * The theme the map is drawing right now: the Map theme, or TrackLine Dark when the map dark
 * mode applies (On; Only at night — re-checked every minute; Same as phone).
 */
export function useEffectiveMapTheme(): ThemeKey {
  const { settings } = useSettings();
  const system = useColorScheme();
  const mode = settings.mapDarkMode ?? "off";
  const [night, setNight] = useState(() => isNightNow());
  useEffect(() => {
    if (mode !== "night") return;
    const tick = () => setNight(isNightNow());
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [mode]);
  return effectiveMapTheme(settings.mapTheme as ThemeKey, mode, { systemDark: system === "dark", night });
}

/** The scheme of the surface a control is drawn on (light unless inside a dark SurfaceScheme). */
export function useUiScheme(): Scheme {
  return useContext(SurfaceSchemeContext);
}
