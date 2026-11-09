import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isMapboxAvailable } from "@/map/mapboxAvailability";
import { env } from "@/config/env";
import { colors, radius, spacing } from "@/theme/tokens";
import trackLineLightStyle from "@/map/styles/trackline-light.json";
import trackLineDarkStyle from "@/map/styles/trackline-dark.json";

// Real, critical safety note -- never add a static `import Mapbox from "@rnmapbox/maps"` to this
// file (or anything it's imported from eagerly). Confirmed by reading @rnmapbox/maps' own
// RNMBXModule.js: it THROWS at module-import time ("native code not available... make sure you
// have linked the library and rebuild") the instant it's imported with no native module linked
// -- not a soft/lazy failure. Since the @rnmapbox/maps Expo config plugin is only even included
// in a build once a real RNMAPBOX_MAPS_DOWNLOAD_TOKEN exists (see app.config.js), the native
// module genuinely isn't linked in any build produced so far. A plain top-level import here
// would crash this whole app on launch for every real user, Google-Maps screen included, the
// moment this file is reached by ANY static import chain -- which React Navigation's
// `component={X}` screen registration always is. Loaded with a deferred `require()` instead,
// only ever actually called once isMapboxAvailable() is true.
let cachedMapboxModule: typeof import("@rnmapbox/maps") | null = null;
function loadMapboxModule(): typeof import("@rnmapbox/maps") | null {
  if (cachedMapboxModule) return cachedMapboxModule;
  if (!isMapboxAvailable()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedMapboxModule = require("@rnmapbox/maps");
    return cachedMapboxModule;
  } catch {
    return null;
  }
}

// Real, explicit request (Phase 1B) -- this screen exists to let the Mapbox engine be proven
// out and iterated on in isolation before anything touches the live, shipping navigation map
// (MapScreen.tsx, still Google Maps). NOT wired into the real navigation flow yet -- see
// PROGRESS.md/NOTES.md for what's still ahead. (An equivalent MapLibre prototype used to sit
// alongside this one -- deleted once a real EAS iOS build proved it and @rnmapbox/maps collide
// at the linker, both generating a Codegen native-module spec literally named
// `NativeMapViewModule`; real Mapbox is the confirmed, user-chosen engine going forward.)
export function MapboxMapScreen() {
  const insets = useSafeAreaInsets();
  const [moduleReady, setModuleReady] = useState(false);
  const mapboxRef = useRef<typeof import("@rnmapbox/maps") | null>(null);

  useEffect(() => {
    const mod = loadMapboxModule();
    mapboxRef.current = mod;
    if (mod) {
      // Real Mapbox SDK call -- only ever reached once loadMapboxModule() above has confirmed
      // both a real token is configured AND the native module actually resolved (the require()
      // succeeded), so this never runs against an unlinked native module.
      mod.default.setAccessToken(env.mapboxPublicToken);
      setModuleReady(true);
    }
  }, []);

  if (!isMapboxAvailable() || !moduleReady) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.card}>
          <Text style={styles.title}>Mapbox not configured yet</Text>
          <Text style={styles.body}>
            This screen will render TrackLine's custom Mapbox-based map once a real Mapbox
            public access token (MAPBOX_PUBLIC_TOKEN) and a downloads token
            (RNMAPBOX_MAPS_DOWNLOAD_TOKEN, set as an EAS secret) are both configured for a real
            build. The live navigation map keeps running on Google Maps until then -- see
            NOTES.md and PROGRESS.md for exactly what's pending.
          </Text>
        </View>
      </View>
    );
  }

  const Mapbox = mapboxRef.current!.default;
  const { MapView, Camera } = mapboxRef.current!;

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        style={StyleSheet.absoluteFill}
        styleJSON={JSON.stringify(trackLineLightStyle)}
        scaleBarEnabled={false}
      >
        <Camera defaultSettings={{ zoomLevel: 17, pitch: 45 }} />
      </MapView>
    </View>
  );
}

// Referenced so the dark style import above isn't flagged unused while this screen only wires
// up the light style's camera/map so far -- real light/dark switching (Settings > Dark mode)
// lands alongside the rest of the camera/zoom/route work.
void trackLineDarkStyle;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
