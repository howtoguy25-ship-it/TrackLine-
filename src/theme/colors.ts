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
/** The route through a manoeuvre during the approach view: the route purple, brightened. */
export const PURPLE_BRIGHT = "#8A4DF0";
export const RED = "#E5484D";
/** Red for text on white or on the pale red fill (6.3:1 / 5.5:1; 4.8:1 on that fill pressed). */
export const RED_TEXT = "#B8262B";
export const RED_SOFT = "#FDECEC";
/** Red text on dark surfaces (5.9:1 on #26282C, 4.9:1 on #33363B). */
export const RED_TEXT_DARK = "#FF7A7D";
export const RED_SOFT_DARK = "#3A2427";
/** School zones: the amber of real school-zone signs (sign badge, map overlay). */
export const SCHOOL_ZONE = "#F5A524";
export const SCHOOL_ZONE_SOFT = "#FDE7B8";
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

/**
 * Report status (vehicle full check sections): a soft fill with text that reads on it, plus the
 * strong dot colour. Green = clear, amber = check this, red = problem.
 * Text on fill (measured): green 4.86:1, amber 6.20:1, red 5.49:1 -- all pass WCAG AA for body text.
 */
export const AMBER = "#E08A00";
export const AMBER_TEXT = "#8A4B00";
export const AMBER_SOFT = "#FFF3DF";
export const GREEN_SOFT = "#E6F6EC";
export type ReportStatusKey = "green" | "amber" | "red";
export const REPORT_STATUS: Record<ReportStatusKey, { fill: string; on: string; dot: string; label: string }> = {
  green: { fill: GREEN_SOFT, on: GREEN_TEXT, dot: GREEN, label: "Clear" },
  amber: { fill: AMBER_SOFT, on: AMBER_TEXT, dot: AMBER, label: "Check" },
  red: { fill: RED_SOFT, on: RED_TEXT, dot: RED, label: "Problem" },
};

// ---- Settings ---------------------------------------------------------------------------------

/** Every settings page, light and dark: grouped cards on a grey page. */
export const SETTINGS_SURFACES = {
  light: {
    page: "#F2F3F5",
    card: WHITE,
    text: INK,
    subtext: "#5F646C",
    separator: "#E3E5E8",
    tick: BLUE_TEXT,
    highlight: SELECTED_TINT.light,
    input: "#F2F3F5",
    danger: RED_TEXT,
    switchOff: "#C9CCD1",
  },
  dark: {
    page: "#0E0F11",
    card: "#1C1D20",
    text: "#F2F3F5",
    subtext: "#A3A8B0",
    separator: "#2A2C30",
    tick: BLUE,
    highlight: SELECTED_TINT.dark,
    input: "#26282C",
    danger: RED_TEXT_DARK,
    switchOff: "#3A3D42",
  },
} as const;

/** What a settings row is about; its icon tile takes the meaning's colour. */
export type SettingsIconMeaning = "map" | "routes" | "reports" | "safety" | "privacy" | "sound" | "account";

/**
 * Settings icon tiles by meaning: map & navigation blue, routes purple, reports yellow (the
 * report button's yellow, so its glyph is ink like the report button's), safety & speed red,
 * privacy & visibility green, voice & sound teal, account & about grey. Glyphs read on their
 * tile at 3:1 or better (checked in __tests__/design/colours.test.ts).
 */
export const SETTINGS_ICON: Record<SettingsIconMeaning, { fill: string; glyph: string }> = {
  map: { fill: "#1673D9", glyph: WHITE },
  routes: { fill: PURPLE, glyph: WHITE },
  reports: { fill: YELLOW, glyph: INK },
  safety: { fill: "#D2303A", glyph: WHITE },
  privacy: { fill: "#1E8449", glyph: WHITE },
  sound: { fill: "#0B7F80", glyph: WHITE },
  account: { fill: "#6B7078", glyph: WHITE },
};

/**
 * In-drive quick actions and search categories, each a round tile with its own colour (our own
 * palette): what it is, at a glance, the way a driver scans them. White glyphs read at 3:1+ on
 * every fill (checked in __tests__/design/colours.test.ts). Report keeps the report yellow.
 */
export type DriveTileKind = "share" | "report" | "addStop" | "dashcam" | "map" | "sound" | "avoid" | "help" | "fuel" | "food" | "parking" | "coffee" | "ev" | "toilets";
export const DRIVE_TILE: Record<DriveTileKind, { fill: string; glyph: string }> = {
  share: { fill: "#1673D9", glyph: WHITE },
  report: { fill: YELLOW, glyph: INK },
  addStop: { fill: "#0B7F80", glyph: WHITE },
  dashcam: { fill: "#4B5563", glyph: WHITE },
  map: { fill: "#5B3FC4", glyph: WHITE },
  sound: { fill: "#0B6E99", glyph: WHITE },
  avoid: { fill: "#9A3412", glyph: WHITE },
  help: { fill: "#475569", glyph: WHITE },
  fuel: { fill: "#C2410C", glyph: WHITE },
  food: { fill: "#B4235A", glyph: WHITE },
  parking: { fill: "#1D4ED8", glyph: WHITE },
  coffee: { fill: "#7C4A2D", glyph: WHITE },
  ev: { fill: "#15803D", glyph: WHITE },
  toilets: { fill: "#0E7490", glyph: WHITE },
};
