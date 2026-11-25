// Motorways stand out: every M road (M1, M2, M4, M5, M7...) and its on / off ramps are drawn in
// their own warm amber with a deeper edge, apart from the slate highways and the grey streets,
// on every theme, dark mode and satellite -- and they show from zoom 6 so the whole network is
// visible zoomed out. The shields (green plates, yellow numbers) are unchanged.
import { readFileSync } from "fs";
import { describe, expect, it } from "@jest/globals";
import { buildStyle, MOTORWAY_LINE_MIN_ZOOM, ROAD_CLASS_SOURCES, roadColour, SATELLITE_LABEL_PALETTE, THEME_PALETTES, type StylePalette } from "@/map-v2/styles/buildStyle";
import { checkPalette } from "@/map-v2/styles/styleContrast";

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
/** Hue in degrees, 0-360. */
const hue = (hex: string) => {
  const { r, g, b } = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const isWarm = (hex: string) => {
  const { r, b } = rgb(hex);
  const h = hue(hex);
  return r - b > 60 && h >= 20 && h <= 50; // orange-amber
};

type Layer = { id: string; minzoom?: number; filter?: unknown; paint?: Record<string, unknown> };
const layersOf = (p: StylePalette) => (buildStyle(p) as { layers: Layer[] }).layers;

const palettes: [string, StylePalette][] = [...Object.entries(THEME_PALETTES), ["satellite", SATELLITE_LABEL_PALETTE]];

describe("motorways in their own colour", () => {
  it.each(palettes)("%s: motorway amber, apart from highways and streets", (_name, p) => {
    expect(isWarm(p.motorway)).toBe(true);
    expect(p.motorway).not.toBe(p.road);
    expect(p.motorway).not.toBe(p.trunk);
    expect(roadColour(p, "motorway")).toBe(p.motorway);
    expect(roadColour(p, "trunk")).toBe(p.trunk);
    expect(roadColour(p, "primary")).toBe(p.road);
  });

  it.each(Object.entries(THEME_PALETTES))("%s: still readable against the ground (contrast rules)", (_name, p) => {
    expect(checkPalette(p).filter((r) => !r.ok)).toEqual([]);
  });

  it("the on / off ramps (motorway_link) are the same colour as the motorway", () => {
    expect(ROAD_CLASS_SOURCES.motorway).toEqual(["motorway", "motorway_link"]);
    const layers = layersOf(THEME_PALETTES.light);
    for (const id of ["road-motorway", "road-casing-motorway"]) {
      const l = layers.find((x) => x.id === id)!;
      expect(JSON.stringify(l.filter)).toContain("motorway_link");
      expect(l.minzoom).toBe(MOTORWAY_LINE_MIN_ZOOM);
    }
    expect(layers.find((x) => x.id === "road-casing-motorway")!.paint!["line-color"]).toBe(THEME_PALETTES.light.motorwayCasing);
  });

  it("the bundled style files the app loads carry it (light, dark, satellite)", () => {
    for (const [file, p] of [
      ["trackline-light.json", THEME_PALETTES.light],
      ["trackline-dark.json", THEME_PALETTES.dark],
      ["trackline-satellite-streets.json", SATELLITE_LABEL_PALETTE],
    ] as const) {
      const json = JSON.parse(readFileSync(`src/map-v2/styles/${file}`, "utf8")) as { layers: { id: string; paint?: Record<string, unknown> }[] };
      expect(json.layers.find((l) => l.id === "road-motorway")!.paint!["line-color"]).toBe(p.motorway);
      expect(json.layers.find((l) => l.id === "road-trunk")!.paint!["line-color"]).toBe(p.trunk);
    }
  });

  it("the motorway shields stay as they were", () => {
    expect(layersOf(THEME_PALETTES.light).some((l) => l.id.includes("shield"))).toBe(true);
  });
});
