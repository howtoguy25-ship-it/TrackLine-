# TrackLine codebase map

Written per the Waze-style redesign brief's "HOW TO WORK" step 1, before any Phase 1B /
full-redesign work starts. Reflects the real state of the repo as of this pass (branch
`claude/go-session-0d5bup`). Updated as the redesign progresses — see `PROGRESS.md` for
phase-by-phase status.

## Stack

- Expo SDK 57, React Native 0.86, fully-managed workflow — **no checked-in `ios/`/`android/`
  folders**; `expo prebuild` regenerates them fresh on every EAS build. Any native-side fix has
  to land as an Expo config plugin (`plugins/`, `modules/*/plugin/`) or a `patch-package` patch,
  never a direct edit under `android/`/`ios/`.
- Firebase (Auth, Firestore, Storage, Cloud Functions, FCM) via the `firebase` JS SDK — see
  `src/services/firebase.ts`.
- React Navigation (native-stack) — `src/navigation/RootNavigator.tsx`.
- Map rendering today: **`react-native-maps` (Google Maps SDK, `PROVIDER_GOOGLE`)** for the real,
  live navigation map (`MapScreen.tsx`). A second, separate, **owner-only internal prototype**
  using **`@maplibre/maplibre-react-native`** (`MapLibrePreviewScreen.tsx`) exists in isolation,
  evaluating a custom OSM-vector-tile map engine — not reachable by real users, not the live
  navigation map. `@rnmapbox/maps` (commercial Mapbox GL) is **not installed** — see the Phase 1B
  note below.
- Monetisation: `react-native-google-mobile-ads` (banner + app-open ads), `react-native-iap`
  (REV Check purchase).
- Settings: `src/services/settings.ts` (`AppSettings` interface + `AsyncStorage`), wrapped by
  `src/context/SettingsContext.tsx`. **Firestore cross-device sync was added this session**
  (push on every `updateSettings` call, pull once per real sign-in) — see that file's own
  comments. Before this, only `visibleRegions` synced (one-way, via `userProfile.ts`).

## Screens (`src/screens/`)

| Screen | Role |
|---|---|
| `MapScreen.tsx` (~5,900 lines) | The live map/navigation screen — by far the largest file. Owns the `MapView`, route state, turn-by-turn, all home-screen FABs/overlays, place sheets, alert placement, siren detection wiring, AI-detection entry point. |
| `SettingsScreen.tsx` | One long scrollable settings screen (not yet grouped into the new Waze-style sections — that's Phase 5/6 of the redesign). Has its own `Section`/`Row` helpers (label + control, **no description line yet** for most existing rows). |
| `MainMenuScreen.tsx` | **New this session** — minimal first slice of the Waze-style slide-in main menu (Sign in/Account + Settings rows only; real, not a placeholder, but far short of the full designed panel). |
| `SoundSheet.tsx` | **New this session** — the Sound button's bottom sheet (Spoken directions radio + Current voice row). No "Listening on" row yet — needs a native audio-route module, see `NOTES.md`. |
| `PlaceInfoSheet.tsx` | Apple/Google-Maps-style place detail card — directions/start buttons, live ETA, Street View (static + a new interactive Maps-Embed-API `WebView` with static fallback), category/price line. |
| `RouteDirectionsSheet.tsx`, `RestaurantsSheet.tsx`, `HotelsSheet.tsx`, `FuelStationsSheet.tsx`, `OsmMarkerSheet.tsx`, `AlertDetailSheet.tsx`, `AlertReportSheet.tsx`, `LiveCameraSheet.tsx`, `MapToolsSheet.tsx`, `NavOptionsSheet.tsx` | Bottom sheets for their named feature. `MapToolsSheet` is the current single "..." button covering recenter/3D/satellite/dashcam/alerts toggle/layers — the redesign's Waze layout mostly disperses these into Settings or dedicated buttons. |
| `VehicleDetectionScreen.tsx` + `VehicleDetectionErrorBoundary.tsx` | Live AI vehicle detection (react-native-vision-camera + a native TFLite frame processor). **Do not touch its detection/tracking/bounding-box/speed logic.** |
| `VehicleHistoryScreen.tsx`, `RevCheckScreen.tsx` | Saved detections list; paid REV Check lookup flow. |
| `DocumentScanScreen.tsx` | Camera capture for VIN/plate OCR (ML Kit). |
| `OwnerDashboardScreen.tsx` | Owner-only admin screen (sign-ins, device sessions, etc.) |
| `SignInScreen.tsx` | Google/Apple/email sign-in. |
| `MapLibrePreviewScreen.tsx` | The MapLibre prototype described above — owner-only entry point in Settings. |

## Components (`src/components/`)

Notable: `LiveSpeedometer.tsx` + `SpeedLimitSign.tsx` (speed dial, now restyled smaller this
session), `NavigationInstructionCard.tsx` (top turn-by-turn card, real per-manoeuvre MaterialIcons
arrows), `NavBottomBar.tsx` (live ETA/distance/arrival strip during nav), `LocationMarkers.tsx`
(the user's own live marker — gradient-filled arrow, Settings-driven icon), `AlertMarker.tsx`,
`DestinationSearchBar.tsx` (the current full-width top search bar — gets replaced by the Phase
3/"Phase 2" bottom sheet in the new design), `MenuButton.tsx`/`CompassButton.tsx`/`SoundButton.tsx`
(**new this session**, the Waze-style home-screen buttons), `BannerAdBar.tsx`, `ExitLaneGuidance.tsx`,
`MuteButton.tsx`.

## Navigation (`src/navigation/RootNavigator.tsx`)

Native-stack, `headerShown: false` by default. Routes: `Map`, `Settings`, `SignIn`, `MainMenu`
(new), `VehicleHistory`, `RevCheck`, `DocumentScan`, `VehicleDetection` (fullscreen modal, its own
rotation handling), `OwnerDashboard`, `MapLibrePreview`.

## Settings storage (`src/services/settings.ts` + `SettingsContext.tsx`)

- `AppSettings` is one flat interface, persisted as a single JSON blob under
  `@trackline/settings` in AsyncStorage (not split into per-feature keys).
- Existing real settings already cover: visible alert regions, alerts master toggle + per-type
  visibility, auto-share detections, siren sensitivity, default voice-enabled, static OSM
  traffic-light/speed-camera layer toggles, live NSW traffic camera toggle, OSM layer radius, map
  colour theme + road thickness, AI-detection night-mode preference, nav card colour theme, alert
  expiry override, alert icon theme, map marker style, speed warning chime toggle, default map
  view style (3D/flat/satellite). **New this session:** `showCompass`, `spokenDirections`.
- Voice settings (`voiceEnabled`, `voiceVolume`, `voiceIdentifier`) are a *separate* small
  AsyncStorage-backed set in `src/services/voice.ts`, exposed through the same `SettingsContext`.
- **Firestore sync** (new this session): `pushSettingsToProfile`/`pullSettingsFromProfile` in
  `settings.ts`, writing/reading a `settings` field on the existing `users/{uid}` doc
  (`userProfile.ts`'s own doc). Push on every change while signed in with a real (non-anonymous)
  account; pull once per sign-in, merged over local.

## Firebase (`firebase/`)

- `firestore.rules`, `firestore.indexes.json` at the repo root of that folder.
- `functions/index.js` (568 lines, plain JS, v2 functions): `createRevCheckCheckout`,
  `cleanupExpiredAlerts` (scheduled, every 15 min), `validateAlertOnCreate` (Firestore trigger),
  `runRevCheck`, `runPlateLookup`, `recognizePlate`, `broadcastNotification`. **No Live Traffic
  NSW ingestion function exists yet** — Phase 5 of the redesign (and the TfNSW feed used today,
  `services/liveTrafficCameras.ts`/`osmTrafficData.ts`, is a different, simpler client-side fetch,
  not a scheduled Cloud Function writing a normalised `officialHazards` collection).

## Native modules (`modules/`)

- `map3d/` — custom Expo module wrapping Google's `GoogleMaps3D` (Swift Package Manager via
  CocoaPods `spm_dependency`), used for the existing 3D satellite view toggle.
- `yamnet-siren/` — real on-device YAMNet TFLite siren classifier (iOS Swift + Android Kotlin),
  built out this session.
- `liveActivity/` — iOS Live Activity (lock-screen nav widget).

## Config plugins (`plugins/`, new this session)

- `withAndroidWebviewGradleFix.js` — sets a missing `ext.webkitVersion` Gradle property that
  `react-native-webview`'s own `build.gradle` reads with no fallback.
- `withAndroidKotlinVersionFix.js` — sets `android.kotlinVersion` in `gradle.properties` (the
  real, documented override point for Expo's generated "expoLibs" version catalog) to satisfy
  `react-native-google-mobile-ads`'s pinned `play-services-ads` Kotlin-metadata requirement.
- `react-native.config.js` (repo root, new) — excludes `@maplibre/maplibre-react-native` from
  **Android** autolinking only, because its latest release crashes the Kotlin K2 compiler at
  every version this project tried other than the original default — see that file's own header
  and `NOTES.md`. iOS is unaffected.

## Known architectural gap vs. the new "Phase 1B" map-engine spec

The new brief's Phase 1 (map engine) asks for `@rnmapbox/maps` (commercial Mapbox GL, token-
gated SDK) with custom Mapbox-Studio-style JSON files, zoom-based label/road visibility rules,
ShapeSource/SymbolLayer route rendering, etc. Today:

- `@rnmapbox/maps` is not installed and this project has **no Mapbox account/token** — a real,
  paid, token-gated SDK that genuinely cannot be added without the project owner creating a
  Mapbox account and handing over a real public token + a downloads token (`eas secret:create
  --name RNMAPBOX_MAPS_DOWNLOAD_TOKEN`). This is a hard blocker raised separately, not something
  that can be fabricated.
- The already-installed, **free, open-source** `@maplibre/maplibre-react-native` (a fork of
  Mapbox GL from before its licence change) speaks the *same* Mapbox GL JS style specification —
  the custom style-JSON work (land/water/building colours, road width-by-zoom expressions, label
  visibility thresholds, route ShapeSource/SymbolLayer rendering) is equally buildable on it, at
  zero cost and reusing the existing (currently owner-only) prototype, **except** for the live
  Android Kotlin-compiler conflict with `react-native-google-mobile-ads` noted above, which is
  itself fixable (patch, or an upstream maplibre release) independent of which engine is chosen.
