import React from "react";
import {
  ACTIONS,
  BLUE_TEXT,
  GREEN_TEXT,
  GREEN_TEXT_DARK,
  INK,
  LIGHT_GREY,
  RED_SOFT,
  RED_SOFT_DARK,
  RED_TEXT,
  RED_TEXT_DARK,
  SELECTED_TINT,
  SURFACES,
  WHITE,
  type Scheme,
} from "@/theme/colors";

// Light or dark for one part of the screen. The sheets and cards that sit on the map (the
// "Where to?" sheet and search, route selection, the place page, the street pill) wrap
// themselves in <SurfaceScheme value={mapScheme}>, so with the map in its Dark theme they go
// dark with it. Inside, the app's Text, TextInput, Icon and the surface-aware View/Pressable
// (components/ui/Surface.tsx) swap each light-theme colour for its dark counterpart from the
// tables below; anything not in a table (white text on a blue button, a category's own colour)
// is left alone. Full screens aren't wrapped, so they stay as designed.
//
// Nothing here imports React Native, so the tables are checked for contrast directly
// (__tests__/design/colours.test.ts).

export const SurfaceSchemeContext = React.createContext<Scheme>("light");

export function SurfaceScheme({ value, children }: { value: Scheme; children: React.ReactNode }) {
  return React.createElement(SurfaceSchemeContext.Provider, { value }, children);
}

const DARK = SURFACES.dark;

/** Text and icon colours: light theme -> dark theme. */
export const DARK_TEXT: Record<string, string> = {
  [INK]: DARK.text,
  [SURFACES.light.textMuted]: DARK.textMuted,
  [SURFACES.light.textFaint]: DARK.textFaint,
  "#8A8F98": DARK.textFaint,
  [BLUE_TEXT]: ACTIONS.dark.alternative.on,
  [RED_TEXT]: RED_TEXT_DARK,
  [GREEN_TEXT]: GREEN_TEXT_DARK,
  "#A35F00": "#F5A623",
  "#111827": DARK.text,
  "#374151": DARK.textMuted,
  "#6B7280": DARK.textMuted,
  "#9CA3AF": DARK.textFaint,
};

/** Background and border colours: light theme -> dark theme. */
export const DARK_SURFACE: Record<string, string> = {
  [WHITE]: DARK.sheet,
  "#FFF": DARK.sheet,
  [LIGHT_GREY]: DARK.muted,
  "#F4F5F8": DARK.raised,
  "#F3F4F6": DARK.raised,
  "#F9FAFB": DARK.raised,
  "#E9EAEE": DARK.raised,
  [SURFACES.light.divider]: DARK.divider,
  "#E5E7EB": DARK.divider,
  "#DADDE2": "#3A3D42",
  [SELECTED_TINT.light]: SELECTED_TINT.dark,
  [RED_SOFT]: RED_SOFT_DARK,
};

function lookup(table: Record<string, string>, colour: unknown): unknown {
  if (typeof colour !== "string") return colour;
  return table[colour.toUpperCase()] ?? table[colour] ?? colour;
}

export function darkText(colour: unknown): unknown {
  return lookup(DARK_TEXT, colour);
}

export function darkSurface(colour: unknown): unknown {
  return lookup(DARK_SURFACE, colour);
}

const SURFACE_KEYS = [
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderRightColor",
] as const;

/** The overrides a flattened View style needs in the dark scheme (null when none). */
export function darkSurfaceOverrides(flat: Record<string, unknown> | undefined | null): Record<string, unknown> | null {
  if (!flat) return null;
  let out: Record<string, unknown> | null = null;
  for (const key of SURFACE_KEYS) {
    const v = flat[key];
    const mapped = darkSurface(v);
    if (mapped !== v) (out ??= {})[key] = mapped;
  }
  return out;
}

/** The overrides a flattened Text style needs in the dark scheme (null when none). */
export function darkTextOverrides(flat: Record<string, unknown> | undefined | null): Record<string, unknown> | null {
  if (!flat) return null;
  const mapped = darkText(flat.color);
  const bg = darkSurface(flat.backgroundColor);
  if (mapped === flat.color && bg === flat.backgroundColor) return null;
  return { color: mapped, ...(bg !== flat.backgroundColor ? { backgroundColor: bg } : {}) };
}
