// Fix pass 7 §3: one layout for every screen size. The map always fills the whole window; what
// changes is where the sheets and bars sit:
//
//   phone (portrait)      sheets along the bottom, full width; instruction bar across the top
//   phoneLandscape        sheets become a panel on the left; instruction bar top-left, panel wide
//   tablet (any way up)   the same left panel, a little wider
//   desktop (web, wide)   the same left panel, capped widths
//
// Built from the window size and the safe areas (never fixed device numbers). Pure; tested in
// __tests__/layout/screenLayout.test.ts.

export type LayoutKind = "phone" | "phoneLandscape" | "tablet" | "desktop";

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ScreenLayout {
  kind: LayoutKind;
  width: number;
  height: number;
  landscape: boolean;
  /** Sheets: along the bottom (full width) or as a panel on the left. */
  panel: { side: "bottom" | "left"; left: number; width: number };
  /** The navigation instruction bar's horizontal extent. */
  instructionBar: { left: number; width: number };
  /** The ETA bar during navigation. */
  etaBar: { left: number; width: number };
  /** Space the map camera should keep clear on the left (the panel), so the arrow is centred in what's visible. */
  mapPaddingLeft: number;
}

/** Shortest side at or above this is a tablet (iPad mini portrait is 744 pt wide). */
export const TABLET_MIN_SHORT_SIDE = 600;
/** Web window at or above this width is laid out as desktop. */
export const DESKTOP_MIN_WIDTH = 1024;
export const PANEL_MIN = 320;
export const PANEL_MAX = 420;
/** The gap between the panel and the window edge (and the safe area). */
export const PANEL_MARGIN = 12;

export function layoutKind(width: number, height: number, platform: "ios" | "android" | "web" | string = "ios"): LayoutKind {
  const short = Math.min(width, height);
  if (platform === "web" && width >= DESKTOP_MIN_WIDTH) return "desktop";
  if (short >= TABLET_MIN_SHORT_SIDE) return "tablet";
  return width > height ? "phoneLandscape" : "phone";
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function screenLayout(
  width: number,
  height: number,
  insets: Insets = { top: 0, bottom: 0, left: 0, right: 0 },
  platform: string = "ios",
  forceKind?: LayoutKind
): ScreenLayout {
  const kind = forceKind ?? layoutKind(width, height, platform);
  const landscape = width > height;
  if (kind === "phone") {
    return {
      kind,
      width,
      height,
      landscape,
      panel: { side: "bottom", left: 0, width },
      instructionBar: { left: 0, width },
      etaBar: { left: 0, width },
      mapPaddingLeft: 0,
    };
  }
  // Left panel: about a third of the window, within sensible limits, never more than 45% of a
  // landscape phone (the map must stay the main thing).
  const share = kind === "phoneLandscape" ? 0.42 : 0.36;
  const left = insets.left + PANEL_MARGIN;
  const panelWidth = Math.round(clamp(width * share, PANEL_MIN, Math.min(PANEL_MAX, width * 0.45)));
  return {
    kind,
    width,
    height,
    landscape,
    panel: { side: "left", left, width: panelWidth },
    instructionBar: { left, width: panelWidth },
    etaBar: { left, width: panelWidth },
    mapPaddingLeft: left + panelWidth,
  };
}

/** Margins that place a bottom-anchored sheet as the left panel (zero on a phone). */
export function sheetMargins(l: ScreenLayout): { marginLeft: number; marginRight: number } {
  if (l.panel.side === "bottom") return { marginLeft: 0, marginRight: 0 };
  return { marginLeft: l.panel.left, marginRight: Math.max(0, l.width - l.panel.left - l.panel.width) };
}

/** Map camera padding with the left panel kept clear (unchanged on a phone). */
export function withPanelPadding<P extends { top: number; right: number; bottom: number; left: number }>(p: P, l: ScreenLayout): P {
  if (l.panel.side === "bottom") return p;
  return { ...p, left: Math.max(p.left, l.mapPaddingLeft) };
}

/**
 * Which way up a screen may turn (react-native-screens' per-screen orientation, the one that
 * actually works -- RootNavigator.tsx's header explains why). The map turns everywhere (landscape
 * phones get the left-panel layout); on a tablet every screen turns; other phone screens stay
 * portrait.
 */
export function screenOrientation(route: string, isTablet: boolean): "all" | "portrait_up" {
  if (isTablet) return "all";
  return route === "Map" || route === "VehicleDetection" ? "all" : "portrait_up";
}
