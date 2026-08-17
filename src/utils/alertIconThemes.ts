import type { AlertType } from "@/types/alert";

/**
 * Selectable alert-icon packs -- per explicit request to let a driver pick how alerts look on
 * the map, the same way mapStyle.ts/navCardTheme.ts already let them pick a map color theme and
 * a nav-card color theme. Every glyph here is a real MaterialCommunityIcons name (verified
 * against the installed glyphmap, not guessed) rather than custom art -- this app has no way to
 * source or license a hand-drawn 3D icon set, so each pack differentiates itself with a genuinely
 * different real vector glyph + color pairing per alert type instead. "default" is byte-identical
 * to the app's original, single hardcoded icon set (see AlertTypeGlyph.tsx's own emoji/MaterialIcons
 * special cases, still honored only for this theme) -- picking it is a true no-op for every
 * existing user.
 */
export type AlertIconThemeKey = "default" | "outline" | "bold" | "shield" | "vivid" | "night";

export const ALERT_ICON_THEME_LABELS: Record<AlertIconThemeKey, string> = {
  default: "Default",
  outline: "Outline",
  bold: "Bold",
  shield: "Shield",
  vivid: "Vivid",
  night: "Night",
};

export interface AlertIconSpec {
  name: string; // MaterialCommunityIcons glyph name
  color: string;
}

// "default" intentionally omitted here -- AlertTypeGlyph.tsx keeps its own original special-case
// logic (the police emoji, MaterialIcons' separate car-crash glyph) for that one theme so nothing
// about the app's existing look changes for a user who never opens this setting.
export const ALERT_ICON_THEMES: Record<Exclude<AlertIconThemeKey, "default">, Record<AlertType, AlertIconSpec>> = {
  outline: {
    police: { name: "police-badge-outline", color: "#2563EB" },
    emergency_vehicle: { name: "ambulance", color: "#DC2626" },
    hazard: { name: "alert-outline", color: "#F59E0B" },
    camera: { name: "camera-outline", color: "#7C3AED" },
    crash: { name: "car-brake-alert", color: "#EA580C" },
    traffic_light: { name: "traffic-light-outline", color: "#0D9488" },
  },
  bold: {
    police: { name: "shield-star", color: "#1D4ED8" },
    emergency_vehicle: { name: "car-emergency", color: "#DC2626" },
    hazard: { name: "alert-decagram", color: "#F59E0B" },
    camera: { name: "cctv", color: "#7C3AED" },
    crash: { name: "car-multiple", color: "#EA580C" },
    traffic_light: { name: "traffic-light", color: "#0D9488" },
  },
  shield: {
    police: { name: "shield-alert", color: "#0EA5E9" },
    emergency_vehicle: { name: "ambulance", color: "#F43F5E" },
    hazard: { name: "traffic-cone", color: "#FB923C" },
    camera: { name: "camera", color: "#A855F7" },
    crash: { name: "shield-star-outline", color: "#F97316" },
    traffic_light: { name: "traffic-light", color: "#14B8A6" },
  },
  vivid: {
    police: { name: "police-station", color: "#3B82F6" },
    emergency_vehicle: { name: "car-emergency", color: "#EF4444" },
    hazard: { name: "alert-rhombus", color: "#FACC15" },
    camera: { name: "camera-iris", color: "#D946EF" },
    crash: { name: "car-multiple", color: "#FB923C" },
    traffic_light: { name: "traffic-light", color: "#22D3EE" },
  },
  night: {
    police: { name: "shield-sun", color: "#93C5FD" },
    emergency_vehicle: { name: "ambulance", color: "#FCA5A5" },
    hazard: { name: "alert-box-outline", color: "#FDE68A" },
    camera: { name: "cctv-off", color: "#C4B5FD" },
    crash: { name: "car-back", color: "#FDBA74" },
    traffic_light: { name: "traffic-light-outline", color: "#5EEAD4" },
  },
};
