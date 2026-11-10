import Constants from "expo-constants";
import { Platform } from "react-native";
import { TestIds } from "react-native-google-mobile-ads";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.warn(
      `[env] Missing "${name}". Set it in your .env file (see .env.example) before shipping.`
    );
    return "";
  }
  return value;
}

export const env = {
  googlePlacesApiKey: required("googlePlacesApiKey", extra.googlePlacesApiKey),
  googleDirectionsApiKey: required("googleDirectionsApiKey", extra.googleDirectionsApiKey),
  firebase: {
    apiKey: required("firebaseApiKey", extra.firebaseApiKey),
    authDomain: required("firebaseAuthDomain", extra.firebaseAuthDomain),
    projectId: required("firebaseProjectId", extra.firebaseProjectId),
    storageBucket: required("firebaseStorageBucket", extra.firebaseStorageBucket),
    messagingSenderId: required("firebaseMessagingSenderId", extra.firebaseMessagingSenderId),
    appId: required("firebaseAppId", extra.firebaseAppId),
  },
  // Falls back to Google's own real (non-fake) test ad unit IDs -- these serve actual test
  // ads from Google's network, they just never generate revenue -- so ads work out of the
  // box before real AdMob ad units are configured. See .env.example for how to set the real
  // production unit IDs once an AdMob account/app is set up.
  ads: {
    bannerUnitId:
      (Platform.OS === "android" ? extra.admobBannerAndroidUnitId : extra.admobBannerIosUnitId) ||
      TestIds.BANNER,
    appOpenUnitId:
      (Platform.OS === "android" ? extra.admobAppOpenAndroidUnitId : extra.admobAppOpenIosUnitId) ||
      TestIds.APP_OPEN,
  },
  // Optional -- Sentry.init() below is a no-op without this, so an empty string here just
  // means crash reporting stays Firestore-only rather than breaking anything.
  sentryDsn: extra.sentryDsn ?? "",
  // Genuinely optional (not `required()`, which would log a misleading "you forgot this"
  // warning on every launch) -- Google Sign-In is a real feature, but the app works fully
  // without it configured. GoogleSignInButton disables itself and explains why when this is
  // empty, rather than the button doing nothing or crashing on tap.
  googleIosClientId: extra.googleIosClientId ?? "",
  // Same "genuinely optional" treatment as googleIosClientId above -- live NSW transit
  // tracking is a real bonus feature, not something the app depends on; see
  // services/liveVehiclePositions.ts.
  nswTransportApiKey: extra.nswTransportApiKey ?? "",
  // Waze-style redesign's map engine (@rnmapbox/maps) -- genuinely optional, same treatment as
  // every other optional key above. src/map/mapboxAvailability.ts is the real, honest check for
  // whether Mapbox is actually usable right now (this alone isn't enough -- the native SDK
  // itself has to have been fetched at build time too, which needs the separate download token,
  // see app.config.js's own comment on the @rnmapbox/maps plugin entry).
  mapboxPublicToken: extra.mapboxPublicToken ?? "",
  // Waze-style redesign's Phase 3 voice picker -- the brief's own "Sarcastic Co-pilot"/"Dry Wit"
  // persona voices ("scripted lines generated once via a TTS provider e.g. ElevenLabs and
  // bundled/cached, not live"). Genuinely optional, same treatment as every other key above --
  // src/services/personaVoices.ts is the real, honest check for whether these are usable yet.
  elevenLabsApiKey: extra.elevenLabsApiKey ?? "",
  // Genuinely optional, same treatment as every other key above -- src/services/trackyMood.ts
  // is the real, honest check for whether the "Rain at location" auto-mood trigger can run.
  openWeatherApiKey: extra.openWeatherApiKey ?? "",
};
