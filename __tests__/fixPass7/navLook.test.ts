// Fix pass 7 §4: nothing over the compass or the route; one purple line with one darker casing;
// street callouts beside the turn (outside it, with a tail), POI labels hidden while they show;
// Re-centre in the right column; the ad banner sized to the ad, never cut off.
import { readFileSync } from "fs";
import { describe, expect, it } from "@jest/globals";
import { calloutAnchor, calloutSide } from "@/nav/turnCallout";
import { bannerSlotHeight, BANNER_HEIGHT, BANNER_MAX_HEIGHT } from "@/components/BannerAdBar";
import { COMPASS_SIZE, SIDE_MARGIN, SOUND_SIZE, navControlFrames, topBadgeLane, topColumnTop } from "@/nav/navControlsLayout";

const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

describe("street callouts beside the turn", () => {
  it("outside the turn: left of a right turn, right of a left turn", () => {
    expect(calloutSide("turn-right")).toBe("left");
    expect(calloutSide("turn-slight-right")).toBe("left");
    expect(calloutSide("ramp-right")).toBe("left");
    expect(calloutSide("turn-left")).toBe("right");
    expect(calloutSide("fork-left")).toBe("right");
    // Roundabouts / straight: away from your own kerb.
    expect(calloutSide("roundabout-left", "left")).toBe("right");
    expect(calloutSide("straight", "right")).toBe("left");
  });
  it("the tail's tip (the view's edge, vertically centred) is on the turn point -- never bottom-centre on the corner", () => {
    expect(calloutAnchor("left")).toEqual({ x: 1, y: 0.5 });
    expect(calloutAnchor("right")).toEqual({ x: 0, y: 0.5 });
    const layers = code("src/map-v2/MapboxLayers.tsx");
    expect(layers).toMatch(/anchor=\{calloutAnchor\(side\)\}/);
    expect(layers).toMatch(/props\.turnCallouts\.length > 0 \? <HidePoiLabels \/> : null/);
    expect(layers).toMatch(/<Mapbox\.SymbolLayer id="poi-labels" existing style=\{\{ visibility: "none" \}\} \/>/);
    expect(code("src/screens/MapScreen.tsx")).toMatch(/side: calloutSide\(step\.maneuver, step\.drivingSide \?\? "left"\)/);
  });
});

describe("one solid purple route line", () => {
  it("no white stripe: the turn-arrow layer is gone; the approach line's casing is the dark purple", () => {
    const layers = code("src/map-v2/MapboxLayers.tsx");
    expect(layers).not.toMatch(/nav-turn-arrow/);
    expect(layers).toMatch(/id="nav-route"[\s\S]*?color=\{ROUTE_PURPLE\}[\s\S]*?casingColor=\{ROUTE_PURPLE_CASING\}/);
    const through = layers.slice(layers.indexOf('id="manoeuvre-through"'), layers.indexOf('id="manoeuvre-through"') + 300);
    expect(through).not.toMatch(/#FFFFFF/);
  });
});

describe("nothing on the compass", () => {
  it("'End suggested route' is no longer on the map; it's a row in the ETA sheet", () => {
    const map = code("src/screens/MapScreen.tsx");
    expect(map).not.toMatch(/label="End suggested route"/);
    expect(map).toMatch(/onEndSuggestedRoute=\{route && acceptedSuggestionOriginalRoute \?/);
    expect(code("src/screens/NavOptionsSheet.tsx")).toMatch(/label="Back to your original route"/);
  });
  it.each([320, 375, 390, 430])("%ipt: the top badges (Rerouting, ride, transit wait) sit between the compass and the sound column", (width) => {
    const lane = topBadgeLane(width);
    expect(lane.left).toBeGreaterThanOrEqual(SIDE_MARGIN + COMPASS_SIZE + 12);
    expect(lane.left + lane.maxWidth).toBeLessThanOrEqual(width - SIDE_MARGIN - SOUND_SIZE - 12);
    expect(topColumnTop(47, 90)).toBeGreaterThan(0);
  });
  it("Re-centre: right column above Report, nowhere near the speedometer", () => {
    for (const width of [320, 375, 430]) {
      const f = navControlFrames({ width, height: 812, safeTop: 47, safeBottom: 34, bottomBarHeight: 96, topBarHeight: 90, showSpeedLimit: true, showRecenter: true });
      expect(f.recenter!.x).toBe(f.report!.x);
      expect(f.recenter!.y + f.recenter!.height + 12).toBeLessThanOrEqual(f.report!.y);
      expect(f.recenter!.x).toBeGreaterThan(f.speedometer!.x + f.speedometer!.width);
    }
  });
});

describe("ad banner never cut off", () => {
  it("the slot follows the ad's real height, within 50-60pt", () => {
    expect(bannerSlotHeight(null)).toBe(BANNER_HEIGHT);
    expect(bannerSlotHeight(50)).toBe(50);
    expect(bannerSlotHeight(56.4)).toBe(57);
    expect(bannerSlotHeight(120)).toBe(BANNER_MAX_HEIGHT);
    const bar = code("src/components/BannerAdBar.tsx");
    expect(bar).toMatch(/onSizeChange=\{\(\{ height \}\) => setMeasured\(height\)\}/);
    expect(bar).toMatch(/style=\{\[styles\.slot, \{ height: slotHeight \}\]\}/);
    expect(bar).toMatch(/width=\{Math\.floor\(width\)\}/); // full width
    expect(code("src/screens/MapScreen.tsx")).toMatch(/const bannerAreaHeight = bannerShown \? bannerHeight \+ insets\.bottom : 0;/);
  });
});
