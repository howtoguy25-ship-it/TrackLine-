// Map styles add-on §3: a live map in the chosen style, at your last position (Sydney before any
// fix), above the theme picker. It's the real map component's style -- same generator, same
// tiles -- just not interactive. Where the map can't run (no Mapbox in this build), the theme's
// rendered preview shows instead, and says so.
import React, { useMemo } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { isMapboxUsable, loadMapbox } from "@/map-v2/mapbox";
import { styleFor } from "@/map-v2/TrackLineMap";
import type { ROAD_SCALES, ThemeKey } from "@/map-v2/styles/buildStyle";
import { THEME_PREVIEW_IMAGES } from "@/map-v2/themePreviews";
import { lastKnownPosition } from "@/map/nightClock";
import { useSettingsColours } from "@/components/settings/settingsScheme";
import { radius } from "@/theme/tokens";

const SYDNEY = { latitude: -33.8705, longitude: 151.2075 };

export function LiveMapPreview({ theme, roadThickness, label }: { theme: ThemeKey; roadThickness: keyof typeof ROAD_SCALES; label: string }) {
  const c = useSettingsColours();
  const at = lastKnownPosition() ?? SYDNEY;
  const Mapbox = isMapboxUsable() ? loadMapbox() : null;
  const styleJSON = useMemo(() => (Mapbox ? styleFor(theme, roadThickness, false, false) : ""), [Mapbox, theme, roadThickness]);
  return (
    <View style={[styles.box, { borderColor: c.separator }]} testID="live-map-preview">
      {Mapbox ? (
        <Mapbox.MapView
          style={StyleSheet.absoluteFill}
          styleJSON={styleJSON}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
          logoPosition={{ bottom: 6, left: 6 }}
          attributionPosition={{ bottom: 6, right: 6 }}
        >
          <Mapbox.Camera defaultSettings={{ centerCoordinate: [at.longitude, at.latitude], zoomLevel: 14 }} />
        </Mapbox.MapView>
      ) : (
        <Image source={THEME_PREVIEW_IMAGES[theme]} style={StyleSheet.absoluteFill} resizeMode="cover" testID="live-map-preview-fallback" />
      )}
      <View style={styles.tag} pointerEvents="none">
        <Text style={styles.tagText}>{Mapbox ? `Live · ${label}` : `${label} · preview (map not available in this build)`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 160, borderRadius: radius.lg, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth * 2, marginHorizontal: 16, marginBottom: 12 },
  tag: { position: "absolute", left: 8, top: 8, backgroundColor: "rgba(17,17,17,0.72)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  tagText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
});
