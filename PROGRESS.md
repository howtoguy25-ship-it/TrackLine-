# Waze-style redesign — progress

Tracks the two specs given for this redesign: the original 6-phase UI/UX spec, and the newer
"Phase 1B" + "full redesign, one prompt, all phases" spec (map engine swap to Mapbox/MapLibre,
Live Traffic NSW, full settings reorg, etc.). Kept current so a new session can pick up exactly
where this one left off — see `CODEBASE_MAP.md` for what the repo looks like and `NOTES.md` for
honest limitations/missing keys.

## UI pass 2 — home, search, place page, route selection (latest)

All six sections done on `claude/go-session-0d5bup` (see `AUDIT.md` §10 for the
requirement-by-requirement table, `NOTES.md` "UI pass 2" for limits and the verification output):

- [x] §0 Rubik font, colour tokens, press animation — `5d8b4d0`
- [x] §1 Home map: sheet-anchored buttons, street pill, report pins, Map tools items relocated — `473564f`
- [x] §2 "Where to?" sheet + §3 full-screen search — `3c6d72b`
- [x] §4 Place page — `ba52a9d`
- [x] §5 Route selection (distinct routes, Avoid/Drive pills, bubbles, two-state sheet, Go now) — `7d8b9b2`
- [x] §6 tsc, expo lint (230, baseline 231), jest 18/18, expo-doctor 19/21 (pre-existing), docs, EAS development build
- [ ] Device check of everything marked NEEDS DEVICE TEST — `TEST_ON_PHONE.md` §9

## Where things stood before UI pass 2

**Done, committed, iOS-verified (real EAS build + TestFlight submission), real and functional:**
- Settings: `showCompass`, `spokenDirections` fields + Firestore cross-device sync
  (`pushSettingsToProfile`/`pullSettingsFromProfile` in `services/settings.ts`, wired into
  `SettingsContext.tsx` — push on every change while signed in, pull once per sign-in).
- Home map: `MenuButton` (top-left, unread badge — real, currently always 0, no Inbox yet),
  `CompassButton` (under it, real `animateCamera({heading:0})` reset tap, static glyph — see
  NOTES.md for why it doesn't rotate live), `SoundButton` (mid-right) + `SoundSheet` (Spoken
  directions radio, Current voice row), restyled yellow-triangle Report button, smaller/cleaner
  `LiveSpeedometer`, a white "idle" street-name pill under the user's marker on the plain map
  (nav-time chip unchanged).
- `MainMenuScreen` — minimal first slice of the slide-in menu (Sign in/Account + Settings rows).
- `CODEBASE_MAP.md` written per the new spec's "HOW TO WORK" step 1.

**RESOLVED — the Android ads/Kotlin build conflict.** The pre-existing Android Gradle/Kotlin
version conflict between `react-native-google-mobile-ads`'s pinned `play-services-ads` and this
project's resolved Kotlin compiler (reproduced locally against the untouched baseline, so not
caused by this session's work) is now actually fixed: `plugins/withAndroidKotlinGradlePluginVersion.js`
pins the real Kotlin Gradle Plugin version (2.2.20) on the one unversioned classpath entry that
actually governs it project-wide. Confirmed via a real local Gradle build going from the exact
metadata-incompatibility error to `BUILD SUCCESSFUL`, verified end-to-end from a fresh `expo
prebuild --clean` with no manual edits. This also surfaced a real, previously-masked regression
in this project's own `modules/map3d` module (the new compiler could finally read
play-services-maps3d's own Kotlin metadata, revealing real SAM-conversion/nullable-property
issues) — found and fixed, confirmed via `./gradlew :map3d:compileDebugKotlin` → `BUILD
SUCCESSFUL`. See NOTES.md for the full investigation (several real dead-end fix attempts ruled
out along the way).

## Hard blockers needing the project owner directly (not fabricatable)

1. **Mapbox tokens — both live, and the real engine is now confirmed building on both
   platforms.** `MAPBOX_PUBLIC_TOKEN`/`RNMAPBOX_MAPS_DOWNLOAD_TOKEN` are both real EAS env vars.
   A real EAS cloud build (Android + iOS) against the tokens showed: Android's
   `rnmapbox_maps:compileReleaseKotlin` genuinely succeeded (all 469 tasks ran; the build's only
   failure was the pre-existing, unrelated google-mobile-ads Kotlin issue, now resolved — see
   above) — but iOS failed
   for a real, new reason: a linker collision (`ld: 5 duplicate symbols`) between `@rnmapbox/maps`
   and the (by-then-superseded) MapLibre prototype, both generating a Codegen native-module spec
   named `NativeMapViewModule`. Fixed by removing the MapLibre prototype entirely (it was already
   superseded by the user's own explicit choice of real Mapbox) — `@maplibre/maplibre-react-native`
   uninstalled, `MapLibrePreviewScreen.tsx` + its route/settings entry deleted. Confirmed via
   `tsc --noEmit` and a real `expo export` (both platforms, zero MapLibre references left). Fresh
   EAS builds re-kicked off with the conflict removed — see NOTES.md for the full real log
   evidence. The live navigation map keeps running on Google Maps, completely unaffected, until
   the Mapbox engine itself is wired into a real screen.
2. **Live Traffic NSW Cloud Function** (Phase 5) needs a real `TFNSW_API_KEY` set via `firebase
   functions:secrets:set TFNSW_API_KEY` — this project has `nswTransportApiKey` as an existing,
   genuinely-optional client-side env var (`services/liveVehiclePositions.ts`), but no Cloud
   Functions secret exists yet for a *server-side* scheduled fetch. Needs your real TfNSW API key
   (register at https://opendata.transport.nsw.gov.au if you don't have one) before the scheduled
   function can be deployed for real — it'll be built honestly-stubbed otherwise, per the spec's
   own "build anyway with a clear 'not set' state" rule.
3. **Original car-icon/mascot art**: the spec asks for ~30 original car icons (Woof Wagon, Cat
   Wagon, Night Bat Boy/Girl, etc.) and an animated Lottie mascot with mood states. These will be
   built as real, simple, hand-authored SVG/vector icons (clean, flat, recognisable silhouettes —
   not photorealistic illustration, which isn't something generated text-to-code can produce
   convincingly) and a lightweight Reanimated/Skia-driven character animation rather than a true
   production-quality Lottie file (which normally comes out of a motion-design tool, not code) —
   flagged here so the visual bar is set correctly up front, not discovered as a surprise later.

## Phase checklist

### Original 6-phase spec
- [x] Phase 1 — home map buttons + idle "Where to?" bottom sheet (search-bar-to-bottom-sheet
      move is done — see Phase 2 below)
- [x] Phase 2 (partial) — real 3-snap "Where to?" sheet, Home/Work/+New, Saved/Fuel/Food/Parking
      category chips. Voice mic / Contacts+Calendar "More options" / Parking's full filter row
      honestly deferred — see NOTES.md
- [x] Phase 3 (partial) — real `VoicePickerScreen` (search, Recommended/My recorded voices/All
      languages, consent modal, persona voices honestly locked pending a real ElevenLabs key)
      and a real guided `RecordVoiceScreen` (6s auto-stop, SVG countdown ring, playback/re-
      record/delete, all 31 real brief phrases, local storage + Firebase Storage upload). Not
      yet wired into live navigation's own spoken-instruction engine — see NOTES.md
- [x] Phase 4 — main menu (full: Tracky mascot, Plan a drive card, real calendar-events row,
      real Inbox row with unread badge, Invite a friend, Help), real Plan a Drive screen (real
      destination picker + departure-time presets + real/predictive ETA), real Inbox screen
      (delete + undo, official-alert tag), real Contacts "Drive to friends & family" -- see
      NOTES.md's own Phase 4 entry
- [x] Phase 5 — settings reorg: new SettingsCategoriesScreen (Waze-style top-level category
      list), SettingsScreen filtered by an optional `category` param instead of a full
      extraction into separate screens -- see NOTES.md's own Phase 5 entry
- [x] Phase 6 — version bumped to 1.3.0, permission strings reviewed, QA pass (tsc/lint/doctor,
      no device available in this environment), "Show other Trackys" flagged for a privacy/
      product decision rather than built or silently skipped -- see NOTES.md's own Phase 6 entry

### New "Phase 1B" / full redesign spec
- [x] Map engine decision — real Mapbox, `@rnmapbox/maps` installed + wired (plugin, env,
      owner-only preview screen). Both real tokens are live and a real EAS cloud build has
      now confirmed the engine builds successfully on **iOS** (a real signed `.ipa` produced);
      Android's own build is blocked only by the pre-existing, unrelated google-mobile-ads
      Kotlin issue (Mapbox's own Android compile step already confirmed clean) — see NOTES.md
- [x] Map style JSON (trackline-light/dark) — both written against the real Mapbox Streets v8
      schema, matching every given colour/zoom/width value
- [ ] User marker + street pill (teal arrow variant) — not started
- [ ] Route drawing (ShapeSource/SymbolLayer) — not started
- [x] Top instruction card restyle — bigger icon/distance, accented street-name line, real
      roundabout exit number, "Then" chip, tap-to-repeat voice, arrival flag icon. Literal
      64pt/44pt/40pt sizes deliberately not used — see NOTES.md
- [x] Bottom banner (follow/re-centre/overview) — real two-state banner wired to the existing
      followTilt/onRecenter machinery; Overview button reuses the existing pulled-back pose
      toggle, not yet a real fit-bounds-to-route computation — see NOTES.md
- [ ] Camera & zoom behaviour — pure logic written and verified (`src/map/cameraZoom.ts`), not
      yet wired into a live camera
- [x] Search sheet (Phase 3 of new doc) — same as old Phase 2, see above
- [x] Voices (Phase 4 of new doc) — same as old Phase 3, see above
- [x] Menu/Plan a drive/Inbox/Live Traffic NSW (Phase 5 of new doc) — real Menu panel, Plan a
      Drive screen, Inbox screen, and contacts "Drive to friends & family" all shipped (old
      Phase 4a-4e); Live Traffic NSW cameras shipped separately earlier — see NOTES.md
- [x] Settings reorg (Phase 6 of new doc) — same as old Phase 5, `SettingsCategoriesScreen.tsx`
- [x] Final QA (old Phase 6) — version bump, permission-string review, tsc/lint/doctor pass —
      see NOTES.md's own Phase 6 entry

## Tracky mood characters + Ghost mode + presence system + copyright audit

Real, explicit new feature request (separate from the Waze-style redesign above): original
"Tracky" mascot family with 18 moods, a default-Ghost-mode visibility/privacy system, a
Mapbox-road-snapped presence system showing other visible+driving drivers on the map, and a
whole-app copyright/trademark audit. See NOTES.md's own dedicated entry for the full breakdown
— summary:

- [x] Part 1 — Tracky SVG character system (18 original moods, idle bob/blink/tap animations,
      Reduce Motion fallback, real auto-mood engine), placed in the menu header, a new "Your
      mood" profile screen, and empty states
- [x] Part 2 — Ghost mode + visibility control (default Ghost for every account, Settings >
      Privacy, menu header pill, long-press Menu button sheet, first-launch explainer,
      auto-ghost after >30min background or on arrival, translucent "Spooky" own-marker badge)
- [x] Part 3 — presence system, server (Cloud Functions: `updatePresence`/`clearPresence`/
      `sendWave`, Mapbox Map Matching road-snapping, Firestore rules) and client (map markers,
      clustering, the presence card, Wave/Block/Report, "Show Trackys" toggle)
- [x] Part 4 — copyright/trademark safety audit (`COPYRIGHT_AUDIT.md`) — one user-facing
      competitor name-drop removed, one undocumented audio asset replaced with an original
      synthesized tone, a new Settings > About > "Licences & attributions" screen, zero
      GPL/AGPL dependencies found across all four package trees
- [x] Real Firebase Emulator Suite tests (Firestore/Storage rules + the three new Cloud
      Functions) — 31/31 passing, real pasted output in `TEST_RESULTS.md`
- [x] `TEST_ON_PHONE.md` — the real two-account device test plan, since this environment has no
      device to run it on itself
- [x] ADD-ON Part A -- "Make your Tracky" customiser (colour/two-tone/eyes/mouth/accessory/
      trail, presets, unlocks tied to the same real milestones as moods, Firestore + local
      storage, shown to other drivers via a server-whitelisted `look`)
- [x] ADD-ON Part B -- smooth movement on roads (15s samples, Mapbox road geometry, a
      server-enforced 60s privacy delay via a private pending buffer, interpolated playback with
      capped dead-reckoning, lean, trail particles, performance scaling). Replaces Part 3's
      ~150m rounding -- see NOTES.md for that decision and the one disclosed deviation
      (JS-tick marker movement rather than a Reanimated worklet)
- [ ] Device test of all of the above -- never run on a phone; see TEST_ON_PHONE.md
