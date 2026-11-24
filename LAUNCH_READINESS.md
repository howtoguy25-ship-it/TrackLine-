# Launch readiness — 2026-11-24

Short answer: **the app can be submitted about a week after you do the 3 "you" items below**,
if your phone test passes. Apple's review then usually takes 1–2 days.

## What I tested today (real output)

| Check | Result |
|---|---|
| Typecheck (`tsc`) | 0 errors |
| Lint (`eslint … --max-warnings 0`) | 0 problems |
| App tests (`jest`) | 128 suites, **1601 / 1601 pass** |
| Server tests on the Firebase emulators (CI) | 18 suites, **314 / 314 pass** |
| Script checks (`scripts/test-*.ts`) | all pass |
| iOS bundle (`expo export`) | builds, 3171 modules |
| CI on GitHub (latest push) | green |
| TestFlight | builds 218–222 all processed and on TestFlight (none sent for review) |

What these cover: routes and route preview fit, ETA bubbles, the driving camera and controls
(no overlaps on 320–430 pt phones), turn guidance and the directions list, ahead alerts, every
setting (live + saved + synced), sign-in flows, the map styles and contrast rules, and all the
server rules and functions (on the emulators).

What they **can't** cover: a real phone, real GPS, real sound, real touch. That's your phone
test (TEST_ON_PHONE.md §47–54 + one real drive).

## Works now on your phone (no setup needed)

Map, search, route preview, turn-by-turn navigation with voice, rerouting, directions list,
options sheet, settings, saved places, Plan a drive (on this phone), speed limits from OSM,
speedometer, dashcam/AI detection, siren radar, offline route start.

## Does NOT work in production yet

| What | Why | Who / how |
|---|---|---|
| **Everything between users**: reports from other drivers, Trackys around you, private zones, school-zone alerts from the server, points board, fuel prices, account recovery, the owner dashboard | **The Firebase backend has never been deployed** (BLOCKED #1/#27/#30). Its tests pass; the deploy stops because the GitHub secret `FIREBASE_SERVICE_ACCOUNT` is empty | **You**: add that one secret (KEYS_SETUP.md §1, no other key needed now). Then I run the deploy (≈15 min) |
| **Ads show "Test mode"** and earn nothing | No real AdMob IDs set, so the app uses Google's test ads | **You**: create the app + a banner and an app-open ad unit in AdMob (KEYS_SETUP.md §2); paste the IDs to me (they aren't secret) or add them in EAS. Then I rebuild |
| Live NSW traffic, character voices, SMS codes, emails, AI support summaries, popularity badges | Optional keys not added (BLOCKED #5–#12) | Can come after launch; the app says plainly when each is off. Steps for every key: KEYS_SETUP.md |
| CarPlay, home-screen widget, music mini-player, EV/truck routing | Apple/Spotify approvals or no provider (BLOCKED #17, #24, #25, #29) | After launch |

## Before you press "Submit for review"

1. **You:** add `FIREBASE_SERVICE_ACCOUNT` → I deploy Firebase and check a report appears on a second phone.
2. **You:** real AdMob IDs in EAS → I make a release build.
3. **You:** phone test (TEST_ON_PHONE §47–54 + one real drive) on that build; tell me anything off.
4. **You (App Store Connect):** screenshots (6.7" and 6.1" iPhone, **and 13" iPad** — the app now
   runs full-screen on iPad, fix pass 7, so Apple asks for iPad screenshots too), description, keywords, support URL,
   privacy policy URL, App Privacy answers (location, account info, usage data, ads/tracking —
   the app asks permission to track), age rating. I can draft the text for all of these.
5. Submit. Apple review ≈ 1–2 days.

Already in place for review: account deletion in Settings, the tracking permission prompt,
location / microphone / camera permission texts, privacy policy screen.
