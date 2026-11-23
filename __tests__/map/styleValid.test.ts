// Every built map style must pass the open style-spec validator. Root cause this guards: the
// road-shields text colour fell back to the string "none" inside a colour expression, which
// Mapbox rejects (GL JS refused the whole style when the map-polish screenshots were taken).
import { describe, expect, it } from "@jest/globals";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import light from "../../src/map-v2/styles/trackline-light.json";
import dark from "../../src/map-v2/styles/trackline-dark.json";
import satellite from "../../src/map-v2/styles/trackline-satellite-streets.json";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe("built map styles are valid", () => {
  it.each([
    ["light", light],
    ["dark", dark],
    ["satellite-streets", satellite],
  ])("%s: no validation errors", (_n, style) => {
    expect(validateStyleMin(clone(style) as never).map((e) => e.message)).toEqual([]);
  });

  it("the validator does catch the old 'none' colour fallback", () => {
    const bad = clone(light) as { layers: { id: string; paint?: Record<string, unknown> }[] };
    const shields = bad.layers.find((l) => l.id === "road-shields")!;
    shields.paint!["text-color"] = ["match", ["get", "shield_text_color"], "black", "#1A1A1A", "none"];
    expect(validateStyleMin(bad as never).length).toBeGreaterThan(0);
  });
});
