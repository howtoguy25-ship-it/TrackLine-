import React from "react";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { ALERT_ICONS, type AlertType } from "@/types/alert";
import { ALERT_ICON_THEMES } from "@/utils/alertIconThemes";
import { useSettings } from "@/context/SettingsContext";

interface Props {
  type: AlertType;
  size: number;
  // Overrides whatever the driver has actually picked in Settings -- only ever passed by the
  // theme picker UI itself, so it can render a live preview of a pack that isn't selected yet
  // without needing to actually change the setting first. Every real call site (map markers,
  // report sheet, detail sheet) omits this and gets the driver's real chosen theme instead.
  color: string;
  themeOverride?: import("@/utils/alertIconThemes").AlertIconThemeKey;
}

export function AlertTypeGlyph({ type, size, color, themeOverride }: Props) {
  const { settings } = useSettings();
  const theme = themeOverride ?? settings.alertIconTheme;

  if (theme !== "default") {
    const spec = ALERT_ICON_THEMES[theme][type];
    // Real, confirmed complaint: every non-default pack's preview swatch in Settings rendered
    // as a flat black/dark icon, none of the real distinct colors each pack actually defines
    // (see alertIconThemes.ts). Root cause -- this always used the incoming `color` prop, which
    // real on-map rendering deliberately passes as a fixed white (the icon sits on top of its
    // own colored circular pin there, from ALERT_COLORS -- see AlertMarker.tsx -- so it needs to
    // stay white for contrast regardless of which pack is picked). The Settings preview has no
    // colored pin behind it at all, so it needs the pack's own color to actually show anything
    // distinct. themeOverride is ONLY ever passed by that preview (see its own comment above),
    // never by real map/report/detail-sheet rendering, so it's the one safe, exact signal to
    // switch on here without touching the real on-map look at all.
    return (
      <MaterialCommunityIcons name={spec.name as any} size={size} color={themeOverride ? spec.color : color} />
    );
  }

  // MaterialIcons' own "car-crash" -- a real, dedicated crash glyph, not repurposed from a
  // different meaning -- lives in a separate glyph set from every other alert type's
  // MaterialCommunityIcons name, so it needs its own component, not just a different `name`.
  if (type === "crash") {
    return <MaterialIcons name="car-crash" size={size} color={color} />;
  }
  return <MaterialCommunityIcons name={ALERT_ICONS[type] as any} size={size} color={color} />;
}
