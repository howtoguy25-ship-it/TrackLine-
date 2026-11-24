// Map styles add-on §3: the theme picker shows each style drawn with real tiles (not swatches),
// a live map of the chosen one, and picking applies at once without remounting the map.
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "fs";
import { render, screen } from "@testing-library/react-native";
import { MapThemePreview } from "@/components/settings/SettingsPreviews";
import { THEME_PALETTES } from "@/map-v2/styles/buildStyle";
import { THEME_PREVIEW_IMAGES } from "@/map-v2/themePreviews";

describe("theme picker previews", () => {
  it("every theme (and satellite) has a rendered preview image from real tiles", () => {
    for (const k of [...Object.keys(THEME_PALETTES), "satellite"]) {
      expect([k, existsSync(`assets/map/theme-previews/${k}.jpg`)]).toEqual([k, true]);
      expect(THEME_PREVIEW_IMAGES[k as keyof typeof THEME_PREVIEW_IMAGES]).toBeTruthy();
    }
  });

  it("the tile shows that image, not drawn colour blocks", async () => {
    await render(<MapThemePreview theme="dark" />);
    expect(screen.getByTestId("map-theme-preview-dark").props.source).toBe(THEME_PREVIEW_IMAGES.dark);
    const src = readFileSync("src/components/settings/SettingsPreviews.tsx", "utf8");
    const fn = src.slice(src.indexOf("export function MapThemePreview"), src.indexOf("/** Road thickness:"));
    expect(fn).not.toMatch(/<Svg|<Rect|<Path/);
  });

  it("Settings shows a live map of the chosen theme above the picker; picking saves at once (the map screen re-styles in place)", () => {
    const settings = readFileSync("src/screens/SettingsScreen.tsx", "utf8");
    expect(settings).toMatch(/<LiveMapPreview theme=\{settings\.mapTheme as ThemeKey\}/);
    const live = readFileSync("src/components/settings/LiveMapPreview.tsx", "utf8");
    expect(live).toMatch(/styleFor\(theme, roadThickness, false, false\)/);
    // The map screen's style is a memo of the theme: no remount, so the route and camera stay.
    const map = readFileSync("src/map-v2/TrackLineMap.tsx", "utf8");
    expect(map).toMatch(/const styleJSON = useMemo\(/);
  });
});
