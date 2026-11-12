// TrackLine's colours, grouped by what they MEAN. A colour is only ever used for its meaning:
// blue says go, light grey says "the other choice", white is a map control, dark grey is
// re-centre, yellow is report, purple is a route, red is danger, green is good. Buttons can't be
// handed a colour at all -- they're handed a variant, and the variant picks from its group here
// (components/ui/Button.tsx). __tests__/colours.test.ts fails if any button resolves to a colour
// outside its group, and checks every text/icon pair below against WCAG AA.
//
// Nothing here imports React Native, so it's tested directly.

export type Scheme = "light" | "dark";

/**
 * Go / confirm blue. The brief says #0099FF; white on #0099FF measures 2.9998:1, a hair under the
 * 3:1 that large text needs, so the fill is one step darker on the green channel (#0098FF,
 * 3.03:1) -- the same colour to the eye.
 */
export const BLUE = "#0098FF";
/**
 * Blue for TEXT and line icons on white or light grey: 6.1:1 on white, 5.5:1 on #F1F3F7, and
 * still 4.8:1 on that grey pressed 6% darker.
 */
export const BLUE_TEXT = "#0062B8";
/** Blue text on dark surfaces (4.9:1 on #26282C). */
export const BLUE_TEXT_DARK = BLUE;

export const LIGHT_GREY = "#F1F3F7";
export const WHITE = "#FFFFFF";
export const INK = "#1F2125";
export const DARK_GREY = "#3C3F44";
export const YELLOW = "#FFD84D";
export const BLACK = "#000000";
export const PURPLE = "#6A1FD1";
export const PURPLE_BEST = "#5212B8";
export const LAVENDER = "#C9A8F5";
export const RED = "#E5484D";
/** Red for text on white or on the pale red fill (6.3:1 / 5.5:1; 4.8:1 on that fill pressed). */
export const RED_TEXT = "#B8262B";
export const RED_SOFT = "#FDECEC";
/** Red text on dark surfaces (5.9:1 on #26282C, 4.9:1 on #33363B). */
export const RED_TEXT_DARK = "#FF7A7D";
export const RED_SOFT_DARK = "#3A2427";
export const GREEN = "#12A150";
/** Green for text on white (5.4:1). */
export const GREEN_TEXT = "#0B7A3B";
/** Green text on dark surfaces (6.5:1 on #26282C). */
export const GREEN_TEXT_DARK = "#2BC56A";

/** Surfaces and text, per scheme. Dark is used while the map is in its dark theme. */
export const SURFACES = {
  light: {
    background: WHITE,
    sheet: WHITE,
    raised: WHITE,
    muted: LIGHT_GREY,
    text: INK,
    textMuted: "#6B7078",
    textFaint: "#6F747C",
    divider: "#E6E8EB",
  },
  dark: {
    background: "#1C1D20",
    sheet: "#1C1D20",
    raised: "#26282C",
    muted: "#33363B",
    text: WHITE,
    textMuted: "#B8BCC4",
    textFaint: "#A3A8B0",
    divider: "#33363B",
  },
} as const;

/** One meaning group: its fill, what goes on top of it, and any outline. */
export interface GroupColours {
  fill: string;
  /** Text or icon drawn on the fill. */
  on: string;
  outline?: string;
}

export type ActionGroup =
  | "go"
  | "alternative"
  | "mapControl"
  | "recenter"
  | "report"
  | "route"
  | "danger"
  | "dangerConfirm"
  | "good";

/**
 * The colour of every kind of action, light and dark. Dark mode changes surfaces and map
 * controls only; every hue keeps its meaning (and its value, where it still reads).
 */
export const ACTIONS: Record<Scheme, Record<ActionGroup, GroupColours>> = {
  light: {
    go: { fill: BLUE, on: WHITE },
    alternative: { fill: LIGHT_GREY, on: BLUE_TEXT },
    mapControl: { fill: WHITE, on: INK, outline: "rgba(16,24,40,0.06)" },
    recenter: { fill: DARK_GREY, on: WHITE },
    report: { fill: YELLOW, on: BLACK, outline: BLACK },
    route: { fill: PURPLE, on: WHITE },
    danger: { fill: RED_SOFT, on: RED_TEXT },
    dangerConfirm: { fill: RED, on: WHITE },
    good: { fill: GREEN, on: WHITE },
  },
  dark: {
    go: { fill: BLUE, on: WHITE },
    alternative: { fill: "#33363B", on: "#6CC0FF" },
    mapControl: { fill: "#2A2C30", on: WHITE, outline: "rgba(255,255,255,0.08)" },
    recenter: { fill: DARK_GREY, on: WHITE },
    report: { fill: YELLOW, on: BLACK, outline: BLACK },
    route: { fill: PURPLE, on: WHITE },
    danger: { fill: RED_SOFT_DARK, on: RED_TEXT_DARK },
    dangerConfirm: { fill: RED, on: WHITE },
    good: { fill: GREEN, on: WHITE },
  },
};

/** Every colour each group may use, both schemes, fills and foregrounds and outlines together. */
export function allowedColours(group: ActionGroup): Set<string> {
  const out = new Set<string>();
  for (const scheme of ["light", "dark"] as const) {
    const g = ACTIONS[scheme][group];
    out.add(g.fill);
    out.add(g.on);
    if (g.outline) out.add(g.outline);
  }
  // Ghost buttons (no fill) of the alternative group draw their blue text straight on the
  // surface, and a selected chip borrows go's pale tint.
  if (group === "alternative") {
    out.add("transparent");
    out.add(SELECTED_TINT.light);
    out.add(SELECTED_TINT.dark);
    out.add(SURFACES.light.text);
    out.add(SURFACES.dark.text);
  }
  if (group === "danger") out.add("transparent");
  return out;
}

/** Pale blue behind a selected chip or row. */
export const SELECTED_TINT = { light: "#E1F1FD", dark: "#17324A" } as const;

// ---- Reports ---------------------------------------------------------------------------------

export type ReportKind = "police" | "crash" | "hazard" | "jam" | "camera" | "roadwork" | "chat";

export interface ReportColour {
  fill: string;
  /** The glyph on top: white where white reads (3:1 or better), ink where it doesn't. */
  glyph: string;
  /** Roadwork is drawn as a diamond, every other report as a circle. */
  shape: "circle" | "diamond";
}

export const REPORTS: Record<ReportKind, ReportColour> = {
  police: { fill: "#2F6FED", glyph: WHITE, shape: "circle" },
  crash: { fill: "#F0552E", glyph: WHITE, shape: "circle" },
  hazard: { fill: "#F5A623", glyph: INK, shape: "circle" },
  jam: { fill: "#D7263D", glyph: WHITE, shape: "circle" },
  camera: { fill: "#8B5CF6", glyph: WHITE, shape: "circle" },
  roadwork: { fill: "#FF8A00", glyph: INK, shape: "diamond" },
  chat: { fill: "#14B8C8", glyph: INK, shape: "circle" },
};

/** Live Traffic NSW incidents use their type's colour plus this white "i" badge. */
export const LIVE_TRAFFIC_BADGE = { fill: WHITE, glyph: "#2F6FED" } as const;

/** Emergency vehicles aren't a report type; they're danger red. Traffic lights are neutral. */
export const EMERGENCY_PIN: ReportColour = { fill: RED, glyph: WHITE, shape: "circle" };
export const TRAFFIC_LIGHT_PIN: ReportColour = { fill: DARK_GREY, glyph: WHITE, shape: "circle" };

/** The Live Traffic NSW categories, in report colours. */
export type IncidentKind = "crash" | "roadwork" | "traffic" | "closed" | "fire" | "flood" | "event" | "other";
export const INCIDENT_REPORT: Record<IncidentKind, ReportKind> = {
  crash: "crash",
  roadwork: "roadwork",
  traffic: "jam",
  closed: "jam",
  fire: "hazard",
  flood: "hazard",
  event: "hazard",
  other: "hazard",
};

// ---- Traffic ---------------------------------------------------------------------------------

/** On the map: free-flowing roads aren't coloured at all. */
export const TRAFFIC = {
  slow: "#F5A623",
  heavy: "#D7263D",
  standstill: "#8E1B2B",
} as const;

export type TrafficWord = "light" | "typical" | "heavy";

/** "Light traffic" / "Typical traffic" / "Heavy traffic" as text, per scheme. */
export const TRAFFIC_TEXT: Record<Scheme, Record<TrafficWord, string>> = {
  light: { light: GREEN_TEXT, typical: SURFACES.light.textMuted, heavy: RED_TEXT },
  dark: { light: GREEN_TEXT_DARK, typical: SURFACES.dark.textMuted, heavy: RED_TEXT_DARK },
};

/** The selected route row's time. */
export const SELECTED_ROUTE_TIME: Record<Scheme, string> = { light: BLUE_TEXT, dark: BLUE_TEXT_DARK };

// ---- Contrast --------------------------------------------------------------------------------

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an opaque #RRGGBB colour. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`luminance: not an opaque #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two opaque colours, unrounded. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The colour a pressed control shows: 6% darker. */
export function darken(hex: string, amount = PRESS_DARKEN): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - amount)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export const PRESS_DARKEN = 0.06;

/** WCAG AA: 4.5:1 for body text, 3:1 for large text (18pt, or 14pt bold) and for icons. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;
