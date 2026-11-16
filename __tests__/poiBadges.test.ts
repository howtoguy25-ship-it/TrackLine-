// Brand & popular-place badges: which places, from which zoom, what they look like, and the
// partner-logo hook -- all from Mapbox Streets v8's own poi_label data.
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ settings: { alertIconTheme: "default" } }) }));

import { LIGHT_PALETTE, buildStyle } from "@/map-v2/styles/buildStyle";
import {
  BADGE_CATEGORIES,
  BADGE_LAYER_IDS,
  BADGE_PADDING_PX,
  MAKI_BADGE,
  PARTNER_LOGOS,
  badgeCategoryForMaki,
  badgeIconName,
} from "@/map/poiBadges";
import { iconView } from "@/map-v2/layers/MapIcons";

// The documented poi_label maki values (Mapbox Streets v8 reference) this module may use.
const DOCUMENTED_MAKI = new Set([
  "alcohol-shop", "bakery", "cafe", "charging-station", "clothing-store", "convenience", "fast-food", "fuel", "furniture",
  "grocery", "hardware", "hospital", "ice-cream", "jewelry-store", "mobile-phone", "parking", "parking-garage", "pharmacy",
  "restaurant", "restaurant-noodle", "restaurant-pizza", "restaurant-seafood", "shoe", "shop",
]);

type Layer = { id: string; minzoom?: number; filter?: unknown; layout?: Record<string, unknown> };
const layers = (buildStyle(LIGHT_PALETTE) as { layers: Layer[] }).layers;
const layer = (id: string) => layers.find((l) => l.id === id)!;

describe("brand & popular-place badges", () => {
  it("only uses maki values Mapbox documents", () => {
    for (const maki of Object.keys(MAKI_BADGE)) expect(DOCUMENTED_MAKI.has(maki)).toBe(true);
  });

  it("fuel and hospitals from zoom 13, everything else from zoom 15", () => {
    const [early, rest] = BADGE_LAYER_IDS.map(layer);
    expect(early.minzoom).toBe(13);
    expect(rest.minzoom).toBe(15);
    const earlyMakis = JSON.stringify(early.filter);
    expect(earlyMakis).toContain('"fuel"');
    expect(earlyMakis).toContain('"hospital"');
    expect(earlyMakis).not.toContain('"grocery"');
    expect(JSON.stringify(rest.filter)).toContain('"grocery"');
    expect(JSON.stringify(rest.filter)).not.toContain('"fuel"');
  });

  it("only branded places (plus hospitals), only the prominent ones, most prominent placed first", () => {
    for (const l of BADGE_LAYER_IDS.map(layer)) {
      const f = JSON.stringify(l.filter);
      expect(f).toContain('["has","brand"]');
      expect(f).toContain('["==",["get","maki"],"hospital"]');
      expect(f).toContain('["<=",["get","filterrank"],2]');
      expect(l.layout?.["symbol-sort-key"]).toEqual(["get", "filterrank"]);
      // Native collision with room around each badge: no overlap flags, generous padding.
      expect(l.layout?.["icon-allow-overlap"]).toBeUndefined();
      expect(l.layout?.["icon-padding"]).toBe(BADGE_PADDING_PX);
      expect(l.layout?.["icon-anchor"]).toBe("bottom");
      expect(l.layout?.["text-optional"]).toBe(true);
    }
  });

  it("a partner's logo is used only when registered; otherwise our own category badge", () => {
    const icon = JSON.stringify(layer(BADGE_LAYER_IDS[0]).layout?.["icon-image"]);
    expect(icon.startsWith('["coalesce",["image",["concat","logo:"')).toBe(true);
    expect(icon).toContain('"badge:fuel"');
    expect(icon).toContain('"badge:hospital"');
    expect(PARTNER_LOGOS).toEqual({});
  });

  it("plain POI labels skip places that already have a badge", () => {
    expect(JSON.stringify(layer("poi-labels").filter)).toContain('["!",["all"');
  });

  it("every category has our own badge artwork, and maps from its maki values", () => {
    for (const c of BADGE_CATEGORIES) expect(iconView(badgeIconName(c))).not.toBeNull();
    expect(badgeCategoryForMaki("fuel")).toBe("fuel");
    expect(badgeCategoryForMaki("fast-food")).toBe("fork");
    expect(badgeCategoryForMaki("cafe")).toBe("cup");
    expect(badgeCategoryForMaki("grocery")).toBe("cart");
    expect(badgeCategoryForMaki("parking-garage")).toBe("parking");
    expect(badgeCategoryForMaki("museum")).toBeNull();
  });
});
