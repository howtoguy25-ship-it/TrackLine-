require("dotenv/config");

// @react-native-google-signin/google-signin's config plugin throws at config-evaluation time
// (failing the whole build) if given an iosUrlScheme that isn't set, so this is only included
// once a real one exists -- until then, Google Sign-In's native module still links fine (JS
// package autolinking doesn't depend on this plugin), it just isn't configured yet, so tapping
// the button fails gracefully with a caught error instead of the entire app failing to build.
// Real value comes from Firebase Console -> Project settings -> Add app -> iOS (bundle id
// com.trackline.navigate) -> download GoogleService-Info.plist -> its REVERSED_CLIENT_ID field.
const googleSigninPlugins = process.env.GOOGLE_IOS_URL_SCHEME
  ? [["@react-native-google-signin/google-signin", { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME }]]
  : [];

/** @type {import('@expo/config-types').ExpoConfig} */
module.exports = {
  expo: {
    name: "TrackLine",
    slug: "trackline",
    // The user-facing marketing version (CFBundleShortVersionString) -- separate from the
    // internal build number, which EAS auto-increments remotely on every submit
    // (eas.json's appVersionSource: "remote" + production.autoIncrement) and never lives here.
    // Bumped from 1.0.0 now that REV checks + real IAP monetization landed -- a genuine feature
    // milestone, not just an internal TestFlight build tick.
    version: "1.1.0",
    // "default" (was "portrait") -- a portrait-only native Info.plist blocks ANY runtime
    // rotation regardless of JS calls, no matter what expo-screen-orientation does. The app
    // itself still only ever JS-locks to portrait everywhere except the AI Detection screen
    // (see App.tsx's own lockAsync(PORTRAIT_UP) on mount, and VehicleDetectionScreen's own
    // unlockAsync while it's open) -- this just gives the native layer permission to allow
    // that one screen's rotation at all.
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    assetBundlePatterns: ["**/*"],
    ios: {
      // Phone-only -- TrackLine is a live driving/navigation app, not something meant to run
      // on an iPad mounted somewhere, and this avoids App Store Connect requiring a whole
      // separate set of iPad screenshots for a form factor the app isn't really designed for.
      supportsTablet: false,
      bundleIdentifier: "com.trackline.navigate",
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          "TrackLine uses your location to show your position on the map and provide turn-by-turn navigation.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "TrackLine can track your location in the background to keep navigation and nearby-alert notifications accurate.",
        NSMicrophoneUsageDescription:
          "TrackLine listens for emergency vehicle sirens near you. Audio is analyzed on-device in real time and is never recorded or stored.",
        NSCameraUsageDescription:
          "TrackLine uses your camera for live AI Vehicle Detection, analyzed on-device in real time. Video is never recorded or stored.",
        UIBackgroundModes: ["audio", "location", "fetch"],
        // App only uses standard HTTPS/TLS (Firebase, Google Maps, AdMob) -- no custom
        // encryption -- so it qualifies as exempt. Declaring this here answers Apple's
        // export-compliance question automatically on every build/submit instead of
        // App Store Connect prompting for it by hand each time.
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0B1220",
      },
      package: "com.trackline.navigate",
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "RECORD_AUDIO",
        "CAMERA",
        "FOREGROUND_SERVICE",
      ],
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
        },
      },
    },
    plugins: [
      "expo-font",
      "expo-asset",
      "expo-tracking-transparency",
      // expo-splash-screen's own plugin, not the legacy top-level `splash` config field --
      // that legacy field left Android's actual splashscreen_background color resource
      // hardcoded to white regardless of what backgroundColor was set to (confirmed by
      // inspecting the generated android/app/src/main/res/values/colors.xml), so the logo
      // always showed on a white box instead of this color. This plugin properly treats the
      // image as a centered icon over a real background color on both platforms, so the
      // transparent-cutout logo (assets/logo-transparent.png, background removed from the
      // original opaque icon.png) sits cleanly on the color with no box/seam around it.
      [
        "expo-splash-screen",
        {
          image: "./assets/logo-transparent.png",
          resizeMode: "contain",
          backgroundColor: "#0B1220",
          imageWidth: 200,
        },
      ],
      "expo-status-bar",
      // Deliberately using react-native-maps' own config plugin here instead of the old
      // `ios.config.googleMapsApiKey` field -- that field triggers a legacy, unmaintained
      // plugin bundled in @expo/config-plugins (node_modules/@expo/config-plugins/build/
      // ios/Maps.js) that injects `pod 'react-native-google-maps', ...` into the Podfile, a
      // pod name that hasn't existed since old react-native-maps versions -- current
      // react-native-maps (1.x) ships its own plugin that correctly adds
      // `pod 'react-native-maps/Google', ...` (a real subspec) instead. Real error this was
      // causing: "[!] No podspec found for `react-native-google-maps`" failing `pod install`.
      [
        "react-native-maps",
        {
          iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "TrackLine uses your location for live navigation and to show/report nearby alerts.",
        },
      ],
      [
        "expo-audio",
        {
          microphonePermission:
            "TrackLine listens for emergency vehicle sirens near you. Audio is analyzed on-device only and is never recorded or stored.",
        },
      ],
      // Switched from expo-camera to react-native-vision-camera for Live Vehicle Detection --
      // expo-camera's takePictureAsync() (a full native shutter + JPEG encode + file write on
      // every single capture) was the original cause of the detection screen freezing. The
      // JS-thread-bound tfjs capture/decode/infer cycle that replaced it turned out to be its
      // own freeze source (confirmed via Sentry perf instrumentation), so detection now runs
      // through a real Frame Processor calling a native TFLite model (react-native-fast-tflite)
      // synchronously on the camera's own worklet thread -- only box coordinates/labels/scores
      // cross back to JS. enableFrameProcessors is on for this.
      [
        "react-native-vision-camera",
        {
          cameraPermissionText:
            "TrackLine uses your camera for live AI Vehicle Detection, analyzed on-device in real time. Video is never recorded or stored.",
          enableMicrophonePermission: false,
          enableLocation: false,
          enableCodeScanner: false,
          enableFrameProcessors: true,
        },
      ],
      // On-device (Google ML Kit) text recognition for the plate-number display in Live
      // Vehicle Detection -- runs entirely on-device, no network call, no cloud API, nothing
      // stored, matching the same privacy shape as the web app's Tesseract-based plate OCR
      // (see web/src/services/plateOcr.ts). Bundled models only (ocrUseBundled) so there's no
      // separate on-first-use model download. `ocrModels: ["latin"]` -- the default (no
      // ocrModels set) bundles all five script models (Chinese/Japanese/Korean/Devanagari
      // too), which just adds app size/build weight with nothing an AU plate would ever use.
      ["rn-mlkit-ocr", { ocrModels: ["latin"], ocrUseBundled: true }],
      [
        "./modules/map3d/plugin/withMap3D.js",
        {
          androidApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
          iosApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
        },
      ],
      "./modules/map3d/plugin/withGoogleMaps3DSignatureFix.js",
      "expo-apple-authentication",
      ...googleSigninPlugins,
      // Only uploads debug symbols/source maps during EAS builds once org/project/authToken
      // are set (from sentry.io -- Settings -> Auth Tokens for the token) -- harmless no-op
      // config without them, Sentry.init() below still works and reports crashes either way,
      // just with unsymbolicated (minified) JS stack traces until these are filled in.
      [
        "@sentry/react-native",
        {
          organization: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
        },
      ],
      [
        "react-native-google-mobile-ads",
        {
          // Google's own public test App IDs as the fallback -- real Google Mobile Ads
          // account App IDs (format ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY, from
          // admob.google.com -> Apps -> App settings) override via env vars once set up.
          // Ads work out of the box with real (Google-served) test ads either way.
          androidAppId: process.env.ADMOB_ANDROID_APP_ID || "ca-app-pub-3940256099942544~3347511713",
          iosAppId: process.env.ADMOB_IOS_APP_ID || "ca-app-pub-3940256099942544~1458002511",
          userTrackingUsageDescription:
            "TrackLine shows ads to help keep the app free. Allowing tracking lets those ads be more relevant -- you can decline and the app works the same either way.",
        },
      ],
    ],
    extra: {
      googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY,
      googleDirectionsApiKey: process.env.GOOGLE_DIRECTIONS_API_KEY,
      firebaseApiKey: process.env.FIREBASE_API_KEY,
      firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN,
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
      firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      firebaseAppId: process.env.FIREBASE_APP_ID,
      // The Google Sign-In *iOS* OAuth client ID -- distinct from any "Web client ID" the
      // Firebase Console shows by default (that one's for the web app's signInWithPopup flow
      // and won't work here). Comes from the same GoogleService-Info.plist mentioned above
      // (its CLIENT_ID field), or Google Cloud Console -> APIs & Services -> Credentials -> an
      // OAuth 2.0 Client ID of type "iOS".
      googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID,
      admobBannerAndroidUnitId: process.env.ADMOB_ANDROID_BANNER_UNIT_ID,
      admobBannerIosUnitId: process.env.ADMOB_IOS_BANNER_UNIT_ID,
      admobAppOpenAndroidUnitId: process.env.ADMOB_ANDROID_APP_OPEN_UNIT_ID,
      admobAppOpenIosUnitId: process.env.ADMOB_IOS_APP_OPEN_UNIT_ID,
      // Transport for NSW Open Data (opendata.transport.nsw.gov.au) -- GTFS-realtime vehicle
      // positions for NSW buses/trains/ferries/light rail. Genuinely optional: services/
      // liveVehiclePositions.ts returns an empty result with no error when this is unset, so
      // the app works fine without it (Transit mode already shows real timetable-based ETAs
      // via Google Directions either way, see the "Public transit" note in Settings).
      nswTransportApiKey: process.env.NSW_TRANSPORT_API_KEY,
      sentryDsn: process.env.SENTRY_DSN,
      eas: {
        // Not a secret -- EAS project IDs are meant to live directly in config, which is
        // also the only way `eas build`/`eas submit` can reliably find it, since this file
        // being a dynamic app.config.js (not static app.json) means the EAS CLI can't write
        // to it automatically the way `eas init` normally would.
        projectId: "dd1665d0-24fa-41ce-99d8-d94adf93788d",
      },
    },
  },
};
