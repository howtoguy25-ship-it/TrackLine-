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

- **No real Mapbox account/tokens exist yet.** `@rnmapbox/maps` is installed and wired up
  (config plugin, env scaffolding, an owner-only `MapboxMapScreen` preview reached the same way
  the existing MapLibre prototype is), but shows a real, honest "Mapbox not configured yet"
  screen instead of a map, because `MAPBOX_PUBLIC_TOKEN`/`RNMAPBOX_MAPS_DOWNLOAD_TOKEN` are both
  unset. **Critical, confirmed-real safety detail**: `@rnmapbox/maps`'s own JS
  (`RNMBXModule.js`) throws immediately at *module import time* if its native code isn't
  linked -- not a soft runtime failure. Its own `@rnmapbox/maps` Expo config plugin is therefore
  only added to `app.config.js`'s plugins array when `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` is actually
  set (so the native module is never linked without it), and `MapboxMapScreen.tsx` only ever
  reaches the package via a deferred `require()` inside a function gated on
  `isMapboxAvailable()`, never a static `import` -- confirmed safe by an actual `expo prebuild`
  for both platforms showing zero Mapbox references in the generated Podfile/Gradle files, and a
  real `expo export` for both platforms succeeding. Until real tokens exist, the live navigation
  map keeps running on Google Maps exactly as before, completely unaffected.
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
- **Android builds with ads are currently broken by a pre-existing Kotlin/Gradle dependency
  conflict, unrelated to anything built this session.** `react-native-google-mobile-ads`'s own
  pinned `com.google.android.gms:play-services-ads:25.4.0` ships Kotlin metadata the project's
  resolved Kotlin compiler can't read ("Module was compiled with an incompatible version of
  Kotlin. The binary version of its metadata is 2.3.0, expected version is 2.1.0") — confirmed
  real by reproducing a full `./gradlew :app:assembleDebug` locally against a real Android SDK
  (the untouched baseline, before any Phase 1 change, hits this too). Tried three real levers to
  bump the resolved Kotlin version -- a direct `ext.kotlinVersion` assignment in the generated
  root `build.gradle`, the documented `android.kotlinVersion` Gradle property Expo's own
  autolinking-settings plugin reads to override its version catalog, and several target versions
  (2.3.0, 2.4.0, 2.4.21) -- confirmed via `./gradlew :react-native-google-mobile-ads:dependencies
  --configuration debugCompileClasspath` that NONE of them actually changed the Kotlin stdlib
  version that module's own classpath resolves to (stayed pinned at 2.1.20 throughout), meaning
  the real lever is somewhere deeper in Gradle's own plugin-version resolution this pass didn't
  find. One of the attempts also made `@maplibre/maplibre-react-native`'s latest release (11.5.1,
  an owner-only internal prototype, not the live map) fail to compile with an internal Kotlin K2
  compiler crash -- almost certainly a side effect of the same unresolved mismatch, not a
  maplibre-specific bug, so that attempted exclusion was reverted along with the rest. **Net
  effect: Android ads builds are blocked exactly as they would have been before this session**
  -- iOS is completely unaffected (no Gradle/Kotlin involved) and has built/submitted cleanly
  throughout. Next real avenues, not yet tried: upgrading `react-native-google-mobile-ads` past
  16.4.0 (current latest is 17.4.0, pins an even newer `play-services-ads` so may not help
  alone), or finding the actual `pluginManagement`/plugin-resolution pin for Kotlin that
  `./gradlew :app:buildEnvironment` didn't surface in this pass.
- **Main menu panel is a minimal first slice** (Sign in/Account + Settings rows only) --
  the full designed panel (Tracky mascot, "Plan a drive" card, calendar events, Inbox, Invite a
  friend, Help) is Phase 4's own build. The Menu button's unread badge count is real (always 0
  right now) rather than fake, since there's no Inbox data model yet to count against.
