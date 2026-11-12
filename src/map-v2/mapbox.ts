import { NativeModules } from "react-native";
import { env } from "@/config/env";

// Loads @rnmapbox/maps only when it can actually work. Its JS module throws at import time if
// the native SDK isn't in the build (the native SDK is only linked when
// RNMAPBOX_MAPS_DOWNLOAD_TOKEN was set at build time -- see app.config.js), so nothing may
// import it statically. Everything in src/map-v2 gets it from here.

type MapboxModule = typeof import("@rnmapbox/maps");

let loaded: MapboxModule | null | undefined;

export function isMapboxNativeLinked(): boolean {
  try {
    // The same check @rnmapbox/maps itself makes before throwing.
    return NativeModules.RNMBXModule != null;
  } catch {
    return false;
  }
}

/** The Mapbox module, ready to use (token set), or null if this build can't run it. */
export function loadMapbox(): MapboxModule | null {
  if (loaded !== undefined) return loaded;
  if (!env.mapboxPublicToken || !isMapboxNativeLinked()) {
    loaded = null;
    return loaded;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: MapboxModule = require("@rnmapbox/maps");
    mod.default.setAccessToken(env.mapboxPublicToken);
    // No Mapbox usage telemetry from drivers' phones.
    mod.default.setTelemetryEnabled?.(false);
    loaded = mod;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Whether the Mapbox map can be shown in this build. */
export function isMapboxUsable(): boolean {
  return loadMapbox() !== null;
}
