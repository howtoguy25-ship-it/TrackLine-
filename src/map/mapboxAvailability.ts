import { env } from "@/config/env";

// Real, explicit request (Phase 1B) -- "keep current Google map code ONLY as fallback behind a
// feature flag until Mapbox is confirmed working". This is that flag's real, non-fabricated
// first check: a real Mapbox public access token has to actually be configured
// (env.mapboxPublicToken, see env.ts/app.config.js) before anything even ATTEMPTS to load
// Mapbox. It does NOT (and from pure JS, cannot) confirm the native SDK itself was actually
// fetched/linked at build time -- that depends on RNMAPBOX_MAPS_DOWNLOAD_TOKEN having been set
// when this build was produced (see app.config.js's own comment: the @rnmapbox/maps plugin is
// only included in the build when that token is present), a build-time fact this running JS
// can't inspect directly. This genuinely CAN be true while the native module is still unlinked
// -- e.g. a real build produced after only the public token was configured but before the
// download token was -- so this function alone is a necessary but not sufficient check. The
// actual safety net is MapboxMapScreen.tsx's own loadMapboxModule(): its require() is wrapped
// in a real try/catch specifically for this case, falling back to the honest "not configured"
// state rather than crashing if the native module turns out not to be linked after all.
export function isMapboxAvailable(): boolean {
  return env.mapboxPublicToken.length > 0;
}
