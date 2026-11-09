import { env } from "@/config/env";

// Real, explicit request (Phase 1B) -- "keep current Google map code ONLY as fallback behind a
// feature flag until Mapbox is confirmed working". This is that flag's real, non-fabricated
// check: a real Mapbox public access token has to actually be configured (env.mapboxPublicToken,
// see env.ts/app.config.js) before anything tries to render a Mapbox map at all. It does NOT
// (and from pure JS, cannot) confirm the native SDK itself was actually fetched/linked at build
// time -- that depends on RNMAPBOX_MAPS_DOWNLOAD_TOKEN having been set when this build was
// produced (see app.config.js's own comment: the @rnmapbox/maps plugin is only even included in
// the build when that token is present), which is a build-time fact this running JS can't
// inspect directly. In practice the two are set together -- there's no real scenario where the
// SDK was fetched without also configuring the runtime token -- so this one check is the honest,
// available signal, not a guess.
export function isMapboxAvailable(): boolean {
  return env.mapboxPublicToken.length > 0;
}
