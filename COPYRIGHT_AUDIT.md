# Copyright / trademark safety audit (Part 4)

A real pass over the whole app (not just the Tracky/Ghost mode feature), per the explicit
request. Every row below reflects an actual search, an actual file read, or an actual
`license-checker` run -- nothing here is assumed or guessed. See `src/screens/LicensesScreen.tsx`
(Settings → About → "Licences & attributions") for the in-app version of the asset/dataset table
below.

## 1. Third-party brand/franchise names

Searched the whole repo (`src/`, `web/`, `firebase/`, every root `*.md`) for: Waze, Apple Maps,
Uber/Lyft, Tesla/Cybertruck, Lamborghini/Mercedes/Ferrari/Porsche/BMW/Audi, Batman/Superman/
Marvel/Avengers/DC/Disney/Pixar, Pokémon/Nintendo/Mario/Zelda, Rocket League/Fortnite/Minecraft/
Roblox, Matilda/Harry Potter/Star Wars/Frozen/Spider-Man/Iron Man/Hulk/Wonder Woman/Sonic/Mickey
Mouse/the Simpsons.

| Item | File | Risk | Action taken |
|---|---|---|---|
| ~90 occurrences of "Waze" and "Apple Maps" | Throughout `src/`, all in `//`/`/** */` code comments explaining design intent ("Waze-style redesign", "matching Waze's own X convention", "like Apple Maps' own Y") | **None** -- comments are stripped at build time, never shipped to end users or app store listings; this is ordinary, legal comparative engineering shorthand (nominative fair use), not trademark use | Left as-is -- renaming internal comments that never reach a user or a build artifact would be pure churn with zero real risk reduction |
| **One user-facing sentence** naming Waze directly: "...the same way Waze works..." | `src/screens/HelpScreen.tsx:16` (Help screen FAQ, real rendered text) | **Low but real** -- a direct competitor name-drop in shipped, user-visible copy. Not infringing (truthful, non-deceptive, no logo/claim of affiliation) but an unnecessary, avoidable brand-risk/App-Store-review surface | **Fixed** -- reworded to "a community-sourced report, not a licensed government feed," same honest meaning, no competitor name |
| "Matilda" (voice persona name) | `src/services/personaVoices.ts:19` | **None** -- a common Australian first name (also an Aussie folk-song title), not tied to any specific franchise character, logo, or plot; used here only as a locked, not-yet-available voice label | Reviewed, no change needed |
| "REV Check" (feature name) | Throughout | **None** -- a genericized industry term for a vehicle-history/PPSR check, used generically by many Australian providers, not one company's exclusive trademark | Reviewed, no change needed |
| "FuelCheck" | `src/services/liveTrafficCameras.ts` and related | **None** -- this is the NSW Government's own actual, real service name, referenced because the app genuinely calls their real API; legitimate referential/nominative use | Reviewed, no change needed |
| Google Maps/Places/Directions/AdMob/Sign-In | Throughout | **None** -- required, legitimate attribution for APIs this app genuinely uses under Google's own terms | Reviewed, no change needed |

## 2. Every bundled image/SVG/font/sound, with source + licence

| Asset | Source | Licence | Action taken |
|---|---|---|---|
| `assets/brand/*.svg`, `assets/icon.png`, `assets/adaptive-icon.png`, `assets/logo-transparent.png`, `assets/splash.png`, `web/public/logo.png`, `web/public/favicon.png` | Hand-written original SVG paths, this project's own TrackLine pin-and-route mark (see `assets/brand/README.md`, already documented before this audit) | Original -- TrackLine's own | Verified, no change needed |
| Every Tracky mood character + accessory SVG (`src/components/trackys/`) | Hand-written original SVG paths, built this session (see this feature's own commits) | Original -- TrackLine's own | Verified, no change needed |
| Every alert-type icon (`src/utils/alertIconThemes.ts` + `AlertTypeGlyph.tsx`) | Vector icon glyphs from `@expo/vector-icons` (Ionicons/MaterialIcons/MaterialCommunityIcons) | MIT / Apache-2.0 (bundled npm packages) | Verified, no change needed |
| `assets/sounds/speed_warning_chime.wav` | **Undocumented before this audit** -- no source/licence comment anywhere, no generation script, git history only shows it added as a finished binary | **Real finding** -- origin couldn't be confirmed either way | **Replaced.** Regenerated from scratch as a simple two-tone sine chime using a new, committed `assets/sounds/generate_chime.py` (Python stdlib `wave`/`math` only, no samples/loops/third-party audio at all) -- fully original, reproducible, nothing to license |
| `assets/models/ssdlite_mobilenet_v2/*` (COCO-SSD) | Google's `@tensorflow-models/coco-ssd`, served from `storage.googleapis.com/tfjs-models` (see `src/services/vehicleDetection.ts`) | Apache License 2.0 | Verified, credited in the new Licences screen |
| `assets/models/tflite_ssd_mobilenet_v2/*` (model + COCO labelmap) | TensorFlow Lite's SSD MobileNetV2 object-detection model + the standard 90-class COCO label list | Apache License 2.0 | Verified, credited |
| `assets/models/vehicle-classifier/*` | This project's own model, fine-tuned from MobileNetV2 on the Roboflow "Emergency vehicles" dataset (242 images, see `training/README.md`) | Training data: CC BY 4.0 (Roboflow). Trained model weights: TrackLine's own (a derivative work -- the original images are never redistributed, only the trained weights) | Verified already-documented in `training/README.md`; now also credited in the Licences screen for visibility |
| `modules/yamnet-siren/` bundled `yamnet.tflite` + `yamnet_class_map.csv` | Google's YAMNet (TensorFlow Hub) + TensorFlow's own AudioSet label map | Apache License 2.0 (both) | Verified -- the module's own README said so only via a bare link before this audit; now states the licence explicitly |
| No custom fonts, no Lottie animation files | — | — | Confirmed by a full repo search -- this app uses only system fonts + `@expo/vector-icons` glyphs, nothing to audit here |

## 3. Sounds/voices: original or CC0/royalty-free, no celebrity-imitating voices

- The only bundled sound file is the speed-warning chime above -- now a from-scratch synthesized
  tone, fully original.
- **No TTS voices are bundled or hardcoded to impersonate a real person or celebrity.** Voice
  guidance uses the device's own OS text-to-speech voices (`expo-speech`) and, for the optional
  "persona" voices (Matilda / Aussie Footy Fan / Sarcastic Co-pilot / Dry Wit), a planned
  ElevenLabs integration that is **not currently connected** (no API key configured anywhere --
  confirmed in `src/config/env.ts` and `AUDIT.md`'s own earlier finding) -- every persona voice
  row is honestly locked in the UI (`VoicePickerScreen.tsx`), not faked. The guided "Record your
  own voice" feature (`RecordVoiceScreen.tsx`) only ever records and stores the device owner's
  own real voice, privately, in their own account.
- **Action needed if/when ElevenLabs is connected later:** whichever stock ElevenLabs voice (or
  custom clone) is picked for each persona must not be marketed as or resemble a specific real
  celebrity's voice -- this is a one-time check to do at that point, not something to fix now
  since nothing is actually generated yet.

## 4. `npx license-checker --summary` -- GPL/AGPL/unknown check

Run for real across all four package trees in this repo (root app, `web/`, `firebase/functions/`,
`firebase/tests/`):

```
root app:            MIT 765, Apache-2.0 94, ISC 48, BSD-3-Clause 25, BSD-2-Clause 22,
                      BlueOak-1.0.0 9, Unlicense 3, MPL-2.0 3, FSL-1.1-MIT 2, 0BSD 2,
                      UNKNOWN 2, (MIT OR CC0-1.0) 2, Python-2.0 1, CC-BY-4.0 1,
                      Public Domain 1, CC0-1.0 1, (BSD-3-Clause OR GPL-2.0) 1,
                      UNLICENSED 1, Custom:<tfhub URL> 1
web/:                 MIT 124, Apache-2.0 67, ISC 14, BSD-3-Clause 13, CC-BY-4.0 1,
                      UNLICENSED 1, 0BSD 1, BSD-2-Clause 1
firebase/functions/:  MIT 172, Apache-2.0 31, BSD-3-Clause 12, ISC 11,
                      (BSD-3-Clause OR GPL-2.0) 1, UNLICENSED 1, 0BSD 1, BSD-2-Clause 1
firebase/tests/:      MIT 310, Apache-2.0 82, ISC 29, BSD-3-Clause 24, BSD-2-Clause 2,
                      CC-BY-4.0 1, (BSD-3-Clause OR GPL-2.0) 1, UNLICENSED 1,
                      (MIT OR CC0-1.0) 1
```

**Zero GPL-only or AGPL dependencies anywhere in this monorepo.** The handful of non-trivial
entries, checked individually:

| Package | Licence shown | What it actually is | Risk |
|---|---|---|---|
| `node-forge` | `(BSD-3-Clause OR GPL-2.0)` | A transitive crypto library (dual-licensed by its author -- you pick either) | **None** -- BSD-3-Clause applies; not copyleft |
| `@sentry/cli`, `@sentry/cli-linux-x64` | `FSL-1.1-MIT` | Sentry's own build-time CLI (source-map uploads during `eas build`) | **None** -- a dev-only build tool, never bundled into or redistributed with the shipped app; FSL's "no competing use" restriction is irrelevant here |
| `caniuse-lite` | `CC-BY-4.0` | Browser-compatibility data used only by web build tooling (Babel/PostCSS) | **None** -- build-time only, not shipped |
| `live-activity@1.0.0`, `map3d@1.0.0` | `UNKNOWN` | **This project's own local native modules** (`modules/liveActivity`, `modules/map3d`) -- just missing a `license` field in their local `package.json`, not a real third-party package | **None** -- our own code |
| `yamnet-siren@1.0.0` | `Custom: <tfhub.dev URL>` | Also this project's own local module (`modules/yamnet-siren`) -- `license-checker` picked up the real model's source URL from its README rather than an SPDX string | **None** -- the real model it bundles (Google's YAMNet) is confirmed Apache-2.0, see section 2 |
| `trackline@1.3.0` | `UNLICENSED` | This app's own root package -- `"private": true` is already set, correctly, since this is a closed-source app never published to npm | **None** |

## 5. Settings → About → "Licences & attributions" screen

**Added.** `src/screens/LicensesScreen.tsx`, reachable from Settings' existing About block (every
category view, since that footer isn't gated by category). Lists every real dataset/model/asset
from section 2 above with its real source link and licence, plus a note that the npm-level
open-source list (section 4) is covered in bulk here in `COPYRIGHT_AUDIT.md` rather than
enumerated one-by-one in the app (700+ packages isn't a usable in-app list).

## 6. Summary

**Checked:** every source file in `src/`, `web/`, `firebase/` for brand/franchise names; every
bundled binary asset (images, SVGs, audio, ML models) for source and licence; all four
`package.json` dependency trees via `license-checker`; the existing Privacy Policy and Help
screen for user-facing third-party references.

**Changed:**
1. `src/screens/HelpScreen.tsx` -- removed the one direct "...the same way Waze works..."
   competitor name-drop from user-facing copy.
2. `assets/sounds/speed_warning_chime.wav` -- replaced an undocumented audio file with a
   from-scratch synthesized tone (`assets/sounds/generate_chime.py`, committed and reproducible).
3. `modules/yamnet-siren/README.md` -- made the already-correct Apache-2.0 licence for the
   bundled YAMNet model/label map explicit instead of just a bare source link.
4. Added `src/screens/LicensesScreen.tsx` (Settings → About → "Licences & attributions") and
   wired it into `RootNavigator.tsx`/`SettingsScreen.tsx`.
5. This file.

**Needing a user decision:** nothing found requires one right now. The only forward-looking item
is section 3's note: if/when a real ElevenLabs API key is ever connected for the persona voices,
double-check at that point that whichever stock/cloned voice is picked doesn't resemble a real
celebrity's voice -- not an issue today since no persona voice audio is actually generated yet
(all four rows render honestly locked).
