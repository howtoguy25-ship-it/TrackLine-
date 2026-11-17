# Final status

One row per requirement is filled in by item 6 of the completion run (see PROGRESS.md). Sections
below are kept up to date as each item lands.

## Every alert type live (2026-11-16)

| Requirement | Status | Evidence | What you must do |
|---|---|---|---|
| No "Coming soon" anywhere | DONE | `__tests__/reports/liveItems.test.tsx` (git grep over src/app config/web + report grid UI), `screens.test.tsx` (every detail screen) | -- |
| Every item reportable from the report grid, own icon, right category | DONE | `liveItems.test.tsx` "every item can be reported from the grid" (38 items) | -- |
| Same rules as other reports: 3 s undo, anti-spam, Still there, per-item expiry | DONE (server needs deploy) | `firebase/tests/reports.test.js` "items" + emulator; policy `firebase/functions/reports/policy.json` | Run the Firebase deploy |
| Fixed cameras / road features permanent after 3 confirmations or admin approval | DONE (server needs deploy) | `reports.test.js` "becomes permanent", "moderation store (emulator)" | Deploy; approve in Settings › Reports › Moderation queue |
| Official data (Live Traffic NSW, school zones) + OSM + driver reports, merged & de-duplicated, source on the card | DONE | `liveItems.test.tsx` "merged sources", `ALERT_SETTINGS.md` table | -- |
| Derived: sudden slowdown (route traffic + Trackys), speed limit changes, complex intersection / merge, lane ending (Mapbox lanes), crash history (LTN + confirmed reports) | DONE | `liveItems.test.tsx` "derived items", `engine.test.ts` | Crash history fills up only after the deploy (recorded from then on) |
| Bad weather from a weather API | BLOCKED (no key) — bad weather is live from Live Traffic NSW floods + driver reports | `reportCatalog.ts` sources | Add an OpenWeather key if wanted |
| Narrow bridge / shoulder ending from OSM tags | NOT DONE by design: no OSM tag for these was verified, so they come from driver reports only (live, reportable) | `ALERT_SETTINGS.md` | -- |
| Official enforcement-camera lists (e.g. NSW government fixed-camera locations) | NOT DONE: dataset not integrated yet; cameras come from OSM + driver reports | -- | Say if you want it; needs the dataset link checked |
| Admin moderation queue | DONE (in-app, owner only; the web dashboard is item 5) | `ModerationScreen.tsx`, `moderationQueue` / `moderateReport` callables, emulator test | -- |

## Brand / POI badge ranking (item 3, 2026-11-17)

| Requirement | Status | Evidence | What you must do |
|---|---|---|---|
| Rank by Google Places rating count + business status | DONE (needs key + deploy) | `firebase/tests/poiPopularity.test.js` (8), `functions/poiPopularity.js` (30-day cache, 8 lookups/call, 200/user/day) | Add `GOOGLE_PLACES_SERVER_KEY` (DEPLOY.md), deploy |
| Anonymous aggregate arrivals (opt-in) | DONE (needs deploy) | Settings › Privacy › Share arrivals (off by default); `recordArrival` counted once/driver/place/day | Deploy |
| Max ~12 per screen, collision-free | DONE | `__tests__/poiRanking.test.tsx` render test (40 candidates → ≤12 drawn) + ranking tests | -- |
| z13 (fuel, hospitals) / z15 (the rest) | DONE | `poiRanking.test.tsx` "fuel and hospitals from zoom 13" | -- |
| Nearby boost within 300 m | DONE | `poiRanking.test.tsx` "within 300 m" | -- |
| Closed places get no badge | DONE | `poiRanking.test.tsx` "closed places" | -- |

## Travel modes steps 4-6 (item 4, 2026-11-17)

| Requirement | Status | Evidence | What you must do |
|---|---|---|---|
| Transit timeline (walks, rides, stops, times) | DONE | `__tests__/travel/tripDetails.test.tsx` on real recorded Google transit | -- |
| Live / late (TfNSW Trip Planner + realtime) | DONE (needs `TFNSW_API_KEY` + deploy) | `firebase/tests/tfnswTrip.test.js`; app says "Timetable" until then | Add TFNSW key (DEPLOY.md), deploy |
| Fares / Opal note | DONE (Google's fare when given; Opal note otherwise) | `tripDetails.test.tsx` "fare" | -- |
| Drive / Motorbike full; Bike no cameras; Walk compass-up; Transit "Get off in 2 stops" + vibration | DONE | `tripDetails.test.tsx` "per-mode navigation" | Device test (TEST_ON_PHONE §26) |
| Walk stairs warning | NOT DONE: no stairs data in Mapbox walking steps | NOTES.md | -- |
| Ferry details (wharves, departures, crossing, cars, booking link) + Avoid › Ferries | DONE | `tripDetails.test.tsx` "ferry details", trip-details sheet render test | -- |
| Unavailable modes greyed with a reason | DONE | `__tests__/travel/modeRouting.test.ts` | -- |
| Circular Quay → Manly / Bankstown → Parramatta tests | DONE (real recordings) | `ferryTransit.test.ts`, `tripDetails.test.tsx` | -- |

## Future items (not built)

| Item | Status | Scope | What you must do |
|---|---|---|---|
| CarPlay + Android Auto | NOT STARTED (future) | NOTES.md › "Future: CarPlay + Android Auto": entitlement / Car App Library, Expo config plugin, 6 car screens, ~4–6 weeks after approval | Request Apple's CarPlay Navigation entitlement for `com.trackline.navigate`; decide whether to do it before or after launch |
