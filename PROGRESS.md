# Waze-style redesign — progress

Tracks the two specs given for this redesign: the original 6-phase UI/UX spec, and the newer
"Phase 1B" + "full redesign, one prompt, all phases" spec (map engine swap to Mapbox/MapLibre,
Live Traffic NSW, full settings reorg, etc.). Kept current so a new session can pick up exactly
where this one left off — see `CODEBASE_MAP.md` for what the repo looks like and `NOTES.md` for
honest limitations/missing keys.

## Where things stand right now

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

**Investigated, reverted (not shipped — see NOTES.md for the full story):** a pre-existing
Android Gradle/Kotlin version conflict between `react-native-google-mobile-ads`'s pinned
`play-services-ads` and this project's resolved Kotlin compiler blocks Android ads builds.
Reproduced locally against the untouched baseline (so **not** caused by this session's work).
Tried three real fix mechanisms across several target Kotlin versions; none actually changed the
resolved compiler version for that module (confirmed via `gradlew :module:dependencies`). Reverted
rather than ship something broken or guessed. iOS is unaffected and has shipped twice since.

## Hard blockers needing the project owner directly (not fabricatable)

1. **Mapbox tokens — decided, waiting on the real values.** You chose real Mapbox over the free
   MapLibre alternative. `@rnmapbox/maps` is installed and wired up (conditional config plugin,
   env scaffolding in `.env.example`, an owner-only `MapboxMapScreen` preview) — see NOTES.md for
   the full real-build-safety story (the package throws at import time with no native module
   linked, so the plugin only activates once a real download token exists). Still needed from
   you, both from mapbox.com → Account → Tokens:
   - `MAPBOX_PUBLIC_TOKEN` — a normal public token.
   - `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` — a token with "Downloads:Read" scope, set as a real EAS
     secret: `eas secret:create --scope project --name RNMAPBOX_MAPS_DOWNLOAD_TOKEN --value <token> --type string`.
   The live navigation map keeps running on Google Maps, completely unaffected, until both exist
   and a real build can be attempted against them.
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
- [x] Phase 1 (partial) — home map buttons; search-bar-to-bottom-sheet move still pending
- [ ] Phase 2 — bottom search sheet
- [ ] Phase 3 — voice picker + recording
- [ ] Phase 4 — main menu (full), plan a drive, inbox
- [ ] Phase 5 — settings reorg
- [ ] Phase 6 — polish/QA/version bump

### New "Phase 1B" / full redesign spec
- [x] Map engine decision — real Mapbox, `@rnmapbox/maps` installed + wired (plugin, env,
      owner-only preview screen) — **waiting on your real tokens, see above, to go further**
- [x] Map style JSON (trackline-light/dark) — both written against the real Mapbox Streets v8
      schema, matching every given colour/zoom/width value
- [ ] User marker + street pill (teal arrow variant) — not started
- [ ] Route drawing (ShapeSource/SymbolLayer) — not started, needs a real token to visually verify
- [x] Top instruction card restyle — bigger icon/distance, accented street-name line, real
      roundabout exit number, "Then" chip, tap-to-repeat voice, arrival flag icon. Literal
      64pt/44pt/40pt sizes deliberately not used — see NOTES.md
- [x] Bottom banner (follow/re-centre/overview) — real two-state banner wired to the existing
      followTilt/onRecenter machinery; Overview button reuses the existing pulled-back pose
      toggle, not yet a real fit-bounds-to-route computation — see NOTES.md
- [ ] Camera & zoom behaviour — not started, needs a real token to visually verify
- [ ] Search sheet (Phase 3 of new doc) — same as old Phase 2
- [ ] Voices (Phase 4 of new doc) — same as old Phase 3
- [ ] Menu/Plan a drive/Inbox/Live Traffic NSW (Phase 5 of new doc) — needs TfNSW secret for the
      live-data half; menu/plan-a-drive UI itself is buildable now
- [ ] Settings reorg (Phase 6 of new doc) — same as old Phase 5
- [ ] Final QA — last
