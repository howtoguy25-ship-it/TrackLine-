import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, G, Path, Polygon, Rect } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Text } from "@/components/AppText";
import { Icon } from "@/components/ui/Icon";
import { AlertTypeGlyph } from "@/components/AlertTypeGlyph";
import { THEME_PALETTES, ROAD_SCALES, type ThemeKey } from "@/map-v2/styles/buildStyle";
import { NAV_CARD_THEMES, type NavCardThemeKey } from "@/utils/navCardTheme";
import { MAP_MARKER_STYLE_ICONS, type MapMarkerStyleKey } from "@/utils/mapMarkerStyles";
import type { AlertIconThemeKey } from "@/utils/alertIconThemes";
import type { AlertType } from "@/types/alert";
import { shadeColor } from "@/utils/color";
import { BLUE, PURPLE, WHITE } from "@/theme/colors";

// Small pictures for Settings' visual pickers, drawn from the very colours each option uses on
// the real map (the theme palettes in map-v2/styles/buildStyle.ts, the card colours in
// navCardTheme.ts), so what's picked is what appears.

/** A mini map in a theme's own colours: land, a park, water, blocks, streets, a motorway. */
export function MapThemePreview({ theme, roadScale = 1 }: { theme: ThemeKey; roadScale?: number }) {
  const p = THEME_PALETTES[theme];
  const w = (n: number) => n * roadScale;
  return (
    <Svg width="100%" height="100%" viewBox="0 0 160 92" preserveAspectRatio="xMidYMid slice">
      <Rect x="0" y="0" width="160" height="92" fill={p.land} />
      <Path d="M0 70 C30 60 55 80 90 72 S140 60 160 66 L160 92 L0 92 Z" fill={p.water} />
      <Rect x="104" y="8" width="44" height="30" rx="6" fill={p.park} />
      <G fill={p.building}>
        <Rect x="12" y="10" width="22" height="14" rx="2" />
        <Rect x="40" y="10" width="18" height="14" rx="2" />
        <Rect x="12" y="32" width="20" height="16" rx="2" />
        <Rect x="66" y="36" width="24" height="14" rx="2" />
      </G>
      {/* streets: casing then fill */}
      <G stroke={p.roadCasing} strokeWidth={w(7)} strokeLinecap="round" fill="none">
        <Path d="M0 28 L160 28" />
        <Path d="M62 0 L62 92" />
      </G>
      <G stroke={p.road} strokeWidth={w(5)} strokeLinecap="round" fill="none">
        <Path d="M0 28 L160 28" />
        <Path d="M62 0 L62 92" />
      </G>
      <Path d="M0 54 C40 50 90 58 160 46" stroke={p.roadCasing} strokeWidth={w(10)} fill="none" strokeLinecap="round" />
      <Path d="M0 54 C40 50 90 58 160 46" stroke={p.motorway} strokeWidth={w(7.5)} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** Road thickness: the same mini map with its roads at that setting's real scale. */
export function RoadThicknessPreview({ thickness, theme }: { thickness: keyof typeof ROAD_SCALES; theme: ThemeKey }) {
  return <MapThemePreview theme={theme} roadScale={ROAD_SCALES[thickness] * (thickness === "extraBold" ? 1.15 : 1)} />;
}

/** A small turn card in a card theme's colours: arrow tile, distance, street. */
export function NavCardPreview({ theme }: { theme: NavCardThemeKey }) {
  const t = NAV_CARD_THEMES[theme];
  return (
    <View style={[styles.navBack]}>
      <View style={[styles.navCard, { backgroundColor: t.background }]}>
        <View style={[styles.navIcon, { backgroundColor: t.iconWrapBg }]}>
          <Icon name="turn-right" size={18} color={t.iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.navDistance, { color: t.text }]}>200 m</Text>
          <Text style={[styles.navStreet, { color: t.textSecondary }]} numberOfLines={1}>
            George St
          </Text>
        </View>
      </View>
    </View>
  );
}

/** The three default map views as small drawings. */
export function MapViewPreview({ view }: { view: "tilted3d" | "flat" | "satellite3d" }) {
  const p = THEME_PALETTES.light;
  if (view === "flat") {
    return (
      <Svg width="100%" height="100%" viewBox="0 0 100 80" preserveAspectRatio="xMidYMid slice">
        <Rect width="100" height="80" fill={p.land} />
        <G fill={p.building}>
          <Rect x="8" y="8" width="24" height="20" rx="2" />
          <Rect x="60" y="8" width="30" height="20" rx="2" />
          <Rect x="8" y="50" width="24" height="22" rx="2" />
          <Rect x="60" y="50" width="30" height="22" rx="2" />
        </G>
        <Path d="M0 39 L100 39 M45 0 L45 80" stroke={p.road} strokeWidth="7" />
        <Path d="M45 72 L45 46" stroke={PURPLE} strokeWidth="4" strokeLinecap="round" />
        <Polygon points="45,36 40,47 45,44 50,47" fill={BLUE} />
      </Svg>
    );
  }
  if (view === "tilted3d") {
    return (
      <Svg width="100%" height="100%" viewBox="0 0 100 80" preserveAspectRatio="xMidYMid slice">
        <Rect width="100" height="80" fill="#DCE6F2" />
        <Polygon points="0,80 100,80 80,22 20,22" fill={p.land} />
        <Polygon points="44,80 56,80 52,22 48,22" fill={p.road} />
        <Polygon points="10,52 90,52 86,42 14,42" fill={p.road} />
        {/* buildings rising */}
        <Polygon points="16,40 30,40 30,28 16,28" fill={p.building} stroke="#C9CDD2" strokeWidth="0.6" />
        <Polygon points="66,40 82,40 82,24 66,24" fill={p.building} stroke="#C9CDD2" strokeWidth="0.6" />
        <Path d="M50 76 L50 56" stroke={PURPLE} strokeWidth="4" strokeLinecap="round" />
        <Polygon points="50,62 45,73 50,70 55,73" fill={BLUE} />
      </Svg>
    );
  }
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 80" preserveAspectRatio="xMidYMid slice">
      <Rect width="100" height="80" fill="#3D5A3B" />
      <Polygon points="0,80 100,80 80,22 20,22" fill="#56704B" />
      <Rect x="0" y="0" width="100" height="22" fill="#8FB3D9" />
      <Polygon points="44,80 56,80 52,22 48,22" fill="#7C7F80" />
      <Polygon points="18,44 32,44 32,30 18,30" fill="#B9B4A8" />
      <Polygon points="64,46 80,46 80,28 64,28" fill="#A7A196" />
      <Circle cx="28" cy="62" r="5" fill="#2E4A2C" />
      <Circle cx="72" cy="66" r="6" fill="#2E4A2C" />
      <Polygon points="50,62 45,73 50,70 55,73" fill={BLUE} />
    </Svg>
  );
}

/** The map marker: the same gradient badge the map draws, or the default arrow. */
export function MarkerPreview({ style, background }: { style: MapMarkerStyleKey; background: string }) {
  const spec = style !== "default" ? MAP_MARKER_STYLE_ICONS[style] : null;
  return (
    <View style={[styles.center, { backgroundColor: background }]}>
      {spec ? (
        <LinearGradient colors={[shadeColor(spec.color, 0.28), spec.color, shadeColor(spec.color, -0.18)]} locations={[0, 0.55, 1]} style={styles.markerBadge}>
          <MaterialCommunityIcons name={spec.name as never} size={24} color={WHITE} />
        </LinearGradient>
      ) : (
        <View style={[styles.markerBadge, { backgroundColor: BLUE }]}>
          <Icon name="navigate" size={22} color={WHITE} />
        </View>
      )}
    </View>
  );
}

const ALERT_PREVIEW_TYPES: AlertType[] = ["police", "crash", "hazard", "traffic_light"];

/** An alert icon pack: four of its icons on a map-coloured tile. */
export function AlertPackPreview({ theme, background, glyph }: { theme: AlertIconThemeKey; background: string; glyph: string }) {
  return (
    <View style={[styles.center, styles.alertRow, { backgroundColor: background }]}>
      {ALERT_PREVIEW_TYPES.map((type) => (
        <AlertTypeGlyph key={type} type={type} size={20} color={glyph} themeOverride={theme} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  navBack: { flex: 1, backgroundColor: THEME_PALETTES.light.land, padding: 10, justifyContent: "center" },
  navCard: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 8 },
  navIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  navDistance: { fontSize: 15, fontWeight: "700" },
  navStreet: { fontSize: 12, fontWeight: "500" },
  markerBadge: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  alertRow: { flexDirection: "row", gap: 8 },
});
