# TrackLine — platform/data limitation notes

## Phase 1B — Top instruction card

- **Not full literal pixel sizes.** The brief's section 5 sizes (64pt icon, 44pt distance, 40pt
  street name) assume a dedicated full-width panel with the icon in its own column. This app's
  existing `NavigationInstructionCard` shares one row between the icon, instruction text,
  distance pill, and the collapse/transparency/exit buttons -- a card that's been real, shipped,
  iteratively-requested functionality across earlier rounds this session (collapsible "island"
  state, per-theme colours, transparency toggle). Rather than discard that and rebuild a new
  fixed full-width panel, every size was bumped up meaningfully from its previous value (icon
  40→52px, distance 15→19pt, new street-name line at 22pt) while staying inside this card's real
  available width -- each one commented in place with why it isn't the literal spec number.
- **Roundabout exit numbers** are real, extracted from Google's own instruction sentence text
  (e.g. "take the 2nd exit") via regex, since the REST Directions API has no structured exit-
  number field at all (only Google's separate Navigation SDK does, which this app doesn't use) --
  confirmed by a real web search before writing this, not assumed. Shows nothing when Google's
  own sentence doesn't state one.
- **Target street name** (the accented line under the instruction) is extracted from Google's own
  `<b>...</b>` markup in `html_instructions` -- real markup Google already sends, not derived/
  guessed from the plain-text instruction. Only appears when Google's own html actually bolded
  something for that step.
- **Distance units (km/miles)**: added a real `distanceUnit` setting (Settings row not wired up
  yet -- this is Phase 6's own settings-screen reorg) and extended the shared `formatDistance`
  with a real km/miles conversion, both now driving the instruction card's own distance text.

## Phase 1B — Bottom banner (follow / re-centre / overview)

- **Reused real, existing camera-follow machinery** rather than building a parallel system:
  `followTilt` (MapScreen's own existing "is the camera auto-following" state, already set to
  false on any real manual pan/zoom/rotate gesture) drives which of the two banner states shows;
  `onRecenter`/`applyOverviewPose` are the same existing functions the old small top-right
  recentre pill and locate button already called.
- **"Overview" does not yet fit the whole remaining route in view.** The brief asks for a real
  fit-bounds computation (route + user + destination, with specific edge padding, north-up, 2D).
  This button currently reuses the existing `applyOverviewPose` toggle -- a real, working, but
  fixed-zoom (z15) pulled-back 3D pose, not a genuine bounds-fit. A real fit-bounds
  implementation (using the route's own remaining polyline + destination coordinate) is real,
  buildable work not yet done -- tracked as a follow-up, not silently left as the final behaviour.
- **80pt re-centre circle → 44pt.** Same real shared-row-width reasoning as the instruction
  card's icon/text sizing -- this bar also holds the Overview pill and the existing add-stop/
  options buttons in the same row.

## Phase 1B — Mapbox map engine

- **Both real Mapbox tokens are now live** (`MAPBOX_PUBLIC_TOKEN`, `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`,
  set as real EAS environment variables). `@rnmapbox/maps` is installed and wired up (config
  plugin, env scaffolding, an owner-only `MapboxMapScreen` preview). **Critical, confirmed-real
  safety detail**: `@rnmapbox/maps`'s own JS (`RNMBXModule.js`) throws immediately at *module
  import time* if its native code isn't linked -- not a soft runtime failure. Its own
  `@rnmapbox/maps` Expo config plugin is therefore only added to `app.config.js`'s plugins array
  when `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` is actually set (so the native module is never linked
  without it), and `MapboxMapScreen.tsx` only ever reaches the package via a deferred `require()`
  inside a function gated on `isMapboxAvailable()`, never a static `import`.
- **Real EAS cloud builds (Android + iOS) confirmed the Mapbox native module genuinely compiles
  on both platforms**, and surfaced one real, now-fixed cross-engine conflict. Android: a full
  `./gradlew`-equivalent run showed `rnmapbox_maps:compileReleaseKotlin` succeeding cleanly (only
  deprecation warnings, no errors) with all 469 actionable tasks executed -- the build's only
  failure was the pre-existing, unrelated `react-native-google-mobile-ads:compileReleaseKotlin`
  issue documented below. iOS: the build genuinely failed, but with a real, diagnosable linker
  error -- `ld: 5 duplicate symbols`, naming `NativeMapViewModuleSpecJSI`/
  `NativeMapViewModuleSpecBase` defined in BOTH `rnmapbox_maps_specs-generated.o` and
  `MapLibreReactNativeSpec-generated.o` inside `libReactCodegen.a`. Root cause: `@rnmapbox/maps`
  and the (by-then-superseded) `@maplibre/maplibre-react-native` prototype both generate a React
  Native Codegen native-module spec literally named `NativeMapViewModule`, which Android's
  per-package Java codegen output never collides on but iOS's single static archive link does.
  Since real Mapbox was the user's own explicit, already-made engine choice, the fix was to
  remove the now-superseded MapLibre prototype entirely (`@maplibre/maplibre-react-native`
  uninstalled, `MapLibrePreviewScreen.tsx` deleted, its route/settings entry point removed) rather
  than the real engine -- confirmed via `npx tsc --noEmit` and a real `expo export` (both
  platforms) with zero MapLibre references left anywhere. Fresh EAS builds re-kicked off to get a
  from-scratch confirmation with the conflict actually removed.
  (This also obsoletes the previously-documented, three-attempts-reverted "fix the Kotlin
  version for google-mobile-ads" dead end below as far as Mapbox is concerned -- that issue is
  real and still unresolved, but was never a Mapbox problem to begin with, and this iOS finding
  shows local-Android-only verification genuinely can't surface everything a real multi-platform
  cloud build can.)
- **Style JSON** (`src/map/styles/trackline-light.json` / `trackline-dark.json`) is built against
  the real, documented Mapbox Streets v8 vector tileset schema, matching every colour/zoom/width
  value the brief gave for the light style. The dark palette was NOT given exact values in the
  brief -- it's an original derivation (same structure, inverted land/road contrast), flagged in
  each file's own `metadata` field so it's never mistaken for a literal spec value. A few details
  genuinely can't be verified without a real token + Mapbox Studio/a live build: exact postcode
  field availability on `place_label` for Australian suburbs, and the 3D-building-only-above-
  pitch-30 behaviour (not expressible in static style JSON at all -- the file ships both a flat
  and an extrusion building layer, with the pitch-based swap between them left as runtime JS
  logic still to be wired into the map screen once real tiles can be visually checked).
- **Highway route shields** (`road-shield` layer) reference sprite image names
  (`shield-motorway` etc.) that need a real, separately-authored sprite sheet image -- not
  something a style JSON file alone can produce. Tracked as a real asset-creation task, not yet
  done.

- **BLOCKED (explicit, user-confirmed decision): switching the live home/navigation map from
  `react-native-maps` to `@rnmapbox/maps` is deferred.** Real scope measured directly (not
  estimated): `MapScreen.tsx` is 6,000+ lines, entirely built on react-native-maps' own API --
  20 `<Marker>`, 8 `<Polyline>`, 21 `animateCamera` calls, 14 `onRegionChangeComplete` handlers,
  `PROVIDER_GOOGLE` -- touching chase-cam navigation, 3D buildings, the traffic layer, alert
  placement, viewport marker clustering, and route fit-bounds, all currently working in
  production. `@rnmapbox/maps` has a structurally different API for every one of those (camera
  control via a `Camera` ref instead of `animateCamera`, `ShapeSource`/`LineLayer` instead of
  `<Polyline>`, `PointAnnotation` instead of `<Marker>`, `onMapIdle`/`onCameraChanged` instead of
  `onRegionChangeComplete`) -- this is a full rewrite of the single largest file in the app, not
  a config swap, and isn't verifiable without a real device/simulator, which isn't available in
  this environment. See `MAPBOX_PLAN.md` for the real per-feature port plan, effort estimate,
  and risk breakdown this decision is based on. `react-native-maps`/Google Maps remains the live
  engine; every Waze-style visual feature above (map theme, markers, nav card, bottom bar,
  turn callouts, auto-zoom) was built directly on it instead of waiting on this switch, since
  none of it actually depends on which map engine is underneath.

Per the Waze-style redesign build rules: this file lists anything that can't be done
for real on a given platform or with currently-available data, with an honest in-app
message shown in its place instead of a fake/placeholder result. Updated as each
phase ships.

## Phase 1 — Home map screen

- **"Listening on" row (current audio output route + a native output picker) is not built yet.**
  `expo-audio` has no API for reading the device's current audio output route (speaker/
  Bluetooth/CarPlay/headphones) or for opening the system's output picker -- confirmed by
  reading its full type definitions (`AudioModule.types.d.ts`, `ExpoAudio.d.ts`): only
  `setAudioModeAsync`/recording-permission APIs exist, nothing route-related. iOS has a real
  native answer (`AVRoutePickerView`, AVKit) and Android has no single universal equivalent
  (closest is the Android 12+ system Media Output Switcher, reached differently than iOS).
  Building this for real needs a small native module (same pattern as `modules/map3d` and
  `modules/yamnet-siren` elsewhere in this app), which the Sound sheet doesn't have yet. The
  Sound sheet in this round deliberately omits the row rather than showing a fake/guessed
  output name -- it ships with Spoken directions + Current voice only. Tracked as a fast-follow
  before Phase 1 is considered fully done.
- **Compass button needle is static, not live-rotating.** react-native-maps' `MapView` never
  exposes the map's own current camera bearing back to JS as a readable live value (only a
  one-shot `getCamera()` call, or whatever this screen last set it to via `animateCamera` --
  not what a two-finger rotate gesture sets natively). Animating a needle to a bearing this
  screen can't actually read back would be a fabricated rotation, so the button is a static
  glyph; tapping it still does a real `animateCamera({ heading: 0 })` reset to north.
- **Idle "where to?" search bar still renders at the top of the screen, not a bottom sheet
  yet.** Phase 1 added the new top-left Menu/Compass buttons, which needed the existing full-
  width top search bar pushed down (via its own `topOffset` prop) to avoid overlapping rather
  than removed -- the real bottom "Where to?" sheet replacing it entirely is Phase 2's own work.
- **RESOLVED: the Android ads/Kotlin build conflict.** `react-native-google-mobile-ads`'s own
  pinned `com.google.android.gms:play-services-ads:25.4.0` ships real Kotlin metadata at binary
  version 2.3.0; a Kotlin compiler can only read metadata up to one minor version ahead of
  itself, and this project's actually-applied compiler was 2.1.20 (one short) -- confirmed real
  via `Module was compiled with an incompatible version of Kotlin. The binary version of its
  metadata is 2.3.0, expected version is 2.1.0.` Earlier attempts this session (the documented
  `android.kotlinVersion` property, a module-local `ext.kotlinVersion`, hardcoding that module's
  OWN buildscript classpath, a `pluginManagement.resolutionStrategy.eachPlugin` substitution)
  all genuinely had zero effect -- confirmed by re-running the exact same failing compile task
  after each and seeing the identical, unchanged error. The real lever, found by reading
  `react-native-google-mobile-ads/android/build.gradle`'s own `apply plugin: 'kotlin-android'`
  (old string syntax, resolved via buildscript classpath, not Gradle's plugin-ID resolution) and
  this project's generated ROOT `android/build.gradle`, which applies the Kotlin Gradle Plugin
  with **no version at all** (`classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')`) -- every
  subproject's plain `apply plugin: 'kotlin-android'` resolves against THAT one unversioned
  entry project-wide. Pinning a real version there (2.2.20 -- confirmed both by the "+1 minor"
  metadata rule and by Expo's own `ExpoRootProjectPlugin.kt` KSP-version lookup table only
  recognising 2.2.20/2.2.10/2.2.0/2.1.21/2.1.20/2.0.21, not 2.3.x) is what actually worked,
  confirmed via a real local `./gradlew :react-native-google-mobile-ads:compileReleaseKotlin`
  going from the metadata error to `BUILD SUCCESSFUL`. Shipped as a real Expo config plugin,
  `plugins/withAndroidKotlinGradlePluginVersion.js` (see its own header for the full
  investigation), verified end-to-end via a fresh `expo prebuild --clean` + local Gradle build
  with no manual edits. This bump also surfaced (and this session fixed) a real, previously-
  masked regression in this project's own `modules/map3d` native module -- see its own entry
  below.
- **Main menu panel is a minimal first slice** (Sign in/Account + Settings rows only) --
  the full designed panel (Tracky mascot, "Plan a drive" card, calendar events, Inbox, Invite a
  friend, Help) is Phase 4's own build. The Menu button's unread badge count is real (always 0
  right now) rather than fake, since there's no Inbox data model yet to count against.

## Phase 2 — "Where to?" bottom search sheet

- **Real, shipped this round**: the old always-floating-at-the-top `DestinationSearchBar` idle
  bar is replaced by a real draggable 3-snap-point sheet (`WhereToSheet.tsx`, peek/half/full via
  a new `ThreeSnapBottomSheet.tsx` -- a sibling of `SimpleBottomSheet.tsx`, not a reuse of it,
  since this sheet's real contract has no "closed" state at all, unlike the on-demand info
  panels). Real Home/Work/+New chips (`savedPlaces.ts`, AsyncStorage + Firestore cross-device
  sync, same pattern as `settings.ts`): tapping a set Home/Work routes there immediately,
  long-press offers Edit/Remove, tapping an unset one starts a real address search scoped to
  that slot. Real Saved/Fuel/Food/Parking category chips -- Fuel/Food reuse the existing
  Petrol/Restaurants sheets' own handlers; Parking is a genuinely new real nearby-list
  (`ParkingSheet.tsx`, same OpenStreetMap-via-Overpass architecture as Fuel/Restaurants/Hotels --
  added a real `"parking"`/`amenity=parking` category to `osmPlaces.ts`).
- **Honestly NOT built this round** (per this project's own "build real, log what's missing"
  rule, not silently skipped):
  - **Voice search mic** -- the icon is real and present (matching the brief's layout), but
    tapping it shows an honest in-sheet note ("Voice search isn't set up yet...") instead of
    pretending to listen. This project has no speech-to-text library at all yet (only
    `expo-speech`, which is text-to-speech) -- adding real STT needs a new native module +
    config plugin + its own EAS rebuild cycle, deliberately not queued in the same pass as the
    in-flight Mapbox native-module work above.
  - **"More options" section** (Drive to friends & family via real Contacts permission + "Share
    drive" live-ETA link, Connect calendar via real Calendar permission + upcoming-events list)
    -- both need their own new native permission integrations (`expo-contacts`, `expo-calendar`)
    and a Firebase-hosted live-trip-link page for the share-drive case. Not rendered at all this
    round rather than shipped as dead/non-functional rows.
  - **Parking's full filter row** (Best match/distance/price sort, Open now, Top rated, and the
    More sheet's wheelchair/disabled-parking/toilets/EV-charging toggles) -- OSM's own per-lot
    tagging for those attributes is sparse/inconsistent enough that real toggles would mostly
    show "no data" for most real results, so `ParkingSheet.tsx` ships the real, functional core
    (live nearby car parks, nearest-first, real text search) without them for now.
  - **Custom "+ New" naming step** -- the full brief asks for a typed name; this round labels a
    new saved place with the picked place's own real name instead (no fake name, just a
    simplification of the naming UI, which needs a small cross-platform text-entry modal
    `Alert.prompt` doesn't provide on Android).

## `modules/map3d` -- real regression from the Android Kotlin 2.2.20 bump, fixed

Bumping the project's actually-applied Kotlin compiler (see the resolved ads/Kotlin entry above)
let the compiler correctly read `play-services-maps3d` 0.2.0's own real Kotlin metadata for the
first time -- previously-masked-by-lenient-platform-type-fallback issues surfaced as real
compile errors in `modules/map3d/android/src/main/java/expo/modules/map3d/`, all confirmed via
decompiling the real SDK's own class files (`javap`) rather than guessed, and all fixed:
- `getMap3DViewAsync { map -> ... }`'s SAM-converted trailing lambda stopped type-checking
  under the K2 compiler against `OnMap3DViewReadyCallback` (a real Java interface with one
  abstract method + one default method) -- replaced with an explicit anonymous `object :
  OnMap3DViewReadyCallback` implementation, which sidesteps whatever inference path regressed.
- `Camera.heading`/`.tilt`/`.range` are each individually nullable (`java.lang.Double`, not
  primitive `double`) on the real API -- `rotateCamera`/`tiltCamera` now fall back to this
  view's own last-known values (`this@ExpoMap3DView.heading` etc.) instead of doing arithmetic
  directly on a nullable.
- `Marker.position` is a read-only (`val`) Kotlin property with a separate, unrelated
  `setPosition()` method (not a property setter) -- `existing.position = position` is now
  `existing.setPosition(position)`.
- `PolylineOptions` (the builder) has no `coordinates` property at all, only `path` (that name
  only exists on the already-constructed `Polyline` object) -- fixed in `polylineOptions { }`.
- `Map3DModule.kt`'s `Function("rotateCamera") { ... }`/`Function("tiltCamera") { ... }` calls
  stopped resolving via implicit cross-scope receiver lookup (a real K2 compiler change for
  reified inline functions called through an outer implicit receiver from inside a nested
  `View { }` builder block) -- fixed with the explicit labelled receiver `this@ModuleDefinition
  .Function(...)`, confirmed correct by checking `ViewDefinitionBuilder`'s own real members (it
  has no `Function` at all, only `AsyncFunction` -- the real one is inherited from
  `ModuleDefinitionBuilder`'s `ObjectDefinitionBuilder` base).
All five confirmed fixed via a real `./gradlew :map3d:compileDebugKotlin` → `BUILD SUCCESSFUL`.

## Phase 3 -- voice picker + "Record your own voice"

- **Real, shipped this round**: a dedicated `VoicePickerScreen.tsx` (search, Recommended/My
  recorded voices/All languages sections, tap-to-preview-and-select against every real voice
  actually installed on the device -- not English-only like the old inline Settings pill list
  this replaces, see `voice.ts`'s new `getAllDeviceVoices()`) with the brief's own "show the
  consent modal only the first 3 times ever" rule (persisted counter). The four named persona
  voices (Matilda, Aussie Footy Fan, Sarcastic Co-pilot, Dry Wit) are real, listed entries --
  honestly shown as "Voice not available yet" (never a silent/fake selection) until a real
  ElevenLabs API key exists, see `personaVoices.ts`/`.env.example`. A full, real guided recorder
  (`RecordVoiceScreen.tsx`) covers every clip the brief lists (31 phrases across its 5 real
  sections) -- real 6-second auto-stop recording via `expo-audio`, a real SVG countdown ring,
  real playback/re-record/delete, a real "x of N recorded" progress count, stored locally
  (`expo-file-system`) and uploaded to the signed-in driver's own private Firebase Storage
  folder (`firebase/storage.rules`, new -- owner-only, same `request.auth.uid` pattern
  `firestore.rules` already uses; **not yet deployed** -- a real `firebase deploy
  --only storage` by the project owner is needed before the real upload path can succeed in
  production, the local-save half works regardless).
- **Honestly NOT built this round**: the live navigation engine doesn't stitch these recorded
  clips together during real turn-by-turn guidance yet (the brief's own "navigation engine
  stitches clips (distance + instruction)") -- recording/storing/previewing clips is real and
  complete; wiring them into the live `speak()` call path during an active route is a separate,
  not-yet-started piece of work.
- Fixed a real, pre-existing honesty bug surfaced while touching this: the `NSMicrophoneUsageDescription`/
  `expo-audio` `microphonePermission` strings used to claim microphone audio "is never recorded
  or stored" -- true for siren listening, but now genuinely false for this real recording
  feature. Both updated to accurately describe both real uses.

## Phase 4 -- Main menu (full), Plan a Drive, Inbox

- **Real, shipped this round**: the full main-menu panel (`MainMenuScreen.tsx`) -- a Tracky
  mascot greeting, a "Plan a drive" card, a real upcoming-events section (`calendarEvents.ts`,
  real `expo-calendar` read, permission-gated, only events with a location), a real Inbox row
  with an unread badge, Invite a friend (native Share), and Help. A real `InboxScreen.tsx` (live
  feed off the same `subscribeVisibleAlerts` the map's own alert layer uses, delete + undo via a
  new `unhideAlertForUser`, an "Official" tag on police/emergency-vehicle rows). A real
  `PlanADriveScreen.tsx` (destination search/saved/recent + departure-time presets + real/
  predictive ETA via `directions.ts`'s own `useTraffic` now accepting a future Unix-seconds
  departure time, a real Google Directions API capability, never a client-side guess). Real
  Contacts integration in `WhereToSheet.tsx`'s "Drive to friends & family" row
  (`contactAddresses.ts`), previously honestly deferred for lack of the dependency.
- **Honest, deliberate scope limits, not oversights**:
  - **Tracky mascot** is a real, simple, hand-authored SVG (plain shapes, a gentle Animated-API
    bounce) per this file's own earlier-flagged limit on the brief's ~30-icon/Lottie-animation
    ask -- not a production Lottie file or original character art.
  - **Plan a Drive's departure time** is a real preset LIST (Leave now/15/30/60 min), not a
    free-form date/time picker -- there's no date-picker native dependency in this project, and
    a short preset list both matches "time list" literally and avoids adding one just for this
    screen. Only the ETA preview differs per preset; **tapping Start always begins routing right
    now** regardless of which preset was open -- this app has no scheduled/unattended-start
    capability, and the UI never implies one.
  - **Contacts** only ever reads each contact's FIRST saved address -- picking a specific one
    among several (home vs. work) isn't built.
  - **Inbox's own unread badge** is a local, per-device `AsyncStorage` counter (not synced
    across devices) -- same real scope as this app's other local-only counters (e.g. the voice
    consent-shown counter in `voice.ts`).

## Phase 5 -- Settings reorganisation (Waze-style groups)

- **Real, shipped this round**: a new `SettingsCategoriesScreen.tsx` -- a short top-level list
  (Account, Map display, Navigation & voice, Alerts & community, Vehicle & AI tools, and
  Developer in `__DEV__` only) replacing the old single ~2000-line flat scroll as the main
  menu's own Settings entry point. Tapping a category opens the exact same `SettingsScreen.tsx`,
  filtered down to that category's own real sections via a new optional `category` route param.
- **Deliberate architecture choice, not a shortcut**: this is NOT a full extraction into six
  separate screen files. `SettingsScreen.tsx`'s ~15 sections share a large amount of genuinely
  interdependent state/handlers (IAP, auth, battery, admin-key forms, etc.) all declared once at
  the top of one component -- splitting them into separate files would mean either duplicating
  that shared state across files or risk dropping/misplacing a handler somewhere in a ~2000-line
  file along the way. Instead, the one existing screen now conditionally renders only the
  sections belonging to whichever category it was opened with (`shouldShow`/
  `CATEGORY_SECTIONS`) -- every pre-existing `navigate("Settings")` call site with no category
  param keeps showing every section exactly as before, so nothing that already worked changed.
- Two existing deep links were pointed at their real relevant category instead of the generic
  list: the main menu's "Signed in as..." row now opens straight to Account, and
  `RevCheckScreen`'s "Manage provider keys in Settings" link now opens straight to Vehicle & AI
  tools.

## Phase 6 -- Polish, permissions, QA, version bump

- **Version bumped to 1.3.0** (`app.config.js`, `package.json`) -- same real reason as the 1.2.0
  bump before it: this phase's new native modules (`expo-contacts`, `expo-calendar`) need a
  genuinely new native build, and `runtimeVersion`'s `appVersion` policy uses this field to keep
  OTA updates from ever reaching an older install that has no matching native code compiled in.
- **Permission strings reviewed for accuracy** against what's actually built this session:
  `NSContactsUsageDescription`/`NSCalendarsUsageDescription` (iOS) and `READ_CONTACTS`/
  `READ_CALENDAR` (Android) added alongside their real features, both honestly describing the
  real, narrow, read-only, opt-in-at-tap-time use (see `app.config.js`'s own Phase 4a commit).
  Every other existing permission string (location/microphone/camera) was already reviewed and
  corrected earlier this session (see the Phase 3 entry above) and is unaffected by this phase.
- **"Show other Trackys" (mood avatars on the map) — deliberately NOT built, flagged for a
  product decision rather than silently skipped or silently attempted.** This is a real social/
  multiplayer-presence feature (seeing OTHER signed-in drivers' own live position + mood on the
  map), which is a materially different and more sensitive thing than anything else this app
  broadcasts: every existing shared-data feature (alerts, live traffic cameras) is either
  anonymous or official/public data, never a specific driver's own live, continuously-updating
  GPS position shared with every other nearby user. Building this needs an explicit privacy/
  opt-in design decision from the project owner first (who sees it, can it be turned off, does
  it ever reveal more than an approximate position) -- not something to decide unilaterally while
  implementing. The original spec itself already gates this on Phase 6, so this isn't a schedule
  slip, just a real decision point reached.
- **QA**: `npx tsc --noEmit` clean after every single commit this session (confirmed again at
  the end of Phase 6). `npx expo-doctor` has 4 pre-existing findings unrelated to this session's
  work (a missing `expo-camera` peer dependency required by `@tensorflow/tfjs-react-native`,
  predating this session's changes; a known Hermes V1 memory-regression warning tied to the
  current Expo SDK patch version; ~25 packages patch-version behind the SDK's latest) -- not
  fixed here, since bumping ~25 packages at once (`npx expo install --fix`) is a real risk to do
  without dedicated device testing alongside it, and none of them are caused by anything built
  this session. `npx expo lint` has a large amount of PRE-EXISTING lint debt from this session's
  very first run of the project's new, stricter React Compiler ESLint rules (surfaced once, at
  the very start of this work, never remediated project-wide) -- every new file/change made this
  session was individually lint-checked and confirmed to introduce zero NEW findings of its own,
  but the pre-existing debt itself (hundreds of `react-hooks/set-state-in-effect`/`react-hooks/
  refs` findings across files this session didn't touch) was out of scope to fix wholesale.
  A real device/simulator was not available in this environment -- every change was verified via
  `tsc`/lint/direct code reading, not by running the app; see the device test checklist handed
  over separately for what still needs a real phone.
