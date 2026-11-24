// Fix pass 7 §3: the map always fills the window; sheets and bars place themselves by window
// size and safe areas -- bottom on a portrait phone, a left panel on a landscape phone, a tablet
// (either way up) and a wide web window. Also: the home view is big and open (zoom 16, 45°),
// roads are never giant bands, the iPad is supported and the map may turn.
import { readFileSync } from "fs";
import { describe, expect, it } from "@jest/globals";
import { layoutKind, PANEL_MAX, PANEL_MIN, screenLayout, screenOrientation, sheetMargins, withPanelPadding } from "@/layout/screenLayout";
import { HOME_FOLLOW_ZOOM } from "@/map/homeMapLogic";
import { tiltForZoom } from "@/map/tiltCurve";
import { roadWidthExpression } from "@/map-v2/styles/buildStyle";
import { mapboxZoomFromGoogle } from "@/map-v2/geo";

const notch = { top: 47, bottom: 34, left: 0, right: 0 };
const landscapeNotch = { top: 0, bottom: 21, left: 47, right: 47 };
const SIZES: { name: string; w: number; h: number; insets: typeof notch; platform: string; kind: string }[] = [
  { name: "phone 375×812", w: 375, h: 812, insets: notch, platform: "ios", kind: "phone" },
  { name: "phone 430×932", w: 430, h: 932, insets: notch, platform: "ios", kind: "phone" },
  { name: "landscape phone 812×375", w: 812, h: 375, insets: landscapeNotch, platform: "ios", kind: "phoneLandscape" },
  { name: "landscape phone 932×430", w: 932, h: 430, insets: landscapeNotch, platform: "ios", kind: "phoneLandscape" },
  { name: "iPad portrait 820×1180", w: 820, h: 1180, insets: { top: 24, bottom: 20, left: 0, right: 0 }, platform: "ios", kind: "tablet" },
  { name: "iPad landscape 1180×820", w: 1180, h: 820, insets: { top: 24, bottom: 20, left: 0, right: 0 }, platform: "ios", kind: "tablet" },
  { name: "web 1440×900", w: 1440, h: 900, insets: { top: 0, bottom: 0, left: 0, right: 0 }, platform: "web", kind: "desktop" },
];
/** The right-hand control column (compass, Report, Re-centre) is 64 pt wide from the right edge. */
const RIGHT_COLUMN = 64 + 16;

describe("layout by window size", () => {
  it.each(SIZES)("$name", ({ w, h, insets, platform, kind }) => {
    const l = screenLayout(w, h, insets, platform);
    expect(l.kind).toBe(kind);
    if (kind === "phone") {
      expect(l.panel).toEqual({ side: "bottom", left: 0, width: w });
      expect(sheetMargins(l)).toEqual({ marginLeft: 0, marginRight: 0 });
      expect(l.mapPaddingLeft).toBe(0);
      return;
    }
    // A left panel, inside the safe area, never wider than PANEL_MAX nor most of the window.
    expect(l.panel.side).toBe("left");
    expect(l.panel.left).toBeGreaterThanOrEqual(insets.left);
    expect(l.panel.width).toBeGreaterThanOrEqual(Math.min(PANEL_MIN, w * 0.45));
    expect(l.panel.width).toBeLessThanOrEqual(PANEL_MAX);
    expect(l.panel.width).toBeLessThanOrEqual(w * 0.45);
    // The sheet's margins put it exactly on the panel.
    const m = sheetMargins(l);
    expect(m.marginLeft + l.panel.width + m.marginRight).toBe(w);
    // Instruction bar and ETA bar are the panel's width, top-left / bottom-left -- never under the right column.
    expect(l.instructionBar.left + l.instructionBar.width).toBeLessThanOrEqual(w - RIGHT_COLUMN);
    expect(l.etaBar.width).toBe(l.panel.width);
    // The map stays the main thing: most of the window is map beside the panel.
    expect(w - (l.panel.left + l.panel.width)).toBeGreaterThan(w * 0.5);
    // The camera keeps the panel clear.
    expect(withPanelPadding({ top: 10, right: 0, bottom: 20, left: 0 }, l)).toEqual({ top: 10, right: 0, bottom: 20, left: l.panel.left + l.panel.width });
  });

  it("kinds: short side ≥ 600 is a tablet, wide web is desktop", () => {
    expect(layoutKind(744, 1133)).toBe("tablet"); // iPad mini
    expect(layoutKind(1440, 900, "web")).toBe("desktop");
    expect(layoutKind(1440, 900, "ios")).toBe("tablet");
    expect(layoutKind(390, 844)).toBe("phone");
    expect(layoutKind(844, 390)).toBe("phoneLandscape");
  });

  it("orientation: the map turns everywhere; other phone screens stay portrait; tablets turn everywhere", () => {
    expect(screenOrientation("Map", false)).toBe("all");
    expect(screenOrientation("Settings", false)).toBe("portrait_up");
    expect(screenOrientation("Settings", true)).toBe("all");
    const nav = readFileSync("src/navigation/RootNavigator.tsx", "utf8");
    expect(nav).toMatch(/name="Map" component=\{MapScreen\} options=\{\{ title: "Map", orientation: screenOrientation\("Map", IS_TABLET\) \}\}/);
    expect(nav).toMatch(/orientation: screenOrientation\("", IS_TABLET\)/);
    expect(readFileSync("App.tsx", "utf8")).not.toMatch(/lockAsync\(ScreenOrientation\.OrientationLock\.PORTRAIT_UP\)/);
    expect(readFileSync("app.config.js", "utf8")).toMatch(/supportsTablet: true/);
  });

  it("every sheet over the map takes its place from the layout", () => {
    for (const f of ["src/components/ThreeSnapBottomSheet.tsx", "src/components/SimpleBottomSheet.tsx", "src/components/RouteSelection.tsx", "src/components/TripDetailsSheet.tsx", "src/components/SearchAlongRouteSheet.tsx"]) {
      expect(readFileSync(f, "utf8")).toMatch(/const panel = useSheetPanelStyle\(\);/);
    }
    for (const f of ["src/screens/NavOptionsSheet.tsx", "src/screens/PlaceInfoSheet.tsx", "src/screens/RouteDirectionsSheet.tsx", "src/screens/SoundSheet.tsx", "src/screens/MapToolsSheet.tsx", "src/screens/MapScreen.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/^\s*<BottomSheet(\s|>|$)/m); // gorhom's sheet only through MapSheet (JSX, not types)
    }
    expect(readFileSync("src/components/NavigationInstructionCard.tsx", "utf8")).toMatch(/left: layout\.instructionBar\.left, width: layout\.instructionBar\.width/);
    expect(readFileSync("src/components/NavBottomBar.tsx", "utf8")).toMatch(/left: layout\.etaBar\.left, width: layout\.etaBar\.width/);
    expect(readFileSync("src/screens/MapScreen.tsx", "utf8")).toMatch(/const mapPadding = withPanelPadding\(/);
  });
});

describe("a big, open view (fix pass 7 §3)", () => {
  it("home opens at zoom 16, leaning 45°", () => {
    expect(HOME_FOLLOW_ZOOM).toBe(16);
    expect(Math.round(tiltForZoom(HOME_FOLLOW_ZOOM))).toBe(45);
  });

  /** Width (px) of a road layer at a zoom, evaluating the style's exponential-1.5 interpolation. */
  const widthAt = (expr: unknown[], z: number) => {
    const stops: [number, number][] = [];
    for (let i = 3; i < expr.length; i += 2) stops.push([expr[i] as number, expr[i + 1] as number]);
    if (z <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      const [z0, v0] = stops[i - 1];
      const [z1, v1] = stops[i];
      if (z <= z1) return v0 + (v1 - v0) * ((1.5 ** (z - z0) - 1) / (1.5 ** (z1 - z0) - 1));
    }
    return stops[stops.length - 1][1];
  };
  // Root cause of the first miss: this measured at Mapbox z16, but the home view's zoom 16 is on
  // the app's (Google) scale -- Mapbox 15, where the motorway was only ~9 px.
  it("at the home view (zoom 16 = Mapbox 15) a motorway is 10-12 px including its edge, clearly wider than a street, never a giant band", () => {
    const z = mapboxZoomFromGoogle(HOME_FOLLOW_ZOOM);
    expect(z).toBe(15);
    const motorway = widthAt(roadWidthExpression("motorway", 1, 2), z);
    const street = widthAt(roadWidthExpression("residential", 1, 2), z);
    expect(motorway).toBeGreaterThanOrEqual(10);
    expect(motorway).toBeLessThanOrEqual(12);
    expect(motorway / street).toBeGreaterThan(1.6);
    expect(widthAt(roadWidthExpression("motorway", 1, 2), 18)).toBeLessThanOrEqual(18);
  });
});
