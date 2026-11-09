import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, shadow } from "@/theme/tokens";
import { MAP_MARKER_STYLE_ICONS, type MapMarkerStyleKey } from "@/utils/mapMarkerStyles";
import { shadeColor } from "@/utils/color";

// Real, professionally-drawn vector icons (react-native-svg), replacing the earlier photo-based
// markers -- per explicit request to move back to an app-designed look, and a real technical
// upside too: these are plain Views under the hood (an SVG element, not a raster <Image>), so
// the rotating nav marker sidesteps the documented react-native-maps iOS bug class where a
// custom Image marker's rotation stops updating live once tracksViewChanges is false (the exact
// issue the photo-based car hit) -- the original CSS-triangle puck used this same plain-View
// approach and never had that problem.

// Classic "navigation arrow" silhouette (point at the nose, a V-notch cut into the tail) --
// the same shape convention Google/Apple Maps' own live-navigation pucks use, not a plain
// triangle, so it reads as a real directional arrow at a glance rather than an abstract shape.
const ARROW_PATH = "M12 1.5 L21 21.5 L12 17 L3 21.5 Z";

/**
 * The live navigation puck -- rendered inside a Marker with flat + rotation={heading} by the
 * caller (see MapScreen.tsx), so this component itself never rotates on its own; it just draws
 * the stationary "nose up" glyph that rotation then turns to match the direction of travel.
 * `markerStyle` (see utils/mapMarkerStyles.ts) swaps the original hand-drawn SVG arrow for a
 * real vehicle icon inside the exact same rotating circular badge, per explicit request to let a
 * driver pick how they appear on the map -- "default" (the arrow) is completely unchanged, so
 * every existing user's marker looks identical to before this setting existed.
 */
export function CarNavArrow({ markerStyle = "default" }: { markerStyle?: MapMarkerStyleKey }) {
  const iconSpec = markerStyle !== "default" ? MAP_MARKER_STYLE_ICONS[markerStyle] : null;
  // Real, explicit request for a "more realistic, polished, professional" badge -- a single flat
  // fill colour read as a cheap placeholder. A real two-stop gradient (a lighter tint of the
  // vehicle's own colour at the top, its true colour at the bottom) plus a genuine glossy
  // highlight ellipse is the same "glossy pin" treatment real map-pin icon sets (Google Maps' own
  // coloured pins, for one) use for exactly this reason -- it reads as a deliberately designed,
  // dimensional badge instead of a flat coloured circle with an icon stamped on it.
  const baseColor = iconSpec?.color ?? colors.accent;
  const gradientColors = [shadeColor(baseColor, 0.28), baseColor, shadeColor(baseColor, -0.18)] as const;
  return (
    <View style={styles.navBadgeShadowWrap}>
      <LinearGradient
        colors={gradientColors}
        locations={[0, 0.55, 1]}
        style={styles.navBadge}
      >
        {/* Real glossy highlight -- an angled, soft-edged ellipse near the top, not a plain
            centered circle, so it reads as a light source catching a curved surface rather than
            a flat decal. */}
        <View style={styles.navBadgeHighlight} pointerEvents="none" />
        {iconSpec ? (
          <MaterialCommunityIcons name={iconSpec.name as any} size={20} color="#FFFFFF" />
        ) : (
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d={ARROW_PATH} fill="#FFFFFF" stroke={colors.accent} strokeWidth={1} strokeLinejoin="round" />
          </Svg>
        )}
      </LinearGradient>
    </View>
  );
}

/**
 * The plain (not navigating) live-location marker -- a dot with a white ring plus a soft halo,
 * the same "live tracking" visual language Google/Apple Maps' own blue dot uses. Deliberately a
 * static halo, not an animated pulse: this Marker renders with tracksViewChanges={false} (see
 * the render call site) for the same reliability reason CarNavArrow avoids raster Image
 * rotation -- react-native-maps only snapshots a tracksViewChanges={false} marker's content
 * once, so a looping Animated value inside it would just freeze at whatever frame got
 * snapshotted instead of actually animating on the map. Deliberately never rotated either (see
 * the render call site's own comment on why a walking/browsing position has no meaningful
 * facing direction the way a moving vehicle does).
 */
export function PersonLocationDot() {
  return (
    <View style={styles.personWrap}>
      <View style={styles.personHalo} pointerEvents="none" />
      <View style={styles.personDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Shadow lives on this outer, unclipped wrap -- RN shadows don't render through a clipped
  // (overflow:hidden) parent, which navBadge itself needs for the gradient/highlight to respect
  // its own rounded corners.
  navBadgeShadowWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    ...shadow.medium,
  },
  navBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  navBadgeHighlight: {
    position: "absolute",
    top: -14,
    left: -2,
    width: 38,
    height: 24,
    borderRadius: 19,
    transform: [{ rotate: "-18deg" }],
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  personWrap: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  personHalo: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    opacity: 0.18,
  },
  personDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    ...shadow.medium,
  },
});
