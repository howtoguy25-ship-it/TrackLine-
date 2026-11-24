// Map styles add-on §1/§3: the dark map follows Off / On / Only at night / Same as phone; the
// route colours come from the drawn style; the map and its controls switch together.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { effectiveMapTheme, routeColoursFor, stylePaletteFor } from "@/map-v2/styles/mapAppearance";
import { DARK_PALETTE, SATELLITE_LABEL_PALETTE, THEME_PALETTES } from "@/map-v2/styles/buildStyle";
import { isNightNow } from "@/map/nightClock";
import { schemeForMapTheme } from "@/components/ui/uiScheme";

describe("dark map mode", () => {
  const day = { systemDark: false, night: false };
  it("Off keeps the chosen theme; On is always dark", () => {
    expect(effectiveMapTheme("blue", "off", { systemDark: true, night: true })).toBe("blue");
    expect(effectiveMapTheme("blue", "on", day)).toBe("dark");
  });
  it("Only at night: dark after sunset, the chosen theme by day", () => {
    expect(effectiveMapTheme("greenYellow", "night", { ...day, night: true })).toBe("dark");
    expect(effectiveMapTheme("greenYellow", "night", day)).toBe("greenYellow");
  });
  it("Same as phone follows the system appearance", () => {
    expect(effectiveMapTheme("light", "system", { systemDark: true, night: false })).toBe("dark");
    expect(effectiveMapTheme("light", "system", day)).toBe("light");
  });
  it("night is the real sun where you are (Sydney: dark at 23:00, light at 12:00 local)", () => {
    const syd = { latitude: -33.87, longitude: 151.21 };
    expect(isNightNow(new Date("2026-11-24T12:00:00Z"), syd)).toBe(true); // 23:00 AEDT
    expect(isNightNow(new Date("2026-11-24T02:00:00Z"), syd)).toBe(false); // 13:00 AEDT
  });
  it("the buttons and sheets switch with the map", () => {
    expect(schemeForMapTheme(effectiveMapTheme("blue", "on", day))).toBe("dark");
    expect(schemeForMapTheme(effectiveMapTheme("blue", "off", day))).toBe("light");
  });
});

describe("route colours follow the style", () => {
  it("light themes use our purple, dark a brighter one, satellite a vivid one with a white casing", () => {
    expect(routeColoursFor("light", false).route).toBe(THEME_PALETTES.light.route);
    expect(routeColoursFor("dark", false).route).toBe(DARK_PALETTE.route);
    expect(routeColoursFor("dark", true)).toEqual({ route: SATELLITE_LABEL_PALETTE.route, routeCasing: "#FFFFFF", routeAlt: SATELLITE_LABEL_PALETTE.routeAlt });
    expect(stylePaletteFor("blue", true)).toBe(SATELLITE_LABEL_PALETTE);
  });
  it("MapScreen draws with the effective theme and passes its route colours; no 3D over satellite", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/theme=\{mapTheme\}/);
    expect(src).toMatch(/routeColours=\{routeColours\}/);
    expect(src).toMatch(/show3DBuildings=\{settings\.show3DBuildings && !inRouteSelection && mapType !== "hybrid"\}/);
    // Changing the theme never remounts the map (no key on it), so the route stays.
    expect(src).not.toMatch(/<TrackLineMap[^>]*\bkey=/);
  });
});
