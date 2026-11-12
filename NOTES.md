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

## Tracky mood characters + Ghost mode + presence system + copyright audit

A separate, later, explicit feature request (not part of the Waze-style redesign above) --
original mascot characters, a default-Ghost-mode privacy system, a real Mapbox-road-snapped
presence system showing other visible+driving drivers, and a whole-app copyright/trademark
audit. This is the real, direct answer to Phase 6's own "'Show other Trackys' — deliberately NOT
built, flagged for a product decision" note above: that decision has now actually been made
(default-off/opt-in visibility, Ghost mode first) and built for real.

Sequencing note: the user explicitly chose "Part 1-4 first, then the ADD-ON" when asked --
the ADD-ON ("Make your Tracky" full customizer + Waze-style smooth time-lapse movement on
roads) is confirmed out of scope for this pass, not started, not scaffolded.

### Requirement audit (Requirement | Status | Evidence)

| Requirement | Status | Evidence |
|---|---|---|
| Original Tracky design -- map-pin blob, not droplet/"wazer"-shaped | DONE | `TrackyBody.tsx` -- hand-written cubic-bezier pin-blob path, own header comment explains the deliberate non-resemblance |
| Flat vector, 1 inner shadow, 2px darker outline, top highlight, no gradients | DONE | `TrackyBody.tsx` -- `shadeColor()`-derived outline/shadow/highlight, no `LinearGradient` used |
| Hand-written SVG, no downloaded/traced art or restrictive icon packs | DONE | Confirmed via `COPYRIGHT_AUDIT.md`'s own asset pass -- every Tracky SVG is original paths written this session |
| At least 16 moods, each own color+face+accessory | DONE | `moods.ts` -- 18 real entries (`TRACKY_MOOD_ORDER`), each with its own color/eyeStyle/mouthStyle/accessory |
| Idle bob (2s loop) + blink every 3-5s, reanimated | DONE | `Tracky.tsx` -- `withRepeat`/`withSequence` bob, randomized `setTimeout` blink interval |
| Tap = squash-and-stretch + mood reaction | DONE | `Tracky.tsx` -- tap-triggered squash shared value |
| Reduce Motion -> static | DONE | `useReduceMotion.ts`, gates `shouldAnimate` in `Tracky.tsx` |
| Auto mood: time-of-day, streak≥3 Excited/≥7 Party, rain if weather key set, manual override | DONE | `trackyMood.ts`'s `resolveAutoMood`/`isRainingAt` (real OpenWeatherMap call, honestly `false` with no key) |
| Menu header (96pt + speech bubble "Hey <name>" + View profile) | DONE | `MainMenuScreen.tsx`'s `mascotRow` |
| Profile -> "Your mood" grid (lock hints, selected ticked) | DONE | `TrackyProfileScreen.tsx` |
| Map markers for OTHER users, 32pt | DONE | Built as part of Part 3 (originally deferred there in the spec itself) -- `MapScreen.tsx`'s `visiblePresenceClusters` render, `size={32}` |
| Inbox/empty states: small Tracky illustrations | DONE | `InboxScreen.tsx`'s `ListEmptyComponent` |
| Mood stored in Firestore `users/{uid}.mood` + locally | DONE | `trackyMood.ts`'s `pushMoodToProfile`/`getLocalMoodState` |
| Pill on Menu header + Settings > Privacy, Visible<->Ghost | DONE | `MainMenuScreen.tsx`'s `visibilityPill`, `SettingsScreen.tsx`'s Privacy section |
| Long-press Menu button -> sheet, big switch + explanation | DONE | `VisibilitySheet.tsx`, wired to `MenuButton`'s new `onLongPress` |
| Visibility radio: everyone/friends only/ghost | DONE | `VisibilitySheet.tsx` + `SettingsScreen.tsx`, same three `VISIBILITY_OPTIONS` |
| Default for new users: GHOST MODE | DONE | `DEFAULT_SETTINGS.visibility = "ghost"` in `settings.ts` -- also applies to every pre-existing install, which never explicitly opted in either |
| First-launch explainer | DONE | `GhostModeExplainerModal.tsx`, shown once via `hasSeenGhostModeExplainer` |
| Auto-ghost after >30min background or on arrival | DONE | `useAutoGhostMode.ts` (AppState timer) + `autoGhostOnArrival` inside `MapScreen.tsx`'s `exitNavigation` |
| Own marker: translucent "Spooky" outline when hidden | DONE | A separate small badge `Marker` next to (not replacing) the real position marker -- see its own comment for why the real heading-critical `CarNavArrow` was deliberately left untouched |
| Still see others + report, anonymous unless "Show my name on reports" | DONE | `settings.showNameOnReports`, read server-side in `updatePresence` |
| Only visible+driving shown | DONE (client-side window) | The app records its speed alongside every 15s sample and reports the FASTEST it has gone in the last 5 minutes, so `updatePresence`'s >15km/h gate now means "has driven above 15km/h in the last 5 minutes" -- a red light at the once-a-minute tick no longer withdraws the driver. The window lives on the client (`MapScreen.tsx`'s sampler); the server still trusts the reported speed, exactly as it did before, so this is not a tamper-proof check -- it never was, and a client that lies about speed only affects whether its OWN Tracky is shown |
| Position via Cloud Function ONLY | DONE | `firestore.rules`' `presence/{uid}`: `allow write: if false` -- only `updatePresence`/`clearPresence`'s Admin SDK writes ever succeed |
| Snapped to nearest road (Mapbox Map Matching, per user's explicit choice) | DONE | `updatePresence`'s real Map Matching API call, with an honest fallback to the raw point if it fails -- verified for real in `TEST_RESULTS.md` |
| Rounded ~150m | **SUPERSEDED by the ADD-ON** | Was `roundToPresenceGrid()`. Replaced in ADD-ON Part B by a server-enforced 60s delay, because grid-snapped points can't follow a road -- see the ADD-ON section below and the Privacy Policy's own "What changed in this version" note |
| heading/mood/displayName(if allowed)/updatedAt, never raw GPS history | DONE | `updatePresence`'s own `presenceDoc` object; one doc per uid, overwritten not appended -- no history collection exists at all |
| Updates every 60s while driving | DONE | `MapScreen.tsx`'s `setInterval(tick, 60000)` effect |
| Never within 500m of Home/Work/trip start/destination | DONE | `updatePresence`'s `exclusionPoints`/`haversineMeters` check -- verified for real in the emulator test suite (the "suppresses presence... within 500m" test). Trip START was a real gap found in the final QA re-read: the app only sent a start point when a custom starting point had been picked, so an ordinary trip's start was never excluded. The sampler now captures the driver's own position when the trip begins and sends that -- client change only, typechecked and linted, not run on a device |
| Auto-delete 2min after last update, or immediately on arrival/ghost mode | DONE | Real Firestore `expireAt` TTL field (+ `cleanupExpiredPresence` belt-and-suspenders) for the 2min case; `callClearPresence()` fired the instant `settings.visibility` becomes `"ghost"`, which covers both the manual toggle and `autoGhostOnArrival` |
| Rules: own-write-only via function, rounded-read-only, no uid-history queries | DONE | See `firestore.rules`' own `presence/{uid}` comment -- verified for real in the emulator rules-test suite |
| Map shows max 50, clustered "+12" bubble | DONE | `MAX_VISIBLE_TRACKYS = 50`, closest-first cap, then the same `clusterPoints` this screen's other viewport layers already use |
| Tap -> card: mood, name/"A Tracky", "Driving on <road>", Wave (rate-limited, blockable), Block, Report | DONE | `PresenceCard.tsx` -- road name resolved on-demand via the existing `reverseGeocode` |
| Settings > Map shortcuts > "Show Trackys" toggle | **DONE (section name differs)** | Spec says "Map shortcuts"; this app's real existing section for this kind of toggle is "Map layers" (same section `showTrafficLights`/`showSpeedCameras` already live in) -- `showTrackysOnMap` was added there instead of inventing a new, inconsistent section just to match the spec's exact wording |
| Block/report from card | DONE | `PresenceCard.tsx`'s Block/Report rows, `presence.ts`'s `blockUser`/`reportUser` |
| Privacy Policy updated with exact data shared/rounding/retention/opt-out | DONE | `web/public/privacy.html`'s new "Presence — showing you to other drivers" section |
| Copyright/trademark audit: brand names searched + replaced | DONE | `COPYRIGHT_AUDIT.md` section 1 -- one real user-facing finding (a direct "Waze" name-drop in `HelpScreen.tsx`), fixed |
| Every image/SVG/Lottie/font/sound listed with source+license | DONE | `COPYRIGHT_AUDIT.md` section 2 + `LicensesScreen.tsx` -- one real finding (an undocumented audio asset), replaced with an original synthesized tone |
| Sounds/voices: original or CC0, no celebrity-imitating voices | DONE | `COPYRIGHT_AUDIT.md` section 3 -- no bundled voices at all yet (ElevenLabs persona voices remain honestly locked, no key configured) |
| `npx license-checker --summary`, flag GPL/AGPL/unknown | DONE | `COPYRIGHT_AUDIT.md` section 4 -- run across all four package trees (root/web/functions/tests), zero GPL/AGPL found, every other flagged entry individually reviewed |
| About > "Licences & attributions" screen | DONE | `LicensesScreen.tsx`, Settings > About |
| `npx tsc --noEmit` clean | DONE | Confirmed clean after every single commit in this feature, re-verified at the end |
| Tested with two test accounts (visible + ghost) on dev build/emulator | **PARTIAL (disclosed)** | No physical device or Android/iOS emulator image exists in this environment -- confirmed honestly, same as every earlier phase's own QA note. What WAS run for real: the Firebase Emulator Suite (Auth/Firestore/Functions/Storage), 31/31 tests passing against the real rules and the real `updatePresence`/`clearPresence`/`sendWave` functions (`TEST_RESULTS.md`). The real two-device UI test is written up step-by-step in `TEST_ON_PHONE.md` for the user to run themselves |
| AUDIT-style table for this feature | DONE | This table |
| `COPYRIGHT_AUDIT.md` | DONE | Written, see above |
| Commit + update PROGRESS.md/NOTES.md + list files changed | DONE | This entry + `PROGRESS.md`'s own new section; full file list below |
| ADD-ON (customizer + smooth movement) | DONE (never run on a device) | Built after Parts 1-4 as sequenced -- see the ADD-ON section below |

### Files changed (full list, this feature only)

New: `src/components/trackys/{Tracky.tsx,TrackyBody.tsx,parts.tsx,accessories.tsx,moods.ts,index.ts}`,
`src/hooks/{useReduceMotion.ts,useTrackyMood.ts,useAutoGhostMode.ts}`,
`src/services/{trackyMood.ts,presence.ts}`,
`src/screens/{TrackyProfileScreen.tsx,VisibilitySheet.tsx,PresenceCard.tsx,LicensesScreen.tsx}`,
`src/components/GhostModeExplainerModal.tsx`,
`.github/workflows/firebase-deploy.yml`, `DEPLOY.md`, `TEST_ON_PHONE.md`, `TEST_RESULTS.md`,
`COPYRIGHT_AUDIT.md`, `assets/sounds/generate_chime.py`,
`firebase/tests/{README.md,package.json,firestore.rules.test.js,functions.test.js,storage.rules.test.js}`.

Modified: `src/screens/{MainMenuScreen.tsx,InboxScreen.tsx,MapScreen.tsx,SettingsScreen.tsx,SettingsCategoriesScreen.tsx,HelpScreen.tsx}`,
`src/navigation/RootNavigator.tsx`, `src/components/MenuButton.tsx`,
`src/services/settings.ts`, `src/config/env.ts`, `app.config.js`, `.env.example`,
`firebase/functions/index.js`, `firebase/firestore.rules`, `firebase.json`, `.gitignore`,
`web/public/privacy.html`, `modules/yamnet-siren/README.md`,
`assets/sounds/speed_warning_chime.wav` (regenerated, not hand-edited).

Deleted: `src/components/TrackyMascot.tsx` (superseded by `src/components/trackys/`).

### QA

`npx tsc --noEmit` clean after every commit. `npx expo lint` re-run after every commit and
diffed against a clean pre-feature baseline (234 problems) each time -- every new finding this
feature actually introduced was fixed before committing; the final state matches that same
234-problem baseline exactly, meaning this whole feature added zero new lint debt on top of the
pre-existing, already-disclosed debt from earlier in this session. The Firebase Emulator Suite
ran for real (not simulated) -- see `TEST_RESULTS.md`, including a real environment-specific
proxy quirk hit and documented along the way (`firebase/tests/README.md`). No physical
device/emulator image was available for the real on-device two-account test; `TEST_ON_PHONE.md`
hands that off completely.


## Upgrade to SDK 58 after launch

**To do after launch, not before: upgrade from Expo SDK 57 to SDK 58.** Deliberately held on 57
for launch -- a full SDK upgrade this close to release is a risk with no user-facing benefit.

State of SDK 57 as of this note:

- `expo` is on **57.0.32** (was 57.0.6), with every Expo package brought to the matching SDK-57
  patch by `npx expo install expo@~57.0.23 --fix`. React Native moved 0.86.0 -> 0.86.3 with it.
- **EAS builds iOS with Xcode 27.1** (confirmed from a real build log: image
  `macos-tahoe-26.6-xcode-27.1`). The iOS 27 SDK requires the UIKit scene lifecycle, which on
  SDK 57 is opt-in: `expo-build-properties` -> `ios.enableSceneSupport: true` in
  `app.config.js`. Verified by generating the iOS project (`expo prebuild`): the scene manifest
  is in Info.plist and AppDelegate adopts `ExpoReactNativeFactoryProvider`. **Not yet verified
  by a real build or on a phone.**

When doing the SDK 58 upgrade, three things here become removable -- check each rather than
carrying them forward blindly:

1. `ios.enableSceneSupport` (and `expo-build-properties` itself, if nothing else uses it by
   then) -- SDK 58 adopts scenes by default.
2. `patches/expo-modules-jsi+57.1.3.patch` -- it removes `-quiet` from a nested `xcodebuild`
   call, working around an Xcode 27 false "build failed" that is fixed upstream in
   `expo-modules-jsi@58.0.12`. (Regenerated from the 57.0.3 version of the same patch when the
   package moved to 57.1.3; the flag was still there.)
3. `patches/react-native+0.86.3.patch` -- re-check against whatever React Native SDK 58 brings.

`npx expo-doctor` after the update: 19 of 21 checks pass (was 17). The two that remain are
old and unrelated to the update: `expo-camera` is a declared peer of
`@tensorflow/tfjs-react-native` and isn't installed, and the local native modules have no
React Native Directory entry (they aren't published packages).

## ADD-ON -- "Make your Tracky" customiser + smooth movement on roads

Built after Parts 1-4, per the user's own sequencing choice.

### Part A -- customiser

- `customization.ts` is the design model: body colour (+ optional two-tone bottom), eyes, mouth,
  one accessory (with a tint for the three that actually take one), and a trail effect, plus a
  six-design presets gallery. `TrackyCustomizerScreen.tsx` edits a local draft with a live
  animated preview and only writes on Save.
- **Unlocks reuse the real milestones the moods already use** (3-day/7-day driving streak, Ghost
  mode, birthday) rather than a new invented currency. Colours, eyes and mouths are never locked.
- Stored as compact JSON at `users/{uid}.trackyCustomization` and locally, same two-tier pattern
  as moods/settings. `useTrackyAppearance` is the one place that resolves mood-vs-custom.
- A custom design travels on the driver's presence doc as `look`, **whitelisted field by field on
  the server** (`sanitizeLook`) since it's rendered on other people's phones. The server does
  NOT re-check whether an accessory/trail is actually unlocked -- the driving streak behind
  those only exists on the driver's own device. It's a cosmetic gate, not a security one.
- **Real bug found and fixed along the way** (from the earlier mood work): every hook instance
  kept its own copy of the mood state, so picking a mood left the still-mounted menu header
  showing the old one. Both stores now notify every mounted instance.

### Part B -- smooth movement

How it works, end to end:

1. The driver's phone samples GPS every 15s and sends the batch once a minute, each sample as an
   AGE (ms ago) rather than a timestamp, so nothing depends on the phone's clock.
2. `updatePresence` map-matches the batch and keeps Mapbox's matched road geometry, timing each
   vertex by distance along it (`timeAlongGeometry`).
3. **The 60s privacy delay is enforced on the server.** New points go into
   `presencePending/{uid}`, which no client can read (rules-tested, including the owner), and are
   copied into the readable `presence/{uid}` doc only once they're at least 60s old.
4. Viewers replay each driver's path 120s behind the moment its update was written (60s delay +
   60s between updates), so one batch plays out exactly until the next arrives
   (`presencePlayback.ts`). If an update is late: dead-reckon along the last segment for at most
   20s at a capped speed, then stop.
5. `PresenceLayer.tsx` moves the markers, leans each Tracky into its direction of travel, draws
   trail particles, and scales its own work down as more Trackys are on screen.

Decisions and deviations, stated plainly:

- **The ~150m grid rounding from Part 3 is gone.** It can't coexist with on-road movement. The
  protection for a moving Tracky is now the delay + road-snapping + the 500m exclusion zones,
  and the Privacy Policy says so explicitly. Published points are road-accurate (~1m) but never
  less than a minute old. To go back, restore a rounding step where `roundCoord` is applied in
  `updatePresence` -- at the cost of Trackys leaving the road.
- **The displayed lag is ~2 minutes, not 60s.** 60s is the minimum age of any published point;
  the extra minute is the once-a-minute batching. Sending every 15s would cut that to ~75s at
  4x the Cloud Function and Mapbox Map Matching calls per driver.
- **A driver now appears ~2-3 minutes after starting**, not after the first minute -- their
  first batch is entirely inside the delay window. And the last minute before they stop is
  never published at all.
- **Heading is derived from the published path**, not sent from the phone's compass -- the live
  heading is "right now" information, which is exactly what the delay withholds.
- **"Reanimated interpolated movement" -- DEVIATION.** The interpolation is real, but it's a JS
  tick (4/s down to 1/s) moving each native Marker's `coordinate`, isolated in its own component
  so MapScreen doesn't re-render. Animating a react-native-maps Marker's coordinate from a
  Reanimated worklet couldn't be verified without a device, and a layer that silently doesn't
  move is worse than one that moves at 4 updates/second. Worth revisiting on a real phone.
- **"Rotation/tilt"** is a lean of up to 14 degrees from the east-west part of the heading, not
  a full rotation -- a Tracky is a face, and a full rotation would turn it upside down heading
  south. (The Part 3 code did exactly that; fixed here.)
- **Trail particles** are only drawn with 12 or fewer Trackys on screen, and not at all under
  Reduce Motion.
- **Real bug found and fixed** (from Part 3): the once-a-minute update read speed/mood from the
  closure created when the route started -- while the car was still stationary -- so the 15km/h
  gate was comparing against a frozen ~0 and would never have sent on a real drive.

### Final QA re-read (three real fixes, all in the sampler in `MapScreen.tsx`)

Nothing here could be run on a device, so the last pass was a line-by-line re-read. It found:

- **The timers restarted on every reroute.** The sampler effect depended on the `route` and
  `user` objects, and a reroute replaces the route object -- each one threw away the buffered
  samples and reset the once-a-minute send clock. A trip that rerouted more often than once a
  minute would never have sent an update. Now keyed on "is a route active" and the uid.
- **An ordinary trip's start was never excluded.** See the 500m row in the table above.
- **A red light could withdraw a driver for ~2 minutes.** See the "Only visible+driving" row.

### The failed Android development build (EAS `33d26c26`) -- corrected diagnosis

First put down to the old google-mobile-ads Kotlin conflict. That was wrong, and the build log
says so: `Gradle build daemon disappeared unexpectedly` in the middle of compiling native C++
for all four Android chip types at once -- the build machine ran out of memory. (The Kotlin
conflict really is fixed; production Android builds have finished since.) The development
profile in `eas.json` now builds `arm64-v8a` only. **That fix has not been proven by a build**
-- no development build has been run since; the production profile is untouched.

### What has and hasn't been verified

- Verified by real runs (`TEST_RESULTS.md`): 59/59 emulator + unit tests, including the privacy
  delay holding fresh points back and nothing under 60s old being published; 19/19 playback-maths
  checks. `tsc` clean; lint identical to the 234-problem pre-feature baseline.
- **Not verified at all:** anything on a device. The customiser screen, the map layer actually
  moving markers, the lean, the trail particles, and the sampler have never run. No real Mapbox
  response has ever been received by this code (tests use a fake token). `TEST_ON_PHONE.md`
  covers what to check.

## UI pass 2 (home, search, place page, route selection) — limits and deviations

- **Map engine:** still react-native-maps (Google). Mapbox stays deferred.
- **Route choices cost more per request.** The route-selection screen makes one Routes API
  `computeRoutes` call per destination (and one per Avoid toggle) with `TRAFFIC_ON_POLYLINE` and
  `TOLLS` extra computations — that's Google's higher-priced Routes tier, not the plain
  Directions rate. It replaces the old screen's five parallel Directions requests plus a toll
  lookup. If the Routes API refuses the key, it falls back to the classic Directions API's
  alternatives; the slow/jammed stretches and "· Toll" are then blank.
- **Avoid: unpaved roads and difficult intersections** are shown greyed out — Google routing has
  no option for either. **U-turns** are avoided by dropping routes whose steps contain a U-turn;
  if every route has one they're shown anyway, with a note in the Avoid sheet.
- **A trip with a stop shows one route** — the Routes API returns no alternatives when there is an
  intermediate waypoint.
- **"Via <road>"** is Google's own route description; when Google doesn't give one the line is left
  out rather than guessed. For routes from the Routes API, the turn card's street name is read out
  of the English instruction ("Turn left onto George St" → "George St"); other languages show the
  whole sentence, as before.
- **Go now** auto-start runs for driving only, once per destination; any touch anywhere on the
  screen stops it for that destination.
- **Audio player** button opens the driver's music app (Spotify / Apple Music / YouTube Music); it
  has no in-app playback controls.
- **Nearest station** row says "Walking directions to the closest stop" — live departures would
  need the TfNSW Trip Planner API, which isn't wired.
- **Place page** calls a car park within 40 m "Car park at this place"; otherwise the nearest one
  within 800 m with a walk time (straight line × 1.3 at 80 m/min).
- **Root Jest** was added (`jest-expo`, `@react-native/jest-preset@0.86.3` to match RN 0.86) for the
  pure-logic unit tests in `__tests__/`. The wider plain checks stay in `scripts/test-*.ts`.

### UI pass 2 — verification (2026-11-12, after §5)

```
$ npx tsc --noEmit
(exit 0, no output)

$ npx expo lint
✖ 230 problems (191 errors, 39 warnings)      # baseline before the pass: 231 — no new problems

$ npx jest
PASS __tests__/uiPass2.test.ts
  route de-duplication (5)  traffic label thresholds (6)  street-pill lookup throttle (3)
  distance formatting (2)  floating buttons above the half sheet (2)
Tests:       18 passed, 18 total

$ npx expo-doctor
19/21 checks passed. 2 checks failed.
✖ Missing peer dependency: expo-camera (required by @tensorflow/tfjs-react-native)
✖ React Native Directory: react-native-fast-tflite untested on New Architecture;
  no metadata for local modules audio-route, map3d, yamnet-siren, vision-camera-resize-plugin, live-activity
# both pre-existing and unchanged by this pass

$ npx tsx scripts/test-ui-logic.ts        61 checks passed
  (+ nav-speech 32, nav-language 21, parking-filters 20, drive-link 11, traffic-nsw 14, presence-playback 19)
$ firebase emulators:exec … "npm --prefix firebase/tests test"
Test Suites: 6 passed, 6 total — Tests: 126 passed, 126 total
$ npx expo export --platform ios          iOS Bundled (2774 modules), exit 0
```

### UI pass 2 — EAS development build

- **Android** `94283ddc-7980-4a5b-8b08-623ef06274c8` (profile `development`, commit `14aaaae`,
  arm64-only debug APK). A duplicate queued by mistake (`a3e2618b…`) was cancelled before it started.
- **iOS**: not started from this session. EAS needs an ad-hoc provisioning profile for the Live
  Activity widget target (`com.trackline.navigate.widget`) and can only create one interactively —
  run `eas build --profile development --platform ios` from your own terminal once.


## Bug fix — buttons don't respond / nothing navigates (keyboard pops up on the Menu)

**Root cause (main):** the Main menu was registered as a native `transparentModal`. On iOS,
react-native-screens' native stack keeps every ordinary ("push") screen on the base navigation
controller and presents modals on top of it — so every screen opened from the Menu (Plan a drive,
Settings, Inbox, Help, Sign in, Tracky profile…) was pushed *underneath* the Menu. The row showed
its press highlight and then nothing visible happened. Plan a drive's destination field has
`autoFocus`, so opening it behind the Menu raised the keyboard "by itself" on top of the Menu.
The same trap existed for the dashcam (a `fullScreenModal`), whose "Run REV Check" pushed REV
Check behind the camera.

**Fixes**
- `RootNavigator.tsx`: Main menu is an ordinary stack screen (it is an opaque full-screen panel,
  so it never needed to be a modal). REV Check and document scan are presented as modals, so they
  appear above the dashcam. REV Check's "Manage keys in Settings" closes the modals before opening
  Settings. The rule lives in `src/navigation/modalStack.ts`.
- Dev-only guards: `onUnhandledAction` warns for a navigate() to an unknown screen;
  `onStateChange` warns if a push screen ever sits above a modal again.
- `PressableScale`: the Pressable itself is now the animated, sized element (it used to be a
  `flex:1` child of an Animated.View, which can collapse to a zero-height touch area when the
  wrapper's height isn't fixed). Still forwards onPress / onLongPress / disabled.
- Full-screen search: uses the Modal's native slide instead of a Reanimated `entering` animation
  inside the Modal (a layout animation that doesn't run would leave an invisible full-screen
  layer swallowing taps). The search field is only mounted while the search is open.
- `HomeMapControls`: touchability starts from the sheet's real position on first render.
- `react-native-gesture-handler` is the first import in `App.tsx`; `GestureHandlerRootView` already
  wrapped the app once.
- `keyboardShouldPersistTaps="handled"` on every ScrollView/FlatList (23 lists).
- **Touch debugger (dev builds only):** Settings › Developer › Touch debugger. Every touch draws a
  red outline + component name around the view that actually received it, and logs
  `[touch] <component>`; every screen change logs `[press] <component> -> <screen>`.

**Overlay audit** (everything drawn above the screens): Where-to sheet — `box-none`, never covers
more than itself; full-screen search, Avoid/travel-mode sheets, contacts/events/naming dialogs,
place-page "More" menu — mounted only while open; street pill — `pointerEvents="none"`; floating
map buttons — `pointerEvents="none"` once faded; Re-centre — `none` while hidden; ad banner — its
own row below the map, not over it; Tracky/presence pins and dashcam badge — map markers /
`none`; splash — native, hidden once fonts load; keypad number row — iOS `InputAccessoryView`
attached only to the search field, Android row only while that field is focused.

## Mapbox map (branch `mapbox-map`) — limits and decisions

- **Mapbox is the only map.** `react-native-maps` (+ its patch and config plugin) is removed; the
  Google style JSON (`utils/mapStyle.ts`) now only names the Settings choices. If a build has no
  Mapbox native SDK or token, the map area says so instead of drawing a map.
- **Tokens:** runtime public token from `EXPO_PUBLIC_MAPBOX_TOKEN`, falling back to
  `MAPBOX_PUBLIC_TOKEN` (the name already stored in EAS — there is no `EXPO_PUBLIC_MAPBOX_TOKEN`
  in EAS yet). Build-time `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` (sensitive, in EAS). Telemetry off.
- **Label font:** Rubik isn't on Mapbox's glyph server; uploading it needs a Mapbox Studio step
  with an account token that has fonts:write. Map labels use Mapbox's "DIN Pro" (closest
  geometric sans) with Arial Unicode as fallback. Everything outside the map is still Rubik.
- **Zoom scale:** the camera code was tuned on Google's 256px-tile zoom; Mapbox tiles are 512px,
  so the map handle subtracts 1 (`geo.ts MAPBOX_ZOOM_OFFSET`) — follow zoom 17 etc. look the same.
- **Business taps:** Mapbox has no Google place IDs on its map, so a tap on a POI label is
  resolved with a Google Places text search at that spot (one extra Places request per tap).
- **3D:** Google's photoreal Map3DView overlay is no longer shown; "3D buildings" now raises
  Mapbox's own buildings once the camera is tilted past 30°. The `map3d` native module is still
  installed (unused) — remove it in a follow-up to drop the Google Maps 3D SDK from builds.
- **Clusters** keep the app's existing grid clustering (reports, OSM, venues, Trackys); cluster
  badges now show a coloured circle with the count (the old row-of-glyphs badge is gone).
- **Simulate drive** (dev builds): a button during navigation plays the remaining route as GPS at
  50 km/h through the GPS-replay channel.
- **Not verified on a device.** Every visual/feel item is in `TEST_ON_PHONE.md` §11.

### Mapbox migration — verification (2026-11-12)

```
$ npx tsc --noEmit                (exit 0)
$ npx expo lint                   ✖ 218 problems (184 errors, 34 warnings)   # was 230 before
$ npx jest                        Test Suites: 10 passed — Tests: 107 passed
  (__tests__/mapV2.test.ts: style rules, route drawing, camera, re-centre, auto-zoom,
   pin clustering, simulate drive — 32 tests)
$ gl-style-validate               trackline-light / dark / satellite-streets: exit 0
$ npx tsx scripts/test-*.ts       61 + 32 + 21 + 20 + 11 + 14 + 19 checks passed
$ npx expo export --platform ios  iOS Bundled (2753 modules), exit 0
```

## Buttons, icons and colour meaning — limits and decisions

- **The go blue is `#0098FF`, not `#0099FF`.** White on `#0099FF` measures 2.9998:1, a hair under
  the 3:1 large-text minimum; one step darker on the green channel clears it (3.03:1) and looks
  identical. Primary and final-confirm labels are always 18pt semibold so they count as large text.
- **Blue and red TEXT use darker shades of the same hue** (`#0062B8`, `#B8262B`), because
  `#0099FF` / `#E5484D` as text on white or light grey don't reach 4.5:1 — and the shades still
  pass on those fills pressed 6% darker. Green text is `#0B7A3B` for the same reason. Fills keep
  the brief's exact values.
- **Report glyphs** are white where white reads (3:1+) and ink where it doesn't (hazard, roadwork,
  chat), so every pin passes.
- **Map traffic lines use the brief's exact colours and are not held to 3:1.** Slow amber on a
  white road is 2.0:1 and heavy red over the purple route 1.6:1. Traffic is never shown by colour
  alone — every route also says "Light / Typical / Heavy traffic" — so the lines are supplementary;
  the test records the ratios so a change is deliberate.
- **Dark mode is partial.** The whole button family (floating buttons, chips, buttons) and the
  traffic words switch to the dark palette when the map's Dark theme is on. The sheets and full
  screens are still light: their styles are static and converting every screen is its own job.
- **Re-centre stays 58pt** (the home-screen brief) while other floating buttons are 56pt.
- **Map artwork keeps its own drawings**: the user-chosen alert icon themes, OSM marker glyphs and
  map pins still use their icon packs. Every UI icon is a Lucide line icon (ISC licence).
- **List rows, cards and tiles** stay plain Pressables with their own layout; anything shaped like
  a button is a `Button`, `Chip` or `FloatingButton` (a test scans for it).
- **Reduce Motion** turns off the Go now countdown entirely (no fill, no auto-start; tap Go now),
  Tracky's idle bob, press scaling (the 6% darken stays) and the appear rise (a plain fade stays).
