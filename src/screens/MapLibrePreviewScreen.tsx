import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Map, Camera, type CameraRef, UserLocation } from "@maplibre/maplibre-react-native";
import { useLocation } from "@/context/LocationContext";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import { bearingDegrees, distanceKm } from "@/utils/geo";

import trackLineLightStyle from "../../assets/mapStyles/trackline-light.json";
import trackLineDarkStyle from "../../assets/mapStyles/trackline-dark.json";
import trackLineSatelliteStyle from "../../assets/mapStyles/trackline-satellite.json";

// Phase 1 prototype only -- a standalone screen proving out a custom MapLibre + OpenStreetMap
// (OpenFreeMap "liberty" tiles, recolored to TrackLine's brand palette) vector map with real 3D
// buildings, completely separate from the live navigation map (MapScreen.tsx, react-native-maps/
// Google Maps), which this does not touch or replace. Reachable from Settings (owner-only) so it
// can be reviewed in a real build -- Expo Go can't load it since it's a native module.

// No live GPS fix yet (e.g. permission not granted, or just-opened before the first fix lands) --
// Sydney CBD, the same real coordinates this style was verified against during development.
const FALLBACK_CENTER: [number, number] = [151.2093, -33.8688];

type ViewStyle = "tilted3d" | "flat" | "satellite3d";

const VIEW_STYLE_OPTIONS: { key: ViewStyle; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { key: "tilted3d", label: "3D tilted", icon: "rotate-3d-variant" },
  { key: "flat", label: "Overhead", icon: "square-outline" },
  { key: "satellite3d", label: "Satellite", icon: "satellite-variant" },
];

export function MapLibrePreviewScreen() {
  const systemScheme = useColorScheme();
  const { location } = useLocation();
  const [isDark, setIsDark] = useState(systemScheme === "dark");
  const [viewStyle, setViewStyle] = useState<ViewStyle>("tilted3d");
  const cameraRef = useRef<CameraRef>(null);

  // Satellite is its own single style (real imagery + road/label overlay) -- the light/dark
  // vector recolor only applies to the two plain vector modes.
  const mapStyle =
    viewStyle === "satellite3d" ? trackLineSatelliteStyle : isDark ? trackLineDarkStyle : trackLineLightStyle;
  const center = useMemo<[number, number]>(
    () => (location ? [location.coords.longitude, location.coords.latitude] : FALLBACK_CENTER),
    [location]
  );

  const pitchForStyle = (style: ViewStyle) => (style === "flat" ? 0 : 50);
  const zoomForStyle = (style: ViewStyle) => (style === "flat" ? 17 : 17.5);

  // Same real heading-derivation pattern already proven in the live navigation map
  // (MapScreen.tsx) -- GPS "course" heading is commonly -1 ("invalid") at low speed or right
  // after a stop, so this falls back to the bearing between the last two real GPS fixes instead
  // of snapping to "facing north" and sitting there through a turn.
  const derivedHeadingRef = useRef(0);
  const prevLatLngRef = useRef<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    if (!location) return;
    const { latitude, longitude } = location.coords;
    const prev = prevLatLngRef.current;
    prevLatLngRef.current = { latitude, longitude };
    if (!prev) return;
    const movedMeters = distanceKm(prev.latitude, prev.longitude, latitude, longitude) * 1000;
    if (movedMeters < 3) return;
    derivedHeadingRef.current = bearingDegrees(prev.latitude, prev.longitude, latitude, longitude);
  }, [location]);

  const heading =
    location?.coords.heading != null && location.coords.heading >= 0
      ? location.coords.heading
      : derivedHeadingRef.current;

  // Real "heading to destination" nav-camera behavior -- the camera rotates to face the real
  // direction of travel (the same convention Waze/Google Maps use) instead of staying locked
  // north-up, and keeps re-centering on every real GPS fix. Only live while a real heading signal
  // exists (device moving); stationary, the camera just holds its last position/bearing instead
  // of spinning on GPS jitter.
  useEffect(() => {
    if (!location) return;
    cameraRef.current?.easeTo({
      center,
      bearing: heading,
      pitch: pitchForStyle(viewStyle),
      zoom: zoomForStyle(viewStyle),
      duration: 400,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewStyle changes are also handled
    // (with their own animation) by onViewStyleSelect below; this effect should only re-fire on a
    // real new position/heading, not re-run and fight that dedicated transition.
  }, [center, heading]);

  const onViewStyleSelect = (next: ViewStyle) => {
    setViewStyle(next);
    cameraRef.current?.easeTo({
      center,
      bearing: heading,
      // 60deg pitch looked striking in a still screenshot but fell apart on real adjacent
      // buildings of similar height -- their near-edge-on side walls at that steep an angle
      // create a moire/hatching artifact (verified by re-rendering the same real Sydney data at
      // several pitches), reading as flattened/"squashed" instead of solid standing towers. 50deg
      // is still a clear tilted 3D view but keeps buildings reading as real upright volumes.
      pitch: pitchForStyle(next),
      zoom: zoomForStyle(next),
      duration: 500,
    });
  };

  return (
    <View style={styles.root}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- mapStyle accepts a
          StyleSpecification object; the imported JSON's loose string types (e.g. a "line" literal
          read back as `string`) don't line up with maplibre-gl-style-spec's exact union types */}
      <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle as any} logo={false} attribution>
        <Camera ref={cameraRef} initialViewState={{ center, zoom: 17.5, pitch: 50, bearing: 0 }} />
        <UserLocation />
      </Map>

      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>Custom map preview</Text>
        <Text style={styles.topBarSubtitle}>MapLibre + OpenStreetMap -- not the live navigation map</Text>
      </View>

      <View style={styles.controls}>
        <View style={styles.pillRow}>
          {VIEW_STYLE_OPTIONS.map((option) => {
            const selected = viewStyle === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => onViewStyleSelect(option.key)}
                style={({ pressed }) => [
                  styles.pill,
                  selected && styles.pillSelected,
                  pressed && { opacity: pressedOpacity },
                ]}
              >
                <MaterialCommunityIcons
                  name={option.icon}
                  size={16}
                  color={selected ? colors.surface : colors.text}
                />
                <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {viewStyle !== "satellite3d" && (
          <Pressable
            onPress={() => setIsDark((d) => !d)}
            style={({ pressed }) => [styles.themeToggle, pressed && { opacity: pressedOpacity }]}
          >
            <MaterialCommunityIcons name={isDark ? "weather-night" : "weather-sunny"} size={18} color={colors.text} />
            <Text style={styles.themeToggleText}>{isDark ? "Dark" : "Light"}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  topBar: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadow.medium,
  },
  topBarTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  topBarSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  controls: {
    position: "absolute",
    bottom: spacing.xl,
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  pillRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xs,
    gap: spacing.xs,
    ...shadow.medium,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  pillSelected: { backgroundColor: colors.accent },
  pillText: { fontSize: 13, fontWeight: "600", color: colors.text },
  pillTextSelected: { color: colors.surface },
  themeToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadow.medium,
  },
  themeToggleText: { fontSize: 13, fontWeight: "600", color: colors.text },
});
