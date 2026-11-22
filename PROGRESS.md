# Waze-style redesign — progress

## 100% completion run — where it's up to

Items 1-6 DONE in code (items 1-4 earlier; item 5 owner dashboard + account recovery + guest data,
branch `admin`, merged; item 6 FINAL_STATUS.md + BLOCKED.md). Final checks pasted in
FINAL_STATUS.md. Web ships with each iOS/Android build via Actions > "Deploy web app (main website)" (DEPLOY.md > Web app). **Next step:** owner sets the real Mapbox `pk.` token in EAS `MAPBOX_PUBLIC_TOKEN` (BLOCKED.md #23 -- it currently holds placeholder text), then Claude ships it with `eas update --channel production --environment production` and checks Diagnostics. TestFlight build 203 has the map/routing fixes + Diagnostics.

## Nav options, fix pass 4, road signs, nothing-fake audit — 2026-11-22

All in code, typechecked, tested (1090 tests, 76 suites) and merged to `claude/go-session-0d5bup`.
Everything below NEEDS DEVICE TEST (TEST_ON_PHONE §33-38) and is in TestFlight build 208 onward.

| Item | Status | Evidence |
|---|---|---|
| Nav options §1: control layout (compass, audio, sound, voice, info banner), ETA sheet option rows + Stop/Continue, Search along route with Toilets + Go, Routes bubbles | DONE | `__tests__/nav/navControls.test.tsx`, `__tests__/travel/etaSheet.test.tsx` |
| Nav options §2: one `exitNavigation` for every way a drive ends, arrival card, "stop navigation" voice command, camera back home | DONE | `__tests__/nav/endDrive.test.ts` |
| Nav options §3: simulated drive frames in `/docs/nav-options` | NOT DONE (no simulator / map tiles here; the layout and reset are covered by the tests above) | -- |
| Speed-limit sign swaps between two roads in the same scene (root cause: 40 m last-road reuse + 25 m cell cache) | DONE | `__tests__/speedLimits/roadSwap.test.ts` |
| CI red since ~run 57 (root cause: placeholder secrets in the emulator job) | DONE | workflows `tests.yml`, `firebase-deploy.yml` |
| Plan a drive: permissions + save (root cause: the Firebase deploy has never run, so live rules lack `plannedDrives`) | DONE in code; **owner must run the Firebase deploy** | `__tests__/travel/planADrive.test.tsx`, emulator rules tests 48/48 |
| Plan a drive look: segmented From and Arrive by / Leave at, short day pills, no hour chips, Jump to time (phone picker), Show later times, 64pt rows with relative traffic bars, Best time tag, selected outline | DONE (new native module: needs build 208) | `__tests__/travel/planADrive.test.tsx` |
| Route preview: sheet 55% max, flat, no 3D buildings; starts collapsed; bubbles placed on screen and never overlapping (root cause: kept apart in metres only); every route visible at both sheet heights on 320-430 pt | DONE | `__tests__/nav/previewCamera.test.ts` |
| Road features are alerts (route-ahead icons, chip countdown, voice at 300 m) | DONE | `__tests__/nav/roadFeatureAlerts.test.ts` |
| Traffic lights, cameras, government hazards as our own road-sign art; cameras in view from zoom 12, lights at street level; every Live Traffic NSW incident a hazard triangle; tap shows what's happening, delay, impact, advice, source | DONE | `__tests__/map/roadSigns.test.tsx` |
| Your own Tracky from an old guest/account uid no longer drawn | DONE | `__tests__/presence/ownUids.test.ts` |
| Ad black bars | NEEDS A SCREENSHOT (not found in code) | -- |
| `/docs/fix-pass-4` screenshots | NOT POSSIBLE here (no iOS simulator); the tests above are the evidence | -- |
| Nothing-fake audit: sweep, 4 false "empty" states fixed, ESLint guard in CI | DONE | `REAL_AUDIT.md`, `__tests__/audit/nothingFake.test.tsx` |

## Nav permanent fix, shortcuts, driving sheets, Dashcam tracker — 2026-11-19

| Section | Status | Evidence |
|---|---|---|
| §1-2 Route preview fit + route list (follow camera ran during preview; fit ran before the card and sheet were measured) | DONE + NEEDS DEVICE TEST (TEST_ON_PHONE §29) | `__tests__/nav/previewCamera.test.ts`, `__tests__/presses/routePreview.test.tsx` |
| §3 One arrow, no own Tracky, one route line starting at the arrow | DONE + NEEDS DEVICE TEST | `__tests__/nav/navArrowLine.test.tsx` |
| §4 Nav camera (pitch 45, arrow at 70%, speed zoom, one shared pose) | DONE + NEEDS DEVICE TEST | `__tests__/nav/navCamera.test.ts` |
| §5 Controls (no overlaps on 320-430 pt), Search along route, Routes alternatives, clean End | DONE + NEEDS DEVICE TEST | `__tests__/nav/navControls.test.tsx`, `navControlsLayout.test.ts` |
| §6 Acceptance drive 323 Stacey St → 40 Bazentin St (real recorded route, clean + noisy GPS) | DONE in simulation; frames in `docs/nav-fix/` are SIMULATION frames, not app screenshots (no simulator or map tiles in this container) | `__tests__/nav/staceyToBazentin.test.ts`, `docs/nav-fix/drive-log.json` |
| Street and back-lane shortcuts (no jam gate; Google alternatives + side streets; judged against the live time of YOUR road; 10% / 1-3 min threshold; banner names the road) + Side streets in the route list | DONE + NEEDS DEVICE TEST (§30) | `__tests__/nav/shortcuts.test.ts`, `__tests__/nav/routeThrough.test.ts` |
| Driving sheets look like the driving UI (dark ETA sheet with round action tiles incl. new Add a stop; dark Search along route with category tiles; dark Report grid) | DONE + NEEDS DEVICE TEST (§31) | `__tests__/travel/etaSheet.test.tsx`, `__tests__/design/colours.test.ts` |
| Dashcam: new trained tracker (Kalman + two-stage matching), class-aware distance | see "Dashcam tracker training" below | `__tests__/detection/boxTracker.test.ts`, `training/tracker/REPORT.json` |

## Waze match + Pass 3 — 2026-11-17

| Section | Status | Evidence |
|---|---|---|
| Requests: 10 s budget, 1 retry, real errors; Diagnostics shows Places key + last Places/Routes status | DONE | `__tests__/netFetch.test.ts`, `__tests__/diagnostics.test.tsx` |
| ETA sheet (replaces Trip options): To/Via, events on route, best time to leave (Google departure_time, 15-min slots, red slower / yellow faster), Show more, Share/Report/Dashcam/Map display, Stop / Go now | DONE + NEEDS DEVICE TEST | `__tests__/travel/etaSheet.test.tsx` |
| See what's ahead banner (first 12 s of a drive, only when something is on the route) | DONE + NEEDS DEVICE TEST | same file |
| Route preview: dark top card; Edit drive / Go now from Plan a drive | DONE + NEEDS DEVICE TEST | `__tests__/presses/routePreview.test.tsx` |
| Plan a drive: Arrive on time art, calendar, grouped drives, live drive time, edit/share/delete, 15-min predicted slots, Best time, on-phone leave alerts, server re-check 30 min before + push | App DONE + NEEDS DEVICE TEST; server `refreshPlannedDrives` BLOCKED until deployed (uses GOOGLE_PLACES_SERVER_KEY with the Routes API enabled) | `__tests__/travel/planADrive.test.tsx`, `firebase/tests/plannedDrivesCore.test.js` |
| Sign in / Create account (inline errors, show password, strength hint, name, terms + privacy) | DONE + NEEDS DEVICE TEST. `web/public/terms.html` is a plain draft: please review | `__tests__/auth/signIn.test.tsx` |
| Text: no "--" on screen, one time format ("10:27 pm" / 24-hour by region) | DONE | `__tests__/wording/noDoubleDash.test.ts` |
| Screenshots (/docs/waze-match, /docs/settings-screens) | NOT DONE: needs a simulator; can't be produced in this container | -- |
| Pass 3 §2-9 (places lists + FuelCheck, 3D arrow, map look, voice recording, reports tile grid + Still there?, inbox details) | NEXT | -- |

## Honest status — 2026-11-16 (read this first)

DONE = wired into a real screen AND has a passing test. Nothing here has been run on a phone by
me; everything visible needs your device check (`TEST_ON_PHONE.md`).

| Feature | Status | Evidence | What you need to do |
|---|---|---|---|
| Waze redesign phases 1-6 (home, Where to?, voice picker/record, menu, Plan a drive, Inbox, settings groups) | DONE + NEEDS DEVICE TEST | `__tests__/presses/{homeScreen,menu,search,settings}.test.tsx`, `scripts/test-ui-logic.ts` (61), `scripts/test-nav-speech.ts` (32) | TEST_ON_PHONE §9. Note: `src/map/cameraZoom.ts` is unused; the speed zoom actually used is in MapScreen (~line 1714) and has no test |
| UI pass 2 | DONE + NEEDS DEVICE TEST | `__tests__/uiPass2.test.ts`, `presses/placePage.test.tsx`, `presses/routeSelection.test.tsx` | §9 |
| Button fix | DONE + NEEDS DEVICE TEST | `presses/navigationConfig.test.ts`, `presses/wiring.test.ts`, `presses/menu.test.tsx` | §10 |
| Mapbox map | DONE + NEEDS DEVICE TEST | `__tests__/mapV2.test.ts`; in builds 192 and 194 | §11 |
| Buttons / colour meaning | DONE | `design/colours.test.ts`, `design/buttons.test.tsx`, `design/appWide.test.ts` | §12 |
| Trackys, Ghost mode, customiser | DONE (app side) + NEEDS DEVICE TEST | `presses/menu.test.tsx`, `firebase/tests/firestore.rules.test.js` | §1-8 |
| Presence (other drivers on the map) | BLOCKED: server never deployed (two-account check: TEST_ON_PHONE §18) | `firebase/tests/functions.test.js` (updatePresence, clearPresence, sendWave), `scripts/test-presence-playback.ts` (19) | Run the Firebase deploy workflow (it has never run); `MAPBOX_SERVER_TOKEN` must be a GitHub secret |
| Live Traffic NSW (incidents, congestion) | BLOCKED: server never deployed | `firebase/tests/trafficNswCore.test.js`, `scripts/test-traffic-nsw.ts` (14) | Deploy; `TFNSW_API_KEY` GitHub secret |
| Police | Driver reports only. No official police feed exists (TfNSW doesn't publish police) | alerts rules in `firestore.rules.test.js` | -- |
| School zones + speed limits | DONE (code + tests), server BLOCKED until deployed, NEEDS DEVICE TEST | `__tests__/schoolZones/*` (4 files), emulator: road-report rules + `confirmRoadReport/syncRoadReport` | Deploy, then run `refreshSchoolZones` once; §14 |
| Lane guidance + exit zoom | DONE + NEEDS DEVICE TEST | `__tests__/nav/{approach,laneStrip,allManoeuvres,worldwide,routing}.test.*` | §13 |
| Robust progress matching | DONE + NEEDS DEVICE TEST | `__tests__/nav/robustness.test.ts`, `nav/missingData.test.tsx` | §13 (tunnel, airplane mode) |
| Report alert card + spotlight (spec §1) | DONE + NEEDS DEVICE TEST | `__tests__/presses/alertCard.test.tsx` (12); `src/components/AlertCard.tsx`, `MapSpotlight.tsx`, `src/map/alertCard.ts` | TEST_ON_PHONE §17 |
| Thanks + votes once per user (§1, §7 votes) | DONE in rules; BLOCKED until rules are deployed | `firebase/tests/firestore.rules.test.js` alerts block (11 new, 38/38) | Deploy rules. Until then the new build's "Still here / Not here" and thumbs-up are refused by the old server rules |
| Official Live Traffic NSW alerts in the card (§4) | DONE (NSW). Thanks / "still there?" on official alerts NOT DONE | `alertCard.test.tsx` official cases | Other countries: no official feed integrated, none shown |
| Tap a Tracky → info bubble (§2) | NOT DONE | no code; tapping a Tracky still opens the existing PresenceCard | -- |
| Home/Work/saved place popup, Send/Routes/•••, parking spot (§3) | NOT DONE | no code | -- |
| Brand & popular-place badges (§5) | PARTIAL: badges DONE from Mapbox POI data (brand + prominence), logo hook DONE; ranking by Google Places rating counts + anonymous visits NOT DONE; 300 m nearby boost NOT DONE | `__tests__/poiBadges.test.ts` (6); `src/map/poiBadges.ts`; `licences/README.md` | -- |
| 3 s undo, max 2/hour (§6) | NOT DONE | no code; reporters can still delete their own report from the details sheet | -- |
| Server-side anti-spam (§6) | NOT DONE (only the rules' shape checks, `validateAlertOnCreate`, and now once-per-user votes) | -- | -- |
| Expiry + "Still here?" (§7) | PARTIAL: per-type TTL (`ALERT_TTL_MS`), `cleanupExpiredAlerts`, proximity prompt (`AlertStillHereCard`) exist; extend-on-confirm and remove-after-2-"Not there" NOT DONE | -- | -- |
| Travel modes | Step 1 of 6: CODE + tests, NOT on any screen | `__tests__/travel/modes.test.ts` | Circular Quay -> Manly test needs a recorded Google/TfNSW response (keys not available here) |
| Vehicle full check (one product, incl. odometer) | CODE + tests DONE; BLOCKED for sale: provider keys, odometer adapter, store products | `firebase/tests/vehicleCheck.test.js` (20 + 2 emulator), rules + callable tests, `__tests__/vehicleCheck.test.tsx` (15), `presses/menu.test.tsx` | PROVIDERS.md steps 1-4; TEST_ON_PHONE §20 |
| Alert settings: Settings › Map information & overlays › Reports (43 items), Speedometer, Map shortcuts | DONE + NEEDS DEVICE TEST; 11 items BLOCKED ("Coming soon in your area": no data source) | `__tests__/reports/{toggles,engine,screens,settingsLayout}.*` (180 tests), `ALERT_SETTINGS.md` table | TEST_ON_PHONE §22 |
| Report card: Tracky bubble, Home/Work/saved popup (Send/Routes/•••, parking P pin, Find my car, Edit, Remove), 3 s Undo (pending on server, 2/hour), server anti-spam (1 km, 10/h, 30/day, burst 15 min → 24 h, duplicate merge, trust, low-trust needs confirmation), "Still there?" per-type windows / extend / remove after 2 | DONE in code + tests; server BLOCKED until deployed (app falls back to direct writes until then); NEEDS DEVICE TEST | `firebase/tests/reports.test.js` (17 + 4 emulator), rules tests, `__tests__/reportCard/client.test.tsx` (20) | Run the Firebase deploy (DEPLOY.md); TEST_ON_PHONE §23 |

### Map checklist (Mapbox map, style v5)

| Item | Status | Evidence / reason |
|---|---|---|
| Map engine line in Settings › About | DONE | `mapEngineLine()` in `src/config/mapEngine.ts`, testID `map-engine`, `mapV2.test.ts` |
| Road shields from Mapbox's own `shield` data | DONE | `SHIELD_PLATE_FOR` (documented values only), `mapV2.test.ts` |
| Map labels: Local / My app language / Both | DONE + NEEDS DEVICE TEST | Settings › Map appearance; `mapV2.test.ts` label modes |
| Suburb postcodes (ABS POA, z11-15, "Punchbowl 2196") | DONE (Australia); other countries name only | `src/data/auSuburbPostcodes.json`, `scripts/build-au-postcodes.py`, `__tests__/auSuburbs.test.ts` |
| Live street-name pill | DONE + NEEDS DEVICE TEST (drive past 3 streets) | `__tests__/presses/streetPill.test.tsx` at 320/375/390/430pt |
| Tap a pin → alert card + spotlight | DONE + NEEDS DEVICE TEST | `__tests__/presses/alertCard.test.tsx` |
| Brand / POI badges | PARTIAL (see table above), NEEDS DEVICE TEST §19 | `__tests__/poiBadges.test.ts` |
| Worldwide previews | BLOCKED: no Mapbox token in this environment | `docs/map-previews/README.md`, `scripts/render-map-previews.mjs` |

Server tests: `npx firebase-tools emulators:exec --only firestore,storage,functions,auth "npm --prefix firebase/tests test"`
runs here -- 6 suites, 131 tests passed (2026-11-16). They also run on every push now
(`.github/workflows/tests.yml`, with typecheck, Jest and `scripts/test-*.ts`).


Tracks the two specs given for this redesign: the original 6-phase UI/UX spec, and the newer
"Phase 1B" + "full redesign, one prompt, all phases" spec (map engine swap to Mapbox/MapLibre,
Live Traffic NSW, full settings reorg, etc.). Kept current so a new session can pick up exactly
where this one left off — see `CODEBASE_MAP.md` for what the repo looks like and `NOTES.md` for
honest limitations/missing keys.

## Lane guidance + exit/merge zoom (branch `lane-guidance`, latest)

- [x] Mapbox routing for the drive, lanes, lane strip, lane voice, approach zoom, confirm/missed, reroute (AUDIT §14)
- [x] Fixed: turn instructions announced the turn just made (Google step order)
- [ ] Device check: `TEST_ON_PHONE.md` §13

## Strict verification + button & colour system

- [x] Root cause of the old home screen on the phone: old builds / dev server JS (AUDIT §12); build stamp in Settings › About — `2a9bc36`, dev build `7d8f1253`
- [x] One Button family, Lucide line icons, one shadow, press/appear motion, colour meaning groups, WCAG AA tests (AUDIT §13)
- [ ] Device check: `TEST_ON_PHONE.md` §12
- [x] Dark sheets over the map (Where to?, search, route selection, place page, street pill)

## Mapbox map + button fix

- [x] Buttons-do-nothing fix (Menu was a native modal; screens opened behind it) — `e74a550`, dev build `ac01134e`
- [x] Branch `mapbox-map`: §1 setup + §2 own style — `f8316a8`; §3 every map feature on Mapbox — `3248b15`;
      §4 switch-over (react-native-maps removed) + §5 verification — this branch's latest commit
- [ ] Device check: `TEST_ON_PHONE.md` §10 (buttons) and §11 (new map)

## UI pass 2 — home, search, place page, route selection

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
