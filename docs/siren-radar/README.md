# Siren radar

Opt-in: **Settings › Vehicle & AI tools › Emergency vehicle radar › Siren radar** (off by default).

> Driver assistance only — always watch and listen for emergency vehicles yourself.

## How it works

| Step | Where | What it does |
|---|---|---|
| Listen | `services/sirenDetection.ts` | Only while opted in **and** driving: over 10 km/h, within 2 min of it (a red light doesn't switch it off), or navigating a driving route. ~1 s windows at 16 kHz; each window's audio file is deleted as soon as it's classified. |
| Hear | `modules/yamnet-siren` (YAMNet, on the phone) | Scores the classes *Siren, Civil defense siren, Emergency vehicle, Police car (siren), Ambulance (siren), Fire engine, fire truck (siren)*. |
| Decide | `services/sirenTracker.ts` | A window counts at **≥ 0.6** (and only if *Music* isn't scored higher). **3 of the last 5** windows start it. Type = the strongest of police / ambulance / fire, else "Emergency vehicle". Closeness from the loudness trend over 3 s: **Getting closer / Nearby / Moving away** (no left/right/behind). Ends **8 s** after the last siren window. |
| Ignore | `sirenDetection.setOwnAudioCheck(isNavSpeaking)` | Windows while TrackLine itself is talking are skipped (not even classified). During a phone call iOS gives the microphone to the call, so nothing is heard. |
| Warn | `components/EmergencyVehicleBanner.tsx` | Top banner, red/blue stripe, pulsing siren (still with Reduce Motion): "Emergency vehicle nearby", "Police · Getting closer", "Slow down and make way when safe". Spoken once: "Emergency vehicle nearby, make way when safe." One banner at a time (the ahead banner waits); during a turn close-up only when it's getting closer. |
| Ask | `components/SirenQuestionCard.tsx` | After it ends, once you're under 10 km/h (waits up to 10 min): "Did you see an emergency vehicle or incident?" Yes / No, or say "yes" / "no" when *Hey TrackLine* is on. Goes away by itself after 10 s. No → nothing changes. |
| Report | `components/SirenReportPicker.tsx` + `nav/sirenRadar.ts` | Ambulance · Police · Unmarked police · Fire truck · SES / Rescue · Other; optional title (40 characters, filtered, only while stopped); pin starts where the siren was loudest, with Ahead of me / Behind me / Where I heard it; What happened: Passing through (on the map 15 min) · Crash · Road blocked · Police stop · Unknown (normal rules). Goes through the normal report pipeline (3 s undo, anti-spam, Still there, expiry). Drivers ahead hear "Emergency vehicle reported ahead, make way when safe." |

## Accuracy on sample clips (real model, run here)

`scripts/eval-yamnet-sirens.py` runs the app's own `yamnet.tflite` the way the phone does
(1 s windows, top-10 scores, the ≥ 0.6 rule, 3 of 5 windows) over 220 clips from the public
ESC-50 set (list in `esc50-clips.txt`; the audio isn't committed — CC BY-NC).

| Set | Result |
|---|---|
| Siren clips (40 × 5 s) | **28 / 40** triggered (70 %) |
| — of those with at least 3 s of siren in the clip (33) | **28 / 33** (85 %) — the other 7 have ≤ 2 s of siren then silence, which can't make 3 windows |
| Siren windows over 0.6 | 141 / 200 (70.5 %) |
| Non-siren clips (180: car horn, engine, train, church bells, airplane, clock alarm, rain, crying baby, wind; 20 each) | **0 / 180** triggered |
| Non-siren windows over 0.6 | 4 / 900 (all car horn; never 3 in 5) |
| 15 min continuous non-siren audio (the 180 clips back to back) | **0** false alarms |

Run it again: `python3 -m venv v && v/bin/pip install ai-edge-litert numpy`, download the clips in
`esc50-clips.txt` from the ESC-50 repository's `audio/` folder, then
`v/bin/python -I scripts/eval-yamnet-sirens.py modules/yamnet-siren/ios/yamnet.tflite modules/yamnet-siren/ios/yamnet_class_map.csv <clips> docs/siren-radar/esc50-clips.txt results.json`.

## Frames

`npx tsx scripts/siren-radar-frames.ts` draws these at iPhone size from the components' sizes,
colours and words (not device screenshots — a phone run is in TEST_ON_PHONE.md):

| | Light | Dark |
|---|---|---|
| Banner while navigating (police, getting closer) | `01-banner-light.png` | `01-banner-dark.png` |
| Banner on the home map (ambulance, moving away) | `02-banner-home-light.png` | `02-banner-home-dark.png` |
| Question | `03-question-light.png` | `03-question-dark.png` |
| Report sheet (the placement bar is the light sheet in both) | `04-report-light.png` | `04-report-dark.png` |

## Not done / limits (honest)

- **Windows are back to back, not 50 % overlapped.** The phone records ~1 s compressed files with one
  recorder; overlapping would need a native PCM ring buffer in `modules/yamnet-siren`. 3-of-5 then
  needs about 3 s of siren.
- **Music from other apps** isn't measured directly (iOS doesn't give its level); a window where
  YAMNet scores *Music* above the siren classes doesn't count.
- **Phone call**: relies on iOS taking the microphone for the call; there's no separate call check.
- Accuracy above is on clean sample clips, not inside a moving car with road noise — the phone test
  in TEST_ON_PHONE.md is the real check.
