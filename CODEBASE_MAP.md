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
  live navigation map (`MapScreen.tsx`). The Phase 1B map-engine swap to real **`@rnmapbox/maps`**
  (commercial Mapbox GL) is installed and has real tokens live as EAS env vars, reached in
  isolation via an owner-only `MapboxMapScreen.tsx` preview — not yet the live navigation map. A
  real EAS cloud build confirmed the Mapbox native module compiles on both platforms; see
  PROGRESS.md/NOTES.md. (An earlier `@maplibre/maplibre-react-native` prototype that evaluated a
  free/open-source alternative engine was removed once real Mapbox tokens made it redundant and a
  real iOS build showed the two colliding at the linker — see NOTES.md.)
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
| `WhereToSheet.tsx` | UI pass 2 — the home "Where to?" sheet (24/55/92% snaps, Home/Work/saved chips, recents, More options) and the full-screen search it opens. Exposes `collapse/expandHalf/expandFull/openSearch` via ref. |
| `PlacePage.tsx` | UI pass 2 — the place page between search and routes (60% sheet: facts, hours, Save/Share/More, nearby parking, photos incl. drivers' own, View routes). |
| `PlaceInfoSheet.tsx` | Apple/Google-Maps-style place detail card — directions/start buttons, live ETA, Street View (static + a new interactive Maps-Embed-API `WebView` with static fallback), category/price line. |
| `RouteDirectionsSheet.tsx`, `RestaurantsSheet.tsx`, `HotelsSheet.tsx`, `FuelStationsSheet.tsx`, `OsmMarkerSheet.tsx`, `AlertDetailSheet.tsx`, `AlertReportSheet.tsx`, `LiveCameraSheet.tsx`, `MapToolsSheet.tsx`, `NavOptionsSheet.tsx` | Bottom sheets for their named feature. `MapToolsSheet` is no longer on the home map (UI pass 2 moved each item — see `AUDIT.md` §10); it's still reachable during navigation from Trip options › Map tools. |
| `VehicleDetectionScreen.tsx` + `VehicleDetectionErrorBoundary.tsx` | Live AI vehicle detection (react-native-vision-camera + a native TFLite frame processor). **Do not touch its detection/tracking/bounding-box/speed logic.** |
| `VehicleHistoryScreen.tsx`, `RevCheckScreen.tsx` | Saved detections list; paid REV Check lookup flow. |
| `DocumentScanScreen.tsx` | Camera capture for VIN/plate OCR (ML Kit). |
| `OwnerDashboardScreen.tsx` | Owner-only admin screen (sign-ins, device sessions, etc.) |
| `SignInScreen.tsx` | Google/Apple/email sign-in. |
| `MapboxMapScreen.tsx` | The real Mapbox engine preview described above — owner-only entry point in Settings. |

## Components (`src/components/`)

Notable: `LiveSpeedometer.tsx` + `SpeedLimitSign.tsx` (speed dial), `NavigationInstructionCard.tsx`
(top turn-by-turn card), `NavBottomBar.tsx` (live ETA/distance/arrival strip during nav),
`LocationMarkers.tsx` (the user's own live marker), `AlertMarker.tsx` (report pins, sized by zoom),
`BannerAdBar.tsx`, `ExitLaneGuidance.tsx`, `MuteButton.tsx`.

UI pass 2: `AppText.tsx` (Text/TextInput in Rubik — import these instead of react-native's),
`PressableScale.tsx` (press animation), `HomeMapControls.tsx` (Menu/Compass/Audio/Sound/Report/
Re-centre on the home map, anchored to the sheet), `StreetPill.tsx`, `ThreeSnapBottomSheet.tsx`
(the "Where to?" sheet's container), `RouteSelection.tsx` (route-selection top card, Avoid and
travel-mode sheets, two-state bottom sheet with Go now, time bubbles, start dot, checkered-flag
pin). The old `RouteOptionsCard.tsx` and `MenuButton`/`CompassButton`/`SoundButton` are gone.

Map (Mapbox, `src/map-v2/`): `TrackLineMap.tsx` (MapView + Camera; the camera handle MapScreen
uses), `MapboxLayers.tsx` (everything drawn on the map, from plain data), `layers/` (RouteLine,
PinLayer, MapIcons, UserPuck, MarkerPin, PresenceLayerV2), `styles/buildStyle.ts` + the generated
style JSONs (`npx tsx scripts/build-map-styles.ts`), `geo.ts`/`pins.ts`/`gestures.ts` (pure),
`mapbox.ts` (safe lazy loader). Dev "Simulate drive": `src/dev/simulateDrive.ts`.

Pure rules (no rendering, unit-tested): `src/map/homeMapLogic.ts` (button fade, arrow position,
pin sizes, street-pill throttle), `src/map/routeChoices.ts` (distinct routes, avoid options,
traffic labels, route tags, bubble placement), `src/services/searchRanking.ts`,
`src/services/placePageLogic.ts`. Tests: `__tests__/` (Jest, `npx jest`) and `scripts/test-*.ts`
(`npx tsx scripts/test-ui-logic.ts` etc.).

## Navigation (`src/navigation/RootNavigator.tsx`)

Native-stack, `headerShown: false` by default. Routes: `Map`, `Settings`, `SignIn`, `MainMenu`
(new), `VehicleHistory`, `RevCheck`, `DocumentScan`, `VehicleDetection` (fullscreen modal, its own
rotation handling), `OwnerDashboard`, `MapboxMapPreview`.

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

## Config plugins (`plugins/`)

- `withAndroidWebviewGradleFix.js` — sets a missing `ext.webkitVersion` Gradle property that
  `react-native-webview`'s own `build.gradle` reads with no fallback. (A `withAndroidKotlinVersionFix.js`
  and a root `react-native.config.js` were tried and then fully reverted/deleted earlier this
  session — see NOTES.md's google-mobile-ads section for why neither actually worked.)

## Phase 1B map-engine spec — resolved

The new brief's Phase 1 (map engine) asked for `@rnmapbox/maps` (commercial Mapbox GL, token-
gated SDK) with custom Mapbox-Studio-style JSON files, zoom-based label/road visibility rules,
ShapeSource/SymbolLayer route rendering, etc. **Resolved**: the user explicitly chose real
Mapbox over a free/open-source MapLibre alternative and provided both real tokens
(`MAPBOX_PUBLIC_TOKEN`, `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`, live as EAS env vars). `@rnmapbox/maps`
is installed, and a real EAS cloud build confirmed its native module compiles on both platforms
(see PROGRESS.md/NOTES.md for the real build-log evidence, including the one real cross-engine
linker conflict this surfaced and how it was fixed — removing the now-superseded MapLibre
prototype entirely). What's left is wiring the engine into the live navigation map itself
(teal user marker, real route ShapeSource/SymbolLayer rendering, the camera/zoom logic already
written in `src/map/cameraZoom.ts`, light/dark style switching) — tracked in PROGRESS.md, not yet
started.
