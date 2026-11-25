# Nothing-fake audit — 2026-11-22

The rule: every number, list, place, time and status the app shows comes from a real provider (or
from the user), and when it can't, the app says so ("not available yet", "couldn't load, try
again"). No mocks, no sample data passed off as real, no endless spinners, no "nothing here" when
the truth is "couldn't load".

This is a **code** audit (static sweep + reading every screen's data path + tests). It was not
run against live keys on a phone; what needs a key or a deploy is in BLOCKED.md.

## 1. Automated sweep (production code: `src/**/*.ts(x)`)

Pattern counts before reading each hit:

| Pattern | Hits | What they were | Fakes |
|---|---|---|---|
| `mock` | 3 | comments ("not mocked") | 0 |
| `fake` | 14 | comments explaining what is *not* faked (speed filter, boxes) | 0 |
| `dummy` | 0 | — | 0 |
| `lorem` | 1 | comment in Help ("not lorem ipsum") | 0 |
| `TODO/FIXME/XXX` | 1 | Spanish voice line "Todo listo" | 0 |
| `Math.random` | 5 | Tracky blink delay, voice-line variety, ids/nonces | 0 |
| `hard-coded` | 5 | comments | 0 |
| `stub` | 3 | Tracky "stubby arms", YAMNet no-op when the native module is absent (siren detection then reports itself off) | 0 |
| `simulat` | 27 | `src/dev/*` drive simulator + its callers | 0 (all `__DEV__`-only, below) |
| `sample` | 94 | signal sampling (`samplePolyline`, pixel grids) + the vehicle-check sample report | 0 (sample report is labelled, below) |
| `__tests__`/`fixtures` | 37 | comments naming the test that checks a function | 0 imports |
| `.catch(() => {})` / `.catch(() => [])` / `catch {` in screens | 64 | read one by one (section 3) | **4 false "empty" states** |
| `ActivityIndicator` files | 16 | each checked for a way out (error / timeout / finally) | 0 endless spinners |
| `onPress={() => {}}` | 5 | the card inside a modal swallowing taps so the backdrop doesn't close it | 0 |

**Totals: 4 real problems found and fixed; 0 mocks or fixtures in production code; 1 labelled
example kept; dev tools confirmed unreachable in release builds.**

## 2. Kept on purpose (and why it's honest)

| Thing | Where | Why it isn't fake |
|---|---|---|
| Vehicle check "See a sample report" | `src/vehicleCheck/sample.ts`, VehicleCheckScreen | Only on tap; banner "Sample report: example data, not a real vehicle"; plate reads SAMPLE; source "Sample data". The one allowed exception to the lint guard, with the reason on the line. |
| Drive simulator, test drives, GPX replay | `src/dev/*` | Every entry point is behind `__DEV__` (MapScreen chip, Settings › Developer, LocationContext, useLiveSpeed). Release builds can't reach them. |
| Google's test ad unit ids | `src/config/env.ts` | Used only when no real unit id is configured; Google's own published test ids serving real test ads. |
| Persona voices "Voice not available yet" | VoicePickerScreen | Locked and labelled until the ElevenLabs key is set (BLOCKED #12). |
| Vehicle check outside Australia | VehicleCheckScreen | "Full check not available in your country yet." |
| Petrol prices without FuelCheck | Fuel list | "Live NSW prices aren't set up yet." + Google's own prices where it has them (BLOCKED, FuelCheck). |

## 3. Fixed in this pass (a failed load was shown as "nothing")

| # | Screen | Before | Now | Test |
|---|---|---|---|---|
| 1 | Main menu › Upcoming events | Calendar read failure → "No upcoming events with a location in the next 7 days." (and an unhandled rejection) | "Couldn't read your calendar, try again" button; retry reloads | `__tests__/audit/nothingFake.test.tsx` (renders it) |
| 2 | Voice picker | Phone voices failing to load → an empty voice list | "Couldn't read this phone's voices, try again" | same file |
| 3 | Owner dashboard › Recent sends | Load failure → "No broadcasts sent yet." | "Couldn't load recent sends: <reason>" | same file |
| 4 | Vehicle check › a paid report | Report listener error → the report silently vanished | "Couldn't load your report… it's saved and will show here once it loads." | same file |

Also earlier in this run (already merged): Plan a drive showed Firebase's raw permission text and
dead-ended guests → friendly error + retry + guest sign-in (`__tests__/travel/planADrive.test.tsx`).

## 4. Every screen: where its data comes from

R = real provider data; K = real, but needs an owner key/deploy first (BLOCKED.md #); U = the
user's own data; S = static app content (settings, help, licences).

| Screen | Data | Source | Status |
|---|---|---|---|
| MapScreen (home, preview, drive) | map, routes, traffic, places, alerts, presence, speed limits, road features, cameras, school zones, LTN incidents | Mapbox, Google Routes/Places, OSM Overpass, Firestore reports/presence, TfNSW (server) | R; Mapbox token K #23; LTN K #9; server parts K #1 |
| WhereToSheet | search, recents, saved, contacts, calendar | Google Places, device contacts/calendar, AsyncStorage | R / U |
| PlaceInfoSheet / PlacePage | details, photos, hours, drive time, Street View | Google Places + Routes + Street View, Firestore contributions | R |
| RouteDirectionsSheet | turn list | the route's own steps | R |
| NavOptionsSheet / SoundSheet / MapToolsSheet / VisibilitySheet | settings, actions | app settings | S / U |
| FuelStationsSheet / RestaurantsSheet / HotelsSheet / ParkingSheet | nearby lists, prices, drive times | Google Places, OSM, FuelCheck (server), Routes matrix | R; FuelCheck K |
| AlertReportSheet / AlertDetailSheet | reports | Firestore | R; K #1 |
| TrafficIncidentCard | official incident | Live Traffic NSW snapshot | K #9 |
| LiveCameraSheet | traffic camera images | TfNSW live cameras | R |
| OsmMarkerSheet | camera / light details, Street View | OSM + Google Street View | R |
| PresenceCard | another driver | Firestore presence | R; K #1 |
| InboxScreen | alerts near you, messages | Firestore | R; K #1 |
| MainMenuScreen | profile, calendar events, vehicle check on sale | Firebase Auth, device calendar, server config | R / U (fixed #1) |
| PlanADriveScreen | planned drives, predicted drive times | Firestore, Google Routes per 15-min slot | R; rules K #1 |
| VoicePickerScreen / RecordVoiceScreen | phone voices, persona voices, your recordings | iOS/Android TTS, ElevenLabs (server), local files | R / U; personas K #12 (fixed #2) |
| VehicleDetectionScreen (Dashcam) | boxes, speeds, plates | on-device TFLite model + tracker, Plate Recognizer | R |
| VehicleHistoryScreen | your logged vehicles | local storage | U |
| VehicleCheckScreen | paid report | providers via Cloud Functions | K #11 (fixed #4) |
| RevCheckScreen | rego / REVS | providers + IAP | K #11 |
| DocumentScanScreen | scanned document | device camera + OCR | U |
| SignInScreen / PhoneSignInScreen / AccountRecoveryScreen | account | Firebase Auth, SMS | R; SMS K #5, #19 |
| SettingsScreen and sub-screens, ReportsSettingsScreen, SettingsCategories/Choice | settings | local + Firestore sync | S / U |
| DiagnosticsScreen | last request results, token checks | live checks | R |
| HelpScreen / LicensesScreen | help text, licences | bundled | S |
| SupportRequestsScreen | your tickets | Firestore + callable | R; K #1 |
| TrackyProfileScreen / TrackyCustomizerScreen | your Tracky | local + Firestore | U |
| OwnerDashboardScreen / ModerationScreen | stats, broadcasts, moderation | Firestore aggregates + callables | R; K #1 (fixed #3) |
| SmokeTestScreen | press-through test | dev only (`__DEV__`) | — |

### Added 2026-11-23: siren radar

| Where | Shows | Source | Status |
|---|---|---|---|
| EmergencyVehicleBanner | siren heard, type, closer / nearby / away | the phone's microphone → YAMNet on the phone (`services/sirenTracker.ts`); nothing shown without 3 real windows over 0.6 | R |
| SirenQuestionCard | the question | only after a real siren ended, only when your GPS speed is under 10 km/h | R |
| SirenReportPicker / placement bar | report | the normal report pipeline (server rules, undo, anti-spam) | R |
| Settings › Siren radar | on / off | local setting; off = the microphone loop is stopped | S |

### Added 2026-11-23 (later): gaps 15-18

| Where | Shows | Source | Status |
|---|---|---|---|
| PointsScreen | level, badges, weekly board | `scores/{uid}` written only by the report functions | R (needs deploy) |
| TripHistoryScreen | trips, totals | the phone's own GPS fixes during navigation, stored on the phone | R |
| Petrol list EV rows | free / total connectors, kW | Google Places (New) evChargeOptions; "not reported" when absent | R |
| Petrol list driver prices | price + "3 drivers" | `fuelUserPrices` confirmed by the server only after 3 agreeing drivers | R (needs deploy) |
| Admin Map editor | pins in view | `alerts`, `roadFeatureReports` via staff-only callables | R (needs deploy) |

## 5. The guard (so it stays this way)

- `eslint.config.js`, files `src/**`: `no-restricted-imports` blocks `__tests__`, `__mocks__`,
  `fixtures`, test stubs and any `*mock*` / `*fake*` module; `no-restricted-syntax` blocks
  declaring `MOCK_*`, `FAKE_*`, `DUMMY_*`, `SAMPLE_REPORT/DATA/RESULT`, `mockX`, `fakeX`, `dummyX`.
- CI (`.github/workflows/tests.yml`) now runs `npx eslint src __tests__ jest.setup.js --max-warnings 0`.
- `__tests__/audit/nothingFake.test.tsx` runs the real ESLint CLI on bad snippets and checks it
  refuses them (and still allows fixtures in tests).
- Permanent fix (2026-11-23): `no-restricted-syntax` also refuses a second driver marker
  (`LocationPuck`, `UserLocation`, `showsUserLocation`, `puckBearing`…) and any camera call
  (`animateCamera`, `fitToCoordinates`, `animateToRegion`, `setCamera`, `flyTo`, `fitBounds`…)
  outside `src/map-v2/cameraController.ts` / `TrackLineMap.tsx`. `__tests__/map/oneUserMarker.test.tsx`
  and `__tests__/map/cameraOwnership.test.ts` run the ESLint CLI on bad snippets to prove it.
- The proof frames in `docs/permanent-fix` are labelled for what they are: rendered from the app's
  styles, tiles, arrow, camera and layout code in headless Chromium — not an iOS recording.

Lint now: 0 errors, 0 warnings (the 13 old warnings in tests were cleared to make the CI gate pass).

## 6. Startup + Waze-match pass (2026-11-24): what's real

| Thing on screen | Where it comes from | When it can't be had |
|---|---|---|
| "N Trackys around you" | Server count (`trackysAround` callable, geohash cells, active in the last 15 min, rounded; "A few" under 10) | Call fails or not deployed → no pill (logged), never a made-up number |
| "3 reports near you" pill | The real reports already loaded around you | None near → no pill |
| Other Trackys in view | Presence docs by geohash cell (max 50); the server leaves out anyone within 400 m of their Home / Work / trip start / destination / tonight's first stop | — |
| "Via Wattle St Punchbowl; …" | The route's own steps (the two roads it spends most distance on) + the nearest ABS suburb centre within 4 km | No named roads → Google's own route summary; outside Australia → road names only |
| Motorcycle routes | Google Routes `TWO_WHEELER` where Google offers it (with Google's required beta note) | Not offered (AU/UK/US) or no answer → car routes labelled "Motorbike routes use car roads here" |
| Taxi routes | Car routes, with a note that taxi/bus lanes aren't in the data | — |
| Electric car, Truck/Van | Not offered (no provider support, BLOCKED #29) | — |
| Proof images (`docs/startup-trackys`, `docs/waze-match-routes`) | Real tiles and real Mapbox routes; the app screens are HTML drawings of the components, captioned "drawn" | — |
