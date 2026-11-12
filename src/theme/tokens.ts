// Shared design tokens: every screen pulls its colours, spacing, radii and shadow from here.
import {
  BLUE,
  BLUE_TEXT,
  DARK_GREY,
  GREEN,
  GREEN_TEXT,
  INK,
  LAVENDER,
  PURPLE,
  PURPLE_BEST,
  RED,
  RED_SOFT,
  RED_TEXT,
  SELECTED_TINT,
  SURFACES,
  YELLOW,
  darken,
} from "@/theme/colors";

// Every value below comes from theme/colors.ts, where colours are grouped by meaning. The names
// here are the ones the app's screens already use.
export const colors = {
  /** Blue for text, links and line icons (passes AA on white and light grey). */
  accent: BLUE_TEXT,
  accentDeep: "#00559F",
  /** Pale blue behind something selected. */
  accentSoft: SELECTED_TINT.light,
  /** Go / confirm blue: filled buttons, with white on top. */
  primary: BLUE,
  primaryPressed: darken(BLUE),
  dark: INK,
  /** Red for danger text and small danger marks (AA on white). */
  danger: RED_TEXT,
  /** The danger red itself: the final confirm button, unread dots. */
  dangerFill: RED,
  dangerSoft: RED_SOFT,
  /** Amber text for a caution (AA on white). */
  warning: "#A35F00",
  /** Good / visible green, and its text shade. */
  good: GREEN,
  goodText: GREEN_TEXT,
  surface: SURFACES.light.sheet,
  surfaceMuted: SURFACES.light.muted,
  border: SURFACES.light.divider,
  chipBorder: "#DADDE2",
  text: SURFACES.light.text,
  textMuted: SURFACES.light.textMuted,
  textFaint: SURFACES.light.textFaint,
  grabber: "#8E9399",
  // Routes
  routePurple: PURPLE,
  routePurpleCasing: "#4A1396",
  routeAlt: LAVENDER,
  bestTag: PURPLE_BEST,
  // The grey bar navigation's trip summary sits on
  banner: "#E9EAEE",
  // Floating map buttons
  reportYellow: YELLOW,
  recenterGrey: DARK_GREY,
  /** The 1px edge on white map buttons. */
  hairline: "rgba(16,24,40,0.06)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

// Corner radii. Named ones are the brief's: menu button 16, chips 18, cards 20; pills are fully
// round.
export const radius = {
  sm: 12,
  md: 14,
  lg: 18,
  xl: 20,
  menu: 16,
  chip: 18,
  card: 20,
  pill: 999,
} as const;

// One shadow for everything that floats: 0 6 16 rgba(16,24,40,0.12) + 0 1 3 rgba(16,24,40,0.08).
// boxShadow draws both layers on iOS and Android (React Native's new architecture). The old tier
// names all resolve to it, so every card, sheet and button casts the same soft shadow.
const ONE_SHADOW = {
  boxShadow: "0px 6px 16px rgba(16,24,40,0.12), 0px 1px 3px rgba(16,24,40,0.08)",
} as const;

export const shadow = {
  low: ONE_SHADOW,
  medium: ONE_SHADOW,
  high: ONE_SHADOW,
  floating: ONE_SHADOW,
  card: ONE_SHADOW,
} as const;

// Opacity a plain Pressable row dims to while held. (Buttons use components/ui's press feedback.)
export const pressedOpacity = 0.7;

export { DESIGN_WIDTH, scaleFor } from "@/theme/scale";
