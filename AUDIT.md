# Phase 1–3 Audit — Waze-style redesign

Honest, line-by-line audit against the original 6-phase spec's Phase 1 (Home map screen),
Phase 2 (Bottom search sheet), and Phase 3 (Voices). Every row below was checked against the
actual current code (file + line), not against commit messages or my own earlier summaries.
"Partial"/"Missing"/"Stub" are not failures to be hidden — this file exists to say exactly
where they are.

Status legend: **DONE** (built, wired, real data) / **PARTIAL** (built but doesn't fully match
the spec line) / **MISSING** (not built at all) / **STUB** (UI exists, no real logic/data behind
it).

---

## 1. Required command output

### `npx tsc --noEmit`
```
(no output — clean, exit code 0)
```

### `npx expo-doctor`
```
Running 21 checks on your project...
17/21 checks passed. 4 checks failed. Possible issues detected:

✖ Check that required peer dependencies are installed
  Missing peer dependency: expo-camera, required by @tensorflow/tfjs-react-native

✖ Check for Expo SDK versions affected by Hermes V1 regressions
  Hermes V1 250829098.0.14 detected; 250829098.0.16+ has the fix.

✖ Validate packages against React Native Directory package metadata
  Untested on New Architecture: react-native-fast-tflite
  No metadata available: map3d, yamnet-siren, vision-camera-resize-plugin, live-activity

✖ Check that packages match versions required by installed Expo SDK
  25 packages out of date (expo 57.0.6 vs 57.0.32 expected; react-native 0.86.0 vs 0.86.3; etc.)
```
**All four are pre-existing** — confirmed via `git log --oneline -- package.json` showing none
of these version pins were touched by any Phase 1–3 commit. Not caused by this work, but real
and unresolved regardless.

### `npx expo lint`
Project-wide: **199 errors, 42 warnings** across the whole codebase — the large majority are
pre-existing (`react/no-unescaped-entities` on apostrophes in old files like
`AlertBanner.tsx`, `LiveSpeedometer.tsx`, `NavigationInstructionCard.tsx`, pre-existing
`require()`-import warnings in the vehicle-detection TF files, etc.). This project has never
had a clean lint run — `npx expo lint` was not part of this session's own verify loop until now
(only `tsc`/`expo export` were used), so pre-existing issues were never caught.

**Real, NEW issues in Phase 1–3 files, confirmed introduced this session:**
| File | Issue |
|---|---|
| `src/screens/RecordVoiceScreen.tsx:65` | **Error** — `stopRecording` is referenced inside a `useEffect` at line 65 before its own `const stopRecording = useCallback(...)` declaration at line 96. Reasoned through: since the effect body only executes after the full render pass completes, this doesn't appear to throw at runtime (no TDZ crash observed in reasoning), but it's a real, lint-caught ordering hazard and blocks React Compiler's optimization of this component (`96:37 Compilation Skipped: Existing memoization could not be preserved`). **Needs reordering**, not just suppressing. |
| `src/screens/RecordVoiceScreen.tsx:71` | `setActivePlaybackKey(null)` called synchronously inside a `useEffect` body (`react-hooks/set-state-in-effect`) |
| `src/screens/VoicePickerScreen.tsx:215` | Raw `"` characters inside JSX text (`Tap "Record your own" above`) — `react/no-unescaped-entities` |
| `src/screens/WhereToSheet.tsx:466` | Same raw-quote issue (`No saved places yet -- tap "New" above...`) |
| `src/screens/ParkingSheet.tsx:1-2` | `react` imported twice (`import React, {...} from "react"` then a separate `import { forwardRef } from "react"`) — `import/no-duplicates` |
| `src/screens/WhereToSheet.tsx:14,33` | `MaterialCommunityIcons` and `SavedPlace` imported but never used |

None of these are functional/data bugs except the `RecordVoiceScreen.tsx:65` ordering issue,
which is a real code-quality defect even though it likely doesn't crash. All are fixable in
minutes.

### `git log --oneline -20`
```
886bb88 Fix Android google-mobile-ads/Kotlin build; ship Phase 3 voice picker + recorder
e1df306 Phase 2: replace idle search bar with a real "Where to?" bottom sheet
df5b37a Remove MapLibre prototype: fixes real iOS link collision with @rnmapbox/maps
1f5048c Update PROGRESS.md: both Mapbox tokens now live, document local build findings
04e7b6e Ignore local-module native build output directories
7bfda44 Fix deprecated @rnmapbox/maps plugin option usage
702b85f Phase 1B: real auto-zoom/pitch camera logic (pure functions)
7a4d614 Set real MAPBOX_PUBLIC_TOKEN as an EAS environment variable
c261f43 Phase 1B: resize Menu/Compass/Sound buttons to the literal 72pt spec
929e919 Phase 1B: bottom banner follow/re-centre/overview states
e5eebad Phase 1B: top instruction card restyle, real distance-unit setting
6f0ae65 Phase 1B scaffolding: install @rnmapbox/maps, build real style JSON
f4cd718 Add PROGRESS.md for the Waze-style redesign
f65486d Waze-style redesign Phase 1: home map buttons + settings Firestore sync
08c5889 Fix Android build: missing webkitVersion breaking react-native-webview
59c2c1e Style buildings into a distinct Waze-style flat block layer
f477f3a Add real category/price to place card, interactive Street View embed
56c236e Fix siren-detection TFLite dependency conflict with vehicle detection
23c4125 Real siren detection, map-marker/alert refresh fixes, nav UI polish
e0dc05d Fix voice preview/chime/detection/route-UI/camera/search/speedo bugs
```

---

## 2. Mapbox vs Google Maps

**The live home + navigation map is Google Maps (`react-native-maps`), NOT Mapbox.**

```
src/screens/MapScreen.tsx:16-24
import MapView, {
  PROVIDER_GOOGLE,
  Polyline,
  Marker,
  Circle,
  type Region,
  type MapPressEvent,
  type PoiClickEvent,
} from "react-native-maps";
```

`@rnmapbox/maps` **is** installed (`package.json:25`) and real tokens are live as EAS env vars,
but it is only referenced from:
- `src/screens/MapboxMapScreen.tsx` — an **owner-only preview screen** (deferred `require()`,
  never a static import — line 27: `cachedMapboxModule = require("@rnmapbox/maps")`)
- `src/navigation/RootNavigator.tsx` — registers that preview screen's route
- `src/screens/SettingsScreen.tsx` — an owner-only entry point navigating to the preview
- `src/map/mapboxAvailability.ts`, `src/map/cameraZoom.ts` — pure helper logic, not wired to any
  live screen
- `src/config/env.ts` — token plumbing

**Mapbox has not been wired into the live map at all.** This is consistent with what I've told
you throughout — Mapbox is confirmed *buildable* (real EAS logs), not yet *used*.

**Status: BLOCKED (explicit, user-confirmed decision, not a stall).** Measured scope: 6,042
lines in `MapScreen.tsx`, 100% react-native-maps-API-shaped (20 `<Marker>`, 8 `<Polyline>`, 21
`animateCamera` calls, 14 `onRegionChangeComplete`, `PROVIDER_GOOGLE`), touching chase-cam nav,
3D buildings, traffic layer, alert placement, clustering, and route fit-bounds — all currently
working in production. `@rnmapbox/maps` has a structurally different API for every one of those.
This is a full rewrite of the app's single largest file, not a config swap, and can't be
verified without a real device, which isn't available in this environment. Decision (made with
the user): keep `react-native-maps` as the live engine, build every Waze-style visual feature
directly on it (none of them actually depend on the map engine underneath), and revisit Mapbox
later as its own dedicated branch with device testing alongside it. See `MAPBOX_PLAN.md` for the
real per-feature port plan, effort estimate, and risk breakdown, and `NOTES.md`'s own matching
entry.

---

## 3. Existing features — confirmed not touched by Phase 1–3

```
$ git log --oneline -3 -- src/screens/VehicleDetectionScreen.tsx
e0dc05d ...   b613fa7 ...   4e4a90a ...     (all before Phase 1 started at f65486d)

$ git log --oneline -3 -- src/services/sirenDetection.ts
23c4125 ...   444d6cc ...   86ac136 ...     (same — before Phase 1)

$ git log --oneline -3 -- src/services/revCheck.ts
0d5fcf4 ...   a185636 ...   0d43c1a ...     (before Phase 1)

$ git log --oneline -3 -- src/services/liveTrafficCameras.ts
d89a790 ...                                 (before Phase 1)

$ git log --oneline -3 -- src/services/osmTrafficData.ts
37793ef ...   a354d4c ...   86ac136 ...     (before Phase 1)

$ git diff --stat 04e7b6e~1..HEAD -- src/components/BannerAdBar.tsx src/services/iap.ts \
    src/context/AuthContext.tsx src/screens/SignInScreen.tsx
(no output — none of these were touched)
```

- **AI vehicle detection** — untouched. DONE (unaffected).
- **REV checks** — untouched. DONE (unaffected).
- **NSW live traffic cameras** — untouched. DONE (unaffected).
- **OSM speed camera/traffic light layer (`osmTrafficData.ts`)** — untouched. DONE (unaffected).
  Note: I *did* touch `src/services/osmPlaces.ts` (added a `"parking"` category) — this is a
  **separate file** from `osmTrafficData.ts` (fuel/restaurant/hotel/parking POIs vs. speed
  camera/traffic-light infrastructure), confirmed no overlap.
- **EV siren radar** — untouched. DONE (unaffected).
- **Transit** (`liveVehiclePositions.ts`) — untouched. DONE (unaffected).
- **Dashcam** — the one row (`MapToolsSheet.tsx`) I touched was purely additive (`git diff` shows
  only a new `onFindParking` prop/row added; the existing `onOpenDetection` row/prop is
  unchanged). DONE (unaffected).
- **Ads** (`BannerAdBar.tsx`) — untouched. DONE (unaffected).
- **Purchases** (`iap.ts`) — untouched. DONE (unaffected).
- **Sign-in** (`AuthContext.tsx`, `SignInScreen.tsx`) — untouched. DONE (unaffected).

I changed `src/screens/SettingsScreen.tsx` (replaced the inline voice-pill list with a
navigation row to the new picker) and `src/screens/MapScreen.tsx` (added the new Phase 1/2 UI) —
both confirmed by `tsc`/`expo export` to still compile and bundle; I have **not** run either
screen live on a device/simulator this session, so "still works" is confirmed at the code level
(imports resolve, types check, bundles build), not by an actual UI smoke test.

---

## 4. Phase 1 — Home map screen

| Requirement | Status | Evidence | Fix needed |
|---|---|---|---|
| Full-screen map, "keep current map engine" | DONE | `MapScreen.tsx:16` — still `react-native-maps` | — |
| Default **light** vector style | **PARTIAL** | `src/services/settings.ts:125` — `mapTheme: "normal"` is the default, and `normal`'s background (`src/utils/mapStyle.ts:127`) is `#14201a`, a **dark** forest-green, not light. The actual light theme (`#eef1f6`, line 250) exists but is only reachable by manually switching in Settings. | Change the default `mapTheme` to `"light"`, or confirm with the owner this was an intentional choice |
| "User can change in Settings" | DONE | Settings has a map-type picker (pre-existing, confirmed wired to `mapTheme`) | — |
| TOP-LEFT Menu button (square, white, rounded) | DONE | `MapScreen.tsx:4809-4813`, `MenuButton.tsx` | — |
| Menu button red dot badge when Inbox has unread | **STUB** | `MapScreen.tsx:4811` — `unreadCount={0}` hardcoded; `MenuButton.tsx:21` only renders the badge `{unreadCount > 0 && ...}`. No Inbox data model exists anywhere in the app yet, so this can never be non-zero. | Needs a real Inbox/unread data model (Phase 4 scope) |
| Compass button directly under Menu | DONE | `MapScreen.tsx:4815-4818` | — |
| Compass tap = reset north/heading | DONE | `MapScreen.tsx:4816` — real `animateCamera({heading:0})` | — |
| Compass visibility via Settings > Show compass | DONE | `MapScreen.tsx:4814` — `settings.showCompass &&` | — |
| RIGHT SIDE mid-screen Sound button | DONE | `MapScreen.tsx:4820-4824`, `SoundButton.tsx` | — |
| Sound button shows muted icon when Off | DONE | `SoundButton.tsx` — `muted={settings.spokenDirections === "off"}` (`MapScreen.tsx:4821`) | — |
| BOTTOM-RIGHT yellow triangle "+" Report button | DONE | `MapScreen.tsx:4799-4800` — `Ionicons name="triangle" color="#FBBF24"` + `add` glyph | — |
| Report button opens Police/Emergency Vehicle/Hazard/Speed Camera/Crash/Traffic Light grid | DONE | `src/types/alert.ts:1`, `AlertReportSheet.tsx:11-16` — all 6 types present (pre-existing) | — |
| BOTTOM-LEFT Re-centre button, appears only when panned away | **MISSING** | No such floating button exists on the idle home map. `grep` for `followingUser`/`idleRecenter`/a dedicated conditional FAB returns nothing. The only "Recenter" control is a buried row inside the "..." `MapToolsSheet` (`MapToolsSheet.tsx:71`, `OptionRow icon="locate" label="Recenter"`) — always reachable, not a floating button that appears/disappears based on pan state. | Build a real floating bottom-left button, visible only when the camera has been panned away from the live GPS position |
| Current street name pill, white/rounded/bold, under user's arrow | DONE | `MapScreen.tsx:4501-4509`, real live `currentRoadName` | — |
| Live speedometer bottom-left, restyled smaller | DONE | `MapScreen.tsx:4258`, `LiveSpeedometer.tsx` | — |
| Speed limit sign beside it per Settings | DONE | pre-existing, unaffected | — |
| User marker = selected car icon, rotating with heading | DONE | `MapScreen.tsx:3700-3707` — `CarNavArrow markerStyle={settings.mapMarkerStyle}` real setting, `rotation={heading}` | — |
| Show other "Trackys" (mood avatars) | Not required yet | Spec itself gates this on Phase 6 ("(Phase 6 rules)") | Build in Phase 6 |
| Keep banner ad at very bottom | DONE | `MapScreen.tsx:4904` — `<BannerAdBar />`, pre-existing | — |
| **Sound sheet** — Spoken directions radio (Normal/Less chatty/Only alerts/Off), persisted | DONE | `SoundSheet.tsx:79-98`, `settings.spokenDirections` (AsyncStorage + Firestore via `settings.ts`) | — |
| Sound sheet — "Current voice" row → opens Voice picker | DONE | `SoundSheet.tsx:102-112` navigates via `onOpenVoiceSettings` → `MapScreen.tsx:5222` `navigation.navigate("VoicePicker")` | — |
| Sound sheet — "Listening on" row (real current audio output route + native picker) | **MISSING** | Not present in `SoundSheet.tsx` at all. Confirmed honestly disclosed in `NOTES.md` ("needs a dedicated native module this project doesn't have") — not silently dropped, but still not built. | Needs a new native module (iOS `AVRoutePickerView`, Android output-switcher) |

**Phase 1: 13 DONE, 1 PARTIAL, 1 STUB, 3 MISSING** (1 of the 3 missing items — "Show other
Trackys" — is explicitly gated on Phase 6 by the spec itself, so not a real gap yet).

---

## 5. Phase 2 — Bottom search sheet ("Where to?")

| Requirement | Status | Evidence | Fix needed |
|---|---|---|---|
| Draggable bottom sheet, 3 snap points (peek/half/full), grabber handle, rounded top | DONE | `src/components/ThreeSnapBottomSheet.tsx` (real pan-gesture 3-point sheet), used by `WhereToSheet.tsx:120` | — |
| Search bar: magnifier icon, "Where to?" placeholder | DONE | `WhereToSheet.tsx:338-351` | — |
| Search bar: mic icon, **real speech-to-text** | **STUB** | `WhereToSheet.tsx:274-278,347-348` — mic icon renders, but `onPressMic` just shows a 3-second text note ("Voice search isn't set up yet"). No STT library is installed (`grep` for `expo-speech-recognition`/`react-native-voice` in `package.json` returns nothing). Honestly disclosed in `NOTES.md`, but it does not meet "real speech-to-text search." | Add a real STT library (e.g. `expo-speech-recognition`), a new native module + EAS rebuild |
| Chips: Home / Work / + New | DONE | `WhereToSheet.tsx:357-376` | — |
| Home/Work: unset → "Set address" flow; set → route preview; long-press → edit/remove | DONE | `WhereToSheet.tsx:241-271` — `onPressHomeOrWork`/`onLongPressHomeOrWork`, real `Alert.alert` Edit/Remove | — |
| + New: add a named saved place (**name** + address search) | **PARTIAL** | `WhereToSheet.tsx:207` — `addCustomPlace(place)` called **without** a label; `savedPlaces.ts:68-74` defaults the label to the place's own real name. There is no actual "type a name" step. Disclosed in `NOTES.md`. | Add a small cross-platform text-entry modal after address pick |
| Address entry: custom number row (0–9, "/") pinned above keyboard | **MISSING** | No `InputAccessoryView`, no number row, anywhere in `WhereToSheet.tsx`. Not disclosed in `NOTES.md` — this is a gap I had not previously flagged. | Build a real `InputAccessoryView` (iOS) / equivalent (Android) |
| Address autocomplete: Google Places, biased, shows name + suburb + distance | DONE | `src/services/places.ts:11-19,36-` (real `searchPlaces` with `origin` bias, `distanceMeters`), rendered at `WhereToSheet.tsx:440-449` | — |
| Category chips: Saved / Fuel / Food / Parking, horizontal, press-scale | **PARTIAL** | `WhereToSheet.tsx:383-391` — chips exist and are real (not press-scale-animated; plain `pressedOpacity` dim, confirmed via `CategoryChip` at line 526, no scale transform) | Add a scale-press animation to match "animated press-scale like Waze" |
| Tap category → map animates (zoom-out/fit-bounds) to show pins; sheet shows list | **PARTIAL** | Pins genuinely render (`FuelStationsSheet.tsx` → `onStationsChange` → `MapScreen.tsx` markers) and the list genuinely shows — but there is **no camera fit-bounds/zoom-out animation**. `grep` for `fitToCoordinates` in `MapScreen.tsx` shows it used only for route polylines (`MapScreen.tsx:1726,1827,1843,2495,2720,2754,2772`), never for category search results. | Add a real `fitToCoordinates` call over the category's result pins |
| Fuel: Google Places nearby + NSW FuelCheck real prices | **PARTIAL (deliberate)** | `FuelStationsSheet.tsx:18-25` — now OSM-sourced (not Google Places), and NSW FuelCheck prices were **explicitly removed** per a real, confirmed FuelCheck OAuth outage and an earlier explicit user instruction to drop it. Real nearby list works; no prices at all. | Owner decision needed: re-attempt FuelCheck, or accept no prices |
| Food: nearby food + filter chips (Near me/My suburb/Inner city/Whole city) | **PARTIAL** | `RestaurantsSheet.tsx` — real nearby + text search; `grep` for "Near me"/"My suburb"/"Inner city"/"Whole city" returns nothing. No radius-widening filter chips. | Add the 4 filter chips |
| Parking: filter row (Best match ▾/Open now/Top rated/More) + More sheet toggles | **MISSING (deliberate)** | `ParkingSheet.tsx:17-21` — explicitly documents this as a deferred simplification; ships real nearby list + search only | Build the filter row + More sheet once OSM per-lot attribute coverage is assessed |
| More options: "Drive to friends & family" (real Contacts permission) + "Share drive" | **MISSING** | `expo-contacts` not in `package.json`; no such row anywhere in `WhereToSheet.tsx` | Add `expo-contacts`, build the row + geocode-and-route flow + share-drive link page |
| More options: "Connect calendar" + Upcoming events | **MISSING** | `expo-calendar` not in `package.json`; no such row | Add `expo-calendar`, build the row + event list |
| Route preview screen (existing, restyled): From/To + swap, Avoid ▾ chip, alternatives w/ time bubbles, Leave later/Go now | **PARTIAL** | Swap button DONE (`RouteOptionsCard.tsx:213`); alternatives selectable DONE (tap-to-select profile cards); **no** "Avoid ▾" chip in this screen (toll/motorway/ferry/unpaved avoidance exists as route *profiles*, not a user-facing dropdown chip here); **no** floating map "time bubble" labels (`grep` for them returns nothing — alternatives are shown as list cards, not map overlays); **no** "Leave later"/"Go now" buttons anywhere (`grep` returns nothing) | Add the Avoid chip, on-map time bubbles, Leave later/Go now buttons |
| Navigation screen: black top card, purple route line + street labels, bottom bar (Re-centre/ETA•distance/Overview) | **PARTIAL** | Top card restyled DONE (follows `Settings > Navigation card colours`, one of which is dark/near-black — `src/utils/navCardTheme.ts`); bottom bar DONE (`NavBottomBar.tsx:86-109` — Re-centre/ETA/Overview all real); **route line colour is blue `#1D4ED8`** (`MapScreen.tsx:3620,3872`), **not purple `#6A1FD1`** as the spec literally states; "street labels with the route" rely on the base map's own road labels, not a dedicated route-label layer | Change the active-route stroke colour to purple; decide if base-map road labels satisfy "street labels" or a dedicated layer is wanted |

**Phase 2: 6 DONE, 7 PARTIAL, 4 MISSING** (2 of the missing items — Parking's filter row and
FuelCheck prices — are deliberate, disclosed simplifications; the Contacts/Calendar "More
options" section and the keyboard number row are real, undisclosed gaps).

---

## 6. Phase 3 — Voices

| Requirement | Status | Evidence | Fix needed |
|---|---|---|---|
| Voice picker screen, search bar to filter | DONE | `VoicePickerScreen.tsx:180-188` real `TextInput` + `query` filter (lines 112-117) | — |
| Sections: Recommended / My recorded voices / All languages | DONE | `VoicePickerScreen.tsx:128-134` | — |
| Built-in: "Default (device)" | DONE | `VoicePickerScreen.tsx:97` `kind: "deviceDefault"` row | — |
| Built-in: English (Australia) – female & male | **PARTIAL** | `VoicePickerScreen.tsx:100-101` — `recommended` just takes the top-2 real English-language device voices by quality/name sort; there's no guarantee these are specifically AU, or specifically one female + one male. | Explicitly filter/label two AU-locale, different-gender voices if the device exposes gender metadata |
| Built-in: Matilda, Aussie Footy Fan, Sarcastic Co-pilot, Dry Wit (ElevenLabs, cached) | **PARTIAL (disclosed)** | `src/services/personaVoices.ts:18-23` — all 4 listed; `isElevenLabsConfigured()` (line 25) is false (no `ELEVENLABS_API_KEY` set anywhere), so every one of these rows renders locked ("Voice not available yet", `VoicePickerScreen.tsx:150-163`). Real UI, zero real audio behind any of them. | Needs a real ElevenLabs API key from the project owner, then the one-time generation pass |
| Built-in: Arabic (MSA), Arabic (Levantine), Russian, Spanish, Turkish as named entries | **MISSING** | Not represented as explicit named options anywhere — `voice.ts`'s `getAllDeviceVoices()` just lists whatever the OS happens to have installed for any language, with no special-casing or guaranteed presence of these 5. iOS/Android TTS engines don't reliably distinguish MSA vs. Levantine Arabic as separate voices, so this may be a real platform limit, not just an omission — not currently disclosed anywhere. | Decide if "All languages" (generic, real) is accepted as meeting this, or build explicit named mappings where the OS actually supports them |
| Plus every language voice actually installed (`getAvailableVoicesAsync`) | DONE | `src/services/voice.ts` new `getAllDeviceVoices()`, used in "All languages" section | — |
| Tap a voice = play real sample | DONE | `VoicePickerScreen.tsx:75-80` — real `speak(VOICE_PREVIEW_TEXT, ...)` | — |
| Tick shows selection | DONE | `VoicePickerScreen.tsx` `VoiceRow`'s `selected` checkmark | — |
| Consent modal "Use this voice?" [Accept][Cancel], shown only first 3 times | DONE | `VoicePickerScreen.tsx:83-98`, `src/services/voice.ts` `getVoiceConsentShownCount`/`incrementVoiceConsentShownCount`/`VOICE_CONSENT_MAX_SHOWS = 3`, persisted via AsyncStorage | — |
| "Record your own voice": name the voice | DONE | `RecordVoiceScreen.tsx:159-167`, `recordedVoices.ts` `getRecordedVoiceName`/`setRecordedVoiceName` | — |
| Guided recorder: MAX 6 seconds, auto-stop | DONE, **with a real lint-flagged ordering bug** | `RecordVoiceScreen.tsx:61-67` auto-stops at `MAX_CLIP_DURATION_MS`; **but** this effect calls `stopRecording()` (declared later at line 96) — see section 1's lint findings. Functionally appears safe (effect fires after full render) but is fragile, lint-caught code. | Reorder: declare `stopRecording` before the effect that calls it |
| Countdown ring | DONE | `RecordVoiceScreen.tsx:179-204` — real `react-native-svg` `Circle` with `strokeDashoffset` tied to live `recorderState.durationMillis` | — |
| Play back, re-record, delete | DONE | `RecordVoiceScreen.tsx:208-222` | — |
| Sections & all 31 listed clips (Start of drive ×2, Distances ×5, Instructions ×15, Reports ×6, Other ×3) | DONE | `recordedVoices.ts:20-77` — `grep -c "key:"` confirms exactly 31 | — |
| Custom start phrases (user-added) | **MISSING** | `VOICE_CLIP_SECTIONS` is a fixed, hardcoded list — no "add a phrase" UI anywhere in `RecordVoiceScreen.tsx` | Add a real "add custom phrase" row to the "Start of drive" section |
| Progress indicator (x of N recorded) | DONE | `RecordVoiceScreen.tsx:134-142,254-256` — real count from `recorded` state | — |
| Missing clips fall back to default TTS voice | **MISSING** | No such logic exists anywhere — `grep` for "fallback"/"falls back" in `recordedVoices.ts`/`RecordVoiceScreen.tsx` returns nothing. Direct consequence of the next row (no live-navigation integration exists at all yet, so there's no call site where a fallback would even apply). | Build once live-navigation stitching (next row) exists |
| Store audio locally + Firebase Storage (private) | DONE / **not deployed** | `recordedVoices.ts:131-148` real local save (`expo-file-system`) + real `uploadBytes` to Firebase Storage; `firebase/storage.rules` written with owner-only rules, but **`firebase deploy --only storage` has not been run** — the real upload call will fail against production Firebase until the project owner deploys these rules. | Project owner needs to run a real `firebase deploy --only storage` |
| Navigation engine stitches clips (distance + instruction) during real guidance | **MISSING** | Confirmed — `src/screens/MapScreen.tsx`'s live `speak()` call path (used during active navigation) was not touched this session; it still only calls `expo-speech`'s TTS via `voice.ts`'s `speak()`. No code anywhere reads `recordedVoices.ts`'s clip map during a real drive. | This is the single biggest remaining Phase 3 gap — needs real design + implementation work |

**Phase 3: 13 DONE (1 with a real lint-flagged bug), 3 PARTIAL, 3 MISSING.**

---

## 7. Summary

| | Phase 1 | Phase 2 | Phase 3 | Total |
|---|---|---|---|---|
| DONE | 13 | 6 | 13 | 32 |
| PARTIAL | 1 | 7 | 3 | 11 |
| STUB | 1 | 1 | 0 | 2 |
| MISSING | 3 (1 deferred to Phase 6 by spec) | 4 (2 deliberately deferred) | 3 | 10 |

**45 total line items checked. 32 fully real and working, 11 partially real (built but
diverging from the literal spec in a specific, named way), 2 pure UI stubs with no logic behind
them, 10 not built at all** (4 of those 10 were already honestly disclosed as deliberate
simplifications before this audit; the other 6 — the keyboard number row, Contacts/Calendar
"More options", custom start phrases, and the "fall back to TTS"/navigation-stitching pair — were
not previously flagged and are genuine gaps this audit surfaced for the first time).

### Fix order (my recommendation, not yet started — awaiting your go-ahead)

1. **Lint fixes in my own new code** (5 minutes): the `stopRecording` ordering bug, two
   unescaped-quote errors, the duplicate `react` import, two unused imports.
2. **Default map theme** — either flip the default to the real "light" theme or confirm the
   dark default is intentional (one-line config change either way).
3. **Route line colour** — swap `#1D4ED8` → `#6A1FD1` (purple) for the active nav route (small,
   isolated change, high visual-spec-compliance payoff).
4. **Idle Re-centre FAB** (Phase 1) and **fit-bounds-to-category-pins animation** (Phase 2) —
   both real, contained UI/logic additions with no new dependencies.
5. **Keyboard number row** (Phase 2 address entry) — contained, no new dependencies.
6. **Food filter chips, Parking filter row** — contained, no new dependencies (Parking's depends
   on first assessing real OSM attribute coverage, as already disclosed).
7. **Contacts/Calendar "More options"** — needs new dependencies (`expo-contacts`,
   `expo-calendar`) + new permission strings + a new EAS native rebuild cycle.
8. **Real STT for the search mic** — needs a new native module (`expo-speech-recognition` or
   similar) + a new EAS native rebuild cycle.
9. **Firebase Storage deploy** — not code; needs you (the project owner) to run `firebase deploy
   --only storage` for real voice-clip uploads to actually succeed in production.
10. **ElevenLabs persona voices** — not code; needs a real `ELEVENLABS_API_KEY` from you before
    Matilda/Footy Fan/Sarcastic Co-pilot/Dry Wit can be anything but locked rows.
11. **Navigation-engine clip stitching** — the largest remaining item; real design work, not a
    quick fix, and blocks the "fall back to TTS" requirement too.

Items 9 and 10 are not things I can fix myself — they need your action. Everything else is real
code work I can do.
