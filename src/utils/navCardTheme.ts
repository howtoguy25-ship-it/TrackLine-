/**
 * Color themes for the navigation instruction card (see NavigationInstructionCard.tsx) --
 * separate from the map's own color themes (mapStyle.ts), this only recolors the card itself.
 * Picked in Settings. Expanded per explicit request for more real color variety (the original
 * "aqua" teal-background/yellow-text combo is gone, replaced with several new richer themes) and
 * a genuine "transparent dark" preset (transparentDark) that starts translucent by default --
 * previously that look only existed behind the card's own manual transparency toggle, on top of
 * whichever theme was picked.
 */
export type NavCardThemeKey = "dark" | "light" | "transparentDark" | "midnight" | "sunset" | "forest";

export const NAV_CARD_THEME_LABELS: Record<NavCardThemeKey, string> = {
  dark: "Black & White",
  light: "White & Black",
  transparentDark: "Transparent Dark",
  midnight: "Midnight Blue",
  sunset: "Sunset",
  forest: "Forest",
};

export interface NavCardThemeColors {
  background: string;
  // Same background color at reduced opacity, used when the transparency toggle is on -- the
  // map/live camera behind the card stays visible through it. textShadowColor below is what
  // keeps text readable at this opacity, not the background alone.
  backgroundTransparent: string;
  // True only for "transparentDark" -- the card STARTS in its own transparent state rather than
  // requiring the manual eye-icon toggle first, a real, dedicated "always see-through" preset
  // rather than something only reachable as a side effect of another theme.
  startsTransparent?: boolean;
  text: string;
  textSecondary: string;
  // Opposite-toned shadow behind every piece of text -- gives real legibility over whatever
  // varied, uncontrolled map/video content shows through when the card is transparent, and a
  // subtle depth even at full opacity.
  textShadowColor: string;
  iconWrapBg: string;
  iconColor: string;
  actionBg: string;
  actionText: string;
  exitButtonBg: string;
  exitButtonIcon: string;
  toggleBg: string;
  toggleIcon: string;
}

export const NAV_CARD_THEMES: Record<NavCardThemeKey, NavCardThemeColors> = {
  dark: {
    background: "#111827",
    backgroundTransparent: "rgba(17,24,39,0.38)",
    text: "#FFFFFF",
    textSecondary: "#D1D5DB",
    textShadowColor: "rgba(0,0,0,0.85)",
    iconWrapBg: "#2563EB",
    iconColor: "#FFFFFF",
    actionBg: "rgba(255,255,255,0.08)",
    actionText: "#FFFFFF",
    exitButtonBg: "#FFFFFF",
    exitButtonIcon: "#111827",
    toggleBg: "rgba(255,255,255,0.14)",
    toggleIcon: "#FFFFFF",
  },
  light: {
    background: "#FFFFFF",
    backgroundTransparent: "rgba(255,255,255,0.42)",
    text: "#111827",
    textSecondary: "#374151",
    textShadowColor: "rgba(255,255,255,0.9)",
    iconWrapBg: "#2563EB",
    iconColor: "#FFFFFF",
    actionBg: "rgba(17,24,39,0.06)",
    actionText: "#111827",
    exitButtonBg: "#111827",
    exitButtonIcon: "#FFFFFF",
    toggleBg: "rgba(17,24,39,0.08)",
    toggleIcon: "#111827",
  },
  transparentDark: {
    background: "rgba(10,14,24,0.55)",
    backgroundTransparent: "rgba(10,14,24,0.28)",
    startsTransparent: true,
    text: "#FFFFFF",
    textSecondary: "#CBD5E1",
    textShadowColor: "rgba(0,0,0,0.9)",
    iconWrapBg: "#38BDF8",
    iconColor: "#0A0E18",
    actionBg: "rgba(255,255,255,0.1)",
    actionText: "#FFFFFF",
    exitButtonBg: "#FFFFFF",
    exitButtonIcon: "#0A0E18",
    toggleBg: "rgba(255,255,255,0.16)",
    toggleIcon: "#FFFFFF",
  },
  midnight: {
    background: "#1E1B4B",
    backgroundTransparent: "rgba(30,27,75,0.4)",
    text: "#E0E7FF",
    textSecondary: "#A5B4FC",
    textShadowColor: "rgba(0,0,0,0.85)",
    iconWrapBg: "#6366F1",
    iconColor: "#FFFFFF",
    actionBg: "rgba(224,231,255,0.1)",
    actionText: "#E0E7FF",
    exitButtonBg: "#E0E7FF",
    exitButtonIcon: "#1E1B4B",
    toggleBg: "rgba(224,231,255,0.16)",
    toggleIcon: "#E0E7FF",
  },
  sunset: {
    background: "#431407",
    backgroundTransparent: "rgba(67,20,7,0.4)",
    text: "#FED7AA",
    textSecondary: "#FDBA74",
    textShadowColor: "rgba(0,0,0,0.85)",
    iconWrapBg: "#EA580C",
    iconColor: "#FFFFFF",
    actionBg: "rgba(254,215,170,0.12)",
    actionText: "#FED7AA",
    exitButtonBg: "#FED7AA",
    exitButtonIcon: "#431407",
    toggleBg: "rgba(254,215,170,0.18)",
    toggleIcon: "#FED7AA",
  },
  forest: {
    background: "#052E16",
    backgroundTransparent: "rgba(5,46,22,0.4)",
    text: "#BBF7D0",
    textSecondary: "#86EFAC",
    textShadowColor: "rgba(0,0,0,0.85)",
    iconWrapBg: "#16A34A",
    iconColor: "#FFFFFF",
    actionBg: "rgba(187,247,208,0.12)",
    actionText: "#BBF7D0",
    exitButtonBg: "#BBF7D0",
    exitButtonIcon: "#052E16",
    toggleBg: "rgba(187,247,208,0.18)",
    toggleIcon: "#BBF7D0",
  },
};
