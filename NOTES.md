# TrackLine — platform/data limitation notes

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
