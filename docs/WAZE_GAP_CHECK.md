# Waze gap check — 2026-11-23

Step 1: what TrackLine already has for each item, checked in the code before building anything.
EXISTS = built and tested; PARTIAL = part of it built; MISSING = nothing yet.

| # | Item | Status | Evidence (file + test) | What's missing |
|---|---|---|---|---|
| 1 | Live Activity + Dynamic Island + lock screen (iOS); Android ongoing notification | PARTIAL | iOS: `modules/liveActivity` (ActivityKit), `targets/liveActivity/TrackLineLiveActivityBundle.swift` (Dynamic Island + lock screen), started/updated/ended in `src/screens/MapScreen.tsx` | Android ongoing navigation notification |
| 2 | Home-screen widgets (iOS WidgetKit + Android) | MISSING | — | everything |
| 3 | Conversational reporting ("crash ahead") | MISSING | on-device speech exists (`src/services/voiceSearch.ts`), report undo exists (`undoReport`, `src/services/alerts.ts`) | utterance → report parser, spoken confirm, 3 s undo. RunPod endpoint: not used (removed from the project); a rules-based on-device parser instead |
| 4 | Wake phrase "Hey TrackLine" | MISSING | — | everything |
| 5 | Emergency vehicle alerts on route | PARTIAL | driver reports of emergency vehicles are ahead alerts now (`src/nav/ahead/aheadKinds.ts` kind `emergency`, `__tests__/nav/aheadAlerts.test.ts`); siren radar (`src/services/sirenDetection.ts`) | siren radar → the same banner; no official feed publishes emergency vehicles |
| 6 | Toll alerts + toll cost per route | EXISTS | cost: `src/services/directions.ts` (Routes API `TOLLS`); ahead alert: OSM toll booths → kind `toll` (`src/nav/ahead/aheadKinds.ts`) | — (a test is added for the toll ahead alert) |
| 7 | Motorbike mode upgrade | PARTIAL | motorbike mode + Routes API request (`src/travel/modeRouting.ts`, `__tests__/travel/*`) | motorbike hazards as report types (gravel, tram tracks, potholes); lane-filter ETA has no data source (BLOCKED) |
| 8 | Music mini-player (Spotify / Apple Music) | PARTIAL | audio button opens the music app (`src/services/musicApp.ts`) | BLOCKED: Spotify developer app + Apple MusicKit key |
| 9 | CarPlay + Android Auto | MISSING | scoped in NOTES.md ("Future: CarPlay + Android Auto") | BLOCKED: Apple CarPlay navigation entitlement (request text prepared) |
| 10 | Offline maps + route corridor | PARTIAL | route + guidance cached for offline start (`src/nav/routeCache.ts`, offline route start) | map tile packs, "Download area" in Settings |
| 11 | Automatic parking detection | PARTIAL | manual parking spot (`src/services/parkingSpot.ts`, saved pin) | automatic save when a drive ends and you walk away; "Find my car" walking route |
| 12 | Arrival flow (parking near destination, last few metres) | PARTIAL | Parking list (`src/screens/ParkingSheet.tsx`) | suggestion 1 km before arrival; walking directions after parking |
| 13 | Multi-stop routes | PARTIAL | one stop before/during a drive (`stopLocation`, SearchAlongRouteSheet) | several stops, reorder/remove, ETA per stop, "Arriving at stop 1" |
| 14 | Detailed closures | MISSING | closures are a report type only | direction, lanes, expected duration; closed segment on the map; reroute others |
| 15 | Points, levels, badges, leaderboard | MISSING | — | everything (server-side scoring) |
| 16 | Web map editor | MISSING | — | everything (admin site + moderation queue) |
| 17 | Trip history + stats | MISSING | — | everything |
| 18 | User fuel prices + EV availability | MISSING | FuelCheck (official) prices only | user prices confirmed by 3; EV availability (provider) |

## Step 2 progress

| # | Done in this pass | Tests | Still to do / blocked |
|---|---|---|---|
| 1 | Android ongoing navigation notification (silent, sticky, updated with the Live Activity, removed at the end) | `__tests__/gap/navNotification.test.ts` | — |
| 2 | iOS home-screen widget "Drive times" (small + medium): live minutes to Home/Work (amber when 10%+ slower), next planned drive + leave time, "as of" time; rows open the route / Plan a drive. App refreshes it on open, on return and every 15 min. App Group `group.com.trackline.navigate` added to the app and the extension; incoming `trackline://` links now handled | `__tests__/gap/homeWidget.test.ts` | Android home-screen widget not built yet (needs the `react-native-android-widget` native module). The widget Swift compiles only in the EAS build (no Swift compiler here): build 209 is the check |
| 3 | Conversational reporting from the driving mic: "crash ahead", "police on the right", "traffic light's out", "something on the road in the left lane", potholes, closures, roadwork, jams, breakdowns, animals, floods, emergency vehicles, with the lane. On-device speech + our own on-device rules (no remote model: the RunPod endpoint was removed from the project). Same server anti-spam rules, spoken back ("Crash reported"), 3 s Undo | `__tests__/gap/voiceReport.test.ts` | "Hey TrackLine" without tapping is gap 4 |
| 4 | "Hey TrackLine" (Settings > Voice guidance, off by default): while the app is open on the map, the phone's own on-device recogniser listens for the phrase, then a report ("crash ahead"), "navigate home" / "take me to work", "mute" / "unmute", "what's my ETA" (spoken back), "stop navigation". Stops in the background, off the map screen and while the mic button or a voice search is using the microphone; the siren radar pauses while it listens. No audio leaves the phone | `__tests__/gap/wakePhrase.test.ts` | Needs a phone whose recogniser supports on-device recognition (otherwise the setting shows it is unavailable) |
