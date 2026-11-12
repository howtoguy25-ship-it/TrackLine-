import { env } from "@/config/env";

/**
 * USE_MAPBOX: draw the home/navigation map with the new Mapbox map (src/map-v2) instead of the
 * old Google map. On by default in development builds so the two can be compared;
 * EXPO_PUBLIC_USE_MAPBOX=1 / 0 forces it either way. The Mapbox map also needs its native SDK
 * and token (see mapbox.ts) -- without them the old map is used, whatever this says.
 */
export const USE_MAPBOX: boolean = env.useMapbox === "1" ? true : env.useMapbox === "0" ? false : __DEV__;
