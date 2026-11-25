// Map styles add-on §1/§4: one generator for every style; each theme only changes colours,
// never readability or layout. Contrast checks per theme + a style snapshot.
import { describe, expect, it } from "@jest/globals";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  SATELLITE_CASED,
  SATELLITE_LABEL_PALETTE,
  SATELLITE_RASTER_PAINT,
  THEME_PALETTES,
  buildStyle,
  type ThemeKey,
} from "@/map-v2/styles/buildStyle";
import { checkPalette } from "@/map-v2/styles/styleContrast";

type Layer = { id: string; type: string; paint?: Record<string, unknown>; layout?: Record<string, unknown>; filter?: unknown; minzoom?: number; maxzoom?: number; source?: string };
const COLOUR = /^#[0-9A-F]{6}$/i;

/** The style with every colour replaced by a placeholder: what must be identical across themes. */
function shape(style: { layers: Layer[] }): unknown {
  return JSON.parse(JSON.stringify(style.layers), (_k, v) => (typeof v === "string" && COLOUR.test(v) ? "<colour>" : v));
}
const themes = Object.keys(THEME_PALETTES) as ThemeKey[];

describe("contrast in every theme", () => {
  it.each(themes)("%s: roads vs land, labels vs halo/land, water, route vs roads/land all pass", (t) => {
    const failures = checkPalette(THEME_PALETTES[t]).filter((r) => !r.ok);
    expect(failures).toEqual([]);
  });

  it("satellite: labels vs halo and the route vs the road overlay pass", () => {
    expect(checkPalette(SATELLITE_LABEL_PALETTE, true).filter((r) => !r.ok)).toEqual([]);
  });

  it("dark is dark slate with lighter blue-grey roads and bright labels (never near-black blocks)", () => {
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) * 0.299 + parseInt(h.slice(3, 5), 16) * 0.587 + parseInt(h.slice(5, 7), 16) * 0.114;
    expect(lum(DARK_PALETTE.land)).toBeGreaterThan(20); // not black
    expect(lum(DARK_PALETTE.land)).toBeLessThan(60); // but dark
    expect(lum(DARK_PALETTE.road)).toBeGreaterThan(lum(DARK_PALETTE.land));
    expect(lum(DARK_PALETTE.building)).toBeGreaterThan(lum(DARK_PALETTE.land) - 2);
    expect(lum(DARK_PALETTE.streetLabel)).toBeGreaterThan(220);
  });
});

describe("one style system", () => {
  it("every theme has exactly the light style's layout: same layers, widths, zooms, filters, labels — only colours differ", () => {
    const base = shape(buildStyle(LIGHT_PALETTE) as { layers: Layer[] });
    for (const t of themes) expect([t, shape(buildStyle(THEME_PALETTES[t]) as { layers: Layer[] })]).toEqual([t, base]);
  });

  it("buildings are flat footprints by default in every style (no extrusion in the style itself)", () => {
    for (const t of themes) {
      const layers = (buildStyle(THEME_PALETTES[t]) as { layers: Layer[] }).layers;
      expect(layers.some((l) => l.type === "fill-extrusion")).toBe(false);
      expect(layers.find((l) => l.id === "buildings")?.type).toBe("fill");
    }
  });

  it("street labels are bold with halos; suburb labels are mixed case", () => {
    const layers = (buildStyle(LIGHT_PALETTE) as { layers: Layer[] }).layers;
    const street = layers.find((l) => l.id.startsWith("road-label-"))!;
    expect(String(street.layout!["text-font"])).toMatch(/Bold|Medium/);
    expect(Number(street.paint!["text-halo-width"])).toBeGreaterThan(0);
    expect(layers.find((l) => l.id === "suburb-labels")!.layout!["text-transform"]).toBe("none");
  });
});

describe("clean satellite (§2)", () => {
  const sat = buildStyle(SATELLITE_LABEL_PALETTE, { satellite: true }) as { layers: Layer[] };
  it("softened imagery that fades in over a neutral ground", () => {
    const raster = sat.layers.find((l) => l.type === "raster")!;
    expect(raster.paint).toEqual(SATELLITE_RASTER_PAINT);
    expect(SATELLITE_RASTER_PAINT["raster-saturation"]).toBeLessThan(0);
    expect(SATELLITE_RASTER_PAINT["raster-contrast"]).toBeLessThan(0);
    expect(SATELLITE_RASTER_PAINT["raster-brightness-min"]).toBeGreaterThan(0);
    expect(SATELLITE_RASTER_PAINT["raster-fade-duration"]).toBeGreaterThan(0);
    expect(sat.layers[0].type).toBe("background");
  });
  it("roads are light, semi-transparent lines; only main roads get a thin casing; no buildings", () => {
    for (const l of sat.layers.filter((x) => x.id.startsWith("road-casing-"))) {
      const cls = l.id.replace("road-casing-", "");
      expect([cls, (l.paint!["line-opacity"] as number) > 0]).toEqual([cls, SATELLITE_CASED.includes(cls as never)]);
    }
    for (const l of sat.layers.filter((x) => /^road-(motorway|primary|residential)$/.test(x.id))) {
      expect(l.paint!["line-opacity"] as number).toBeGreaterThan(0.3);
      expect(l.paint!["line-opacity"] as number).toBeLessThan(1);
    }
    expect(sat.layers.some((l) => l.id === "buildings" || l.type === "fill-extrusion")).toBe(false);
    // Bold white street names on dark halos.
    const label = sat.layers.find((l) => l.id.startsWith("road-label-"))!;
    expect(label.paint!["text-color"]).toBe("#FFFFFF");
  });
});

describe("style snapshot", () => {
  it("the colours of every style", () => {
    const summary: Record<string, Record<string, string>> = {};
    for (const [name, style] of [
      ...themes.map((t) => [t, buildStyle(THEME_PALETTES[t])] as const),
      ["satellite", buildStyle(SATELLITE_LABEL_PALETTE, { satellite: true })] as const,
    ]) {
      const colours: Record<string, string> = {};
      for (const l of (style as { layers: Layer[] }).layers) {
        for (const [k, v] of Object.entries(l.paint ?? {})) if (typeof v === "string" && COLOUR.test(v)) colours[`${l.id}.${k}`] = v;
      }
      summary[name] = colours;
    }
    expect(summary).toMatchSnapshot();
  });
});
