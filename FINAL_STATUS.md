# Final status

One row per requirement. DONE = in code with a passing test. Nothing has been run on a phone by
me; "needs deploy" means the Cloud Functions / rules have never been deployed (BLOCKED.md #1).
Everything that needs a key, a console setting or a decision from you is in BLOCKED.md.

## Final checks (2026-11-23, after the permanent fix, branch claude/go-session-0d5bup, real output)

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0, no errors |
| `npx eslint src __tests__ jest.setup.js --max-warnings 0` | exit 0, 0 problems (now also refuses any camera call outside `cameraController.ts` / `TrackLineMap.tsx`, and any second driver marker) |
| `npx jest` | Test Suites: 109 passed, 109 total · Tests: 1389 passed, 1389 total |
| Emulator suite (`firebase emulators:exec … npm --prefix firebase/tests test`, isolated copy with the CI's placeholder secrets, no local keys) | Test Suites: 16 passed, 16 total · Tests: 297 passed, 297 total (exit 0). An earlier run without the placeholder file failed 2 character-voice tests only because the key was missing, not "unset"; CI writes the same placeholder file |
| `npx expo export --platform ios` | exit 0 · iOS bundle 3139 modules. (It first FAILED on `require("…user-arrow@3x.png")` — jest can't see that; fixed with 1x/2x/3x files + base-name require and a guard test) |
| Admin site (`/admin`) | `tsc` 0 errors · vitest 4/4 · `next build` OK (unchanged since) |
| Map styles | open style-spec validator: 0 errors on light / dark / satellite (`__tests__/map/styleValid.test.ts`) |
| Siren model on 220 sample clips | back-to-back windows 28/40 sirens, 0/180 false; 50 % overlap 31/40, 1/180 false (a sustained car horn) — `docs/siren-radar/README.md` |
| TestFlight | 212 (ce48702) · 213 (ace575b) · 214 (4633690) · 215 (a9b1f86) gaps 15-18 · **216 (5b5e064) permanent fix — FINISHED, on TestFlight** — all on TestFlight only (not submitted for review) |

## 2026-11-24: map styles — every style Waze-level + clean satellite

Checks (real output): `tsc` exit 0 · `eslint src __tests__ jest.setup.js --max-warnings 0` exit 0 ·
`jest` Test Suites 112 passed / 112, Tests 1415 passed / 1415, Snapshots 1 passed ·
`expo export --platform ios` exit 0, 3151 modules. TestFlight: **build 217 (95c9bc5) — FINISHED and on TestFlight** (not submitted for review).

| Requirement | Status | Evidence | What you must do |
|---|---|---|---|
| §1 One generator for every style; themes change colours only | DONE | `__tests__/map/styleContrast.test.ts` (identical layout, flat buildings, colour snapshot) | — |
| §1 Contrast in every theme (roads/land, labels/halo, water, route vs roads/land) | DONE — fixed dark water, dark route, Green & Yellow roads/labels | `styleContrast.test.ts`, `src/map-v2/styles/styleContrast.ts` | — |
| §1 Dark map Off / On / Only at night / Same as phone; controls follow | DONE | `__tests__/map/mapAppearance.test.ts` | TEST_ON_PHONE §46.3 |
| §2 Clean satellite (softened imagery, fade-in, light road overlay, casings on main roads, white labels, no 3D, route bright) + Satellite while driving | DONE | `styleContrast.test.ts` satellite block, `docs/map-styles/satellite-*` | §46.5-6 |
| §3 Controls readable on every theme and satellite | DONE | `mapAppearance.test.ts` (edge or contrast vs every ground) | §46.7 |
| §3 Theme picker: real-tile previews, live map of the chosen theme, instant apply, route kept | DONE | `__tests__/map/themePicker.test.tsx`, `assets/map/theme-previews` | §46.1 |
| §4 Screenshots: every style z11/14/17 + driving, Sydney + London | DONE (rendered from the app's style + real tiles; no iOS simulator — BLOCKED #28) | `docs/map-styles/README.md` (56 frames) | Phone test §46 |

## 2026-11-23: permanent fix — marker, camera, route fit, nav orientation, 3D, controls

| Requirement | Status | Evidence | What you must do |
|---|---|---|---|
| §1 One location marker (our arrow only, with or without heading, 60fps, stale fixes dropped, own Tracky never drawn; puck props banned by lint) | DONE | `__tests__/map/oneUserMarker.test.tsx`, `userArrow.test.ts` | TEST_ON_PHONE §45.1 |
| §2 CameraController FOLLOW / FREE / ROUTE_PREVIEW / OVERVIEW / NAV_FOLLOW; any gesture → FREE; only Recentre / start / end leave it; lint rule; nav auto-recentre 15 s, > 10 km/h, setting (default on), never at home | DONE | `__tests__/map/cameraController.test.ts`, `cameraOwnership.test.ts`, `docs/permanent-fix/pinch-out-*.png` (0 camera moves in 60 s) | §45.2-3, §45.7 |
| §3 Route preview fitted (measured top card + 24, sheet + 24, sides 32, 600 ms), refit on route / mode / Avoid / sheet, never on location; flat, north-up, no 3D | DONE | `cameraOwnership.test.ts`, `previewCamera.test.ts`, `docs/permanent-fix/route-preview-*.png` (all points inside at both sheet heights) | §45.5 |
| §4 Nav camera faces the road from the first second (first route segment), pitch 45, arrow at 70 %, zoom by speed; north-up only with the new setting | DONE | `cameraOwnership.test.ts` (±10°, 70 %), `docs/permanent-fix/nav-facing-road-*.png` (measured 0.700) | §45.6 |
| §5 Controls: Re-centre above Report (FREE only), speed sign above speedometer, mic + sound top-right, banner never overlaps; 320/375/390/430 | DONE (on a 320 × 568 phone the mic / sound step aside while the ahead banner is down) | `__tests__/map/controlsLayout.test.ts`, `docs/permanent-fix/controls-banner*.png` | §45.8 |
| §6 3D: flat footprints by default; when on: 40 % height ≤ 40 m, theme colours, fade in from z16, see-through near a route, labels on top; pitch ≤ 45 everywhere; satellite never default; ad bar black side strips gone (full-width) | DONE | `__tests__/mapV2.test.ts`, `presses/homeScreen.test.tsx` | §45.4, §45.9 |
| §7 Proof | DONE as rendered frames (no iOS simulator on Linux — BLOCKED #28) | `docs/permanent-fix/README.md`, `shots.json`, `pinch-out-then-recentre.mp4` | Phone test §45 |

## 2026-11-23: banner, map polish, siren radar, live road view, gaps 4-18

| Requirement | Status | Evidence | What you must do |
|---|---|---|---|
| Ahead banner at the top, neatly spaced, controls move down | DONE | `__tests__/nav/aheadAlerts.test.ts`, `docs/ahead-alerts` | Phone test |
| One-direction closures reroute only when that direction is yours | DONE | `__tests__/gap/closures.test.tsx` | — |
| Map polish §1-§5 | DONE | `__tests__/map/*`, `docs/map-polish/README.md` | Phone test |
| Map polish §6 screenshots z11/13/15/17 light + dark (real tiles) | DONE — and found + fixed a road-shield colour expression Mapbox rejects | `docs/map-polish/*.png`, `__tests__/map/styleValid.test.ts` | — |
| Siren radar §1-§5 (opt-in, driving only, 0.6 / 3 of 5, type, closeness, banner, voice, question, report, privacy, accuracy, frames) | DONE | `__tests__/siren/*`, `docs/siren-radar` | TEST_ON_PHONE §39 |
| Siren radar 0.96 s windows with 50 % overlap | DONE (native in-memory stream; compiled in build 214) | `__tests__/siren/sirenStream.test.ts` | Phone test |
| Live road view (Tesla-style) toggle | DONE | `__tests__/nav/liveScene.test.ts`, `liveRoadView.test.tsx`, `docs/live-road-view` | TEST_ON_PHONE §40 |
| Gaps 4-14 | DONE (see `docs/WAZE_GAP_CHECK.md`; 8, 9 blocked on Spotify/MusicKit and Apple's CarPlay entitlement) | `__tests__/gap/*` | BLOCKED #17, #25 |
| Gap 15 Points, levels, badges, leaderboard | DONE | `__tests__/gap/points.test.tsx`, `firebase/tests/scores.test.js` | Firebase deploy (BLOCKED #27) |
| Gap 16 Web map editor | DONE | `firebase/tests/mapEditor.test.js`, `admin/tests/mapEditor.test.ts` | Firebase + admin site deploy (BLOCKED #27) |
| Gap 17 Trip history + stats | DONE | `__tests__/gap/tripHistory.test.tsx` | TEST_ON_PHONE §42 |
| Gap 18 Driver fuel prices (3 to confirm) + EV availability | DONE | `__tests__/gap/fuelEv.test.tsx`, `firebase/tests/fuelUserPrices.test.js` | Firebase deploy for prices (BLOCKED #27) |
| Mapbox token (was BLOCKED #23) | RESOLVED — a real `pk.` token is in EAS production | real-tile screenshots | — |

Not submitted for App Store review (your rule: only after your phone tests pass).

## Final checks (2026-11-17, branch claude/go-session-0d5bup, real output)

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0, no errors |
| `npx expo lint` | exit 0, 0 problems |
| `npx jest --ci` | Test Suites: 45 passed, 45 total · Tests: 854 passed, 854 total |
| `scripts/test-*.ts` | all pass |
| Emulator suite (`firebase emulators:exec … npm --prefix firebase/tests test`) | Test Suites: 11 passed, 11 total · Tests: 267 passed, 267 total |
| `npx expo-doctor` | 19/21. Open (known, NOTES.md): `expo-camera` is a peer of `@tensorflow/tfjs-react-native`; React Native Directory has no entry for the local native modules. The 6 Expo patch mismatches were updated. |
| `npx expo export --platform ios --platform android` | exit 0; iOS and Android Hermes bundles (14 MB each) |
| Dashboard (`/admin`) | `tsc` 0 errors · vitest 2/2 · `next build` 14 static pages · sign-in renders in Chromium with no page errors |
| `npm audit --omit=dev` (app) | 7 left (3 moderate, 4 high), all in the react-navigation 6 / expo fingerprint chains; npm's only "fix" is a major downgrade. Unchanged from REVIEW.md. |
| `npm audit --omit=dev` (functions) | critical + high fixed (`npm audit fix`); 12 moderate left, all needing firebase-admin 14 / firebase-functions 7 (major upgrade, not done) |
| `npm audit --omit=dev` (dashboard) | 0 vulnerabilities (postcss and @grpc/grpc-js pinned by `overrides`) |
| `license-checker --production` | app: MIT 621, Apache-2.0 85, ISC 43, BSD 44, others permissive; "UNKNOWN" = this repo's own local modules; FSL-1.1-MIT = Sentry's build-time CLI only; node-forge dual BSD/GPL (BSD chosen). Dashboard: libvips (LGPL) only on the build machine via Next.js, nothing shipped. |

## Sign-in, phone codes, web app (2026-11-17, round 2)

| Requirement | Status | Evidence | What you must do |
|---|---|---|---|
| App: phone number sign-in with a 6-digit SMS code | DONE in code (Firebase sends the SMS; reCAPTCHA runs on `web/public/phone-verify.html`) | `__tests__/admin/appSide.test.tsx` "phone number sign-in"; a guest keeps the same uid | Enable Phone sign-in in Firebase console; deploy the website (it serves phone-verify.html); TEST_ON_PHONE §28 |
| App: Forgot password by phone (Firebase code → new password, others signed out, notice) | DONE | app tests + emulator "phone recovery with Firebase's SMS" (real Auth-emulator phone sign-in) | Same as above |
| App: Google sign-in | DONE on iOS (client ID + URL scheme are in the EAS env); Android needs `GOOGLE_WEB_CLIENT_ID` | `SignInScreen.tsx` | Add `GOOGLE_WEB_CLIENT_ID` to EAS env for Android |
| App: Apple sign-in | DONE (expo-apple-authentication, nonce) | unchanged, previously tested on TestFlight | -- |
| Guest → account in place updates every screen | FIXED (was stale: Firebase doesn't fire auth-state on linking) | `AuthContext` + web `App.tsx` use onIdTokenChanged | -- |
| Dashboard sign-in end to end | DONE | `admin/tests/e2e.cjs` on the emulators in Chromium: wrong password refused, owner sign-in, Overview, user search (masked), audited action, App control publish, audit log + integrity, no-role account refused | ADMIN.md setup |
| Dashboard: Google / Apple sign-in (authenticator code still required) | DONE in code | `AuthGate.tsx` | Turn on Google/Apple providers for the web domain |
| Web app: account (Google, Apple, phone, email; guest kept on sign-up), Forgot password, Can't sign in, Help requests, Inbox, Notification settings, maintenance/banner/announcement, legal re-accept, Vehicle Check switch | DONE | `web/tests/e2e.cjs` on the emulators in Chromium (guest → help → inbox → email account same uid → recovery → maintenance block) | Deploy the website (deploy.ps1) |
| Web app: map, search, routes + travel modes, navigation, reports, live cameras, vehicle detection, paid check | Already in the web app (unchanged) | `web/` typecheck + build | Maps key in the web build env |

## Owner dashboard, account recovery, guest data (item 5, 2026-11-17)

Server: `firebase/functions/admin/`. Emulator tests: `firebase/tests/admin.test.js` (53: every
role, every flow). App: `__tests__/admin/appSide.test.tsx` (26). Dashboard: `admin/` (typecheck,
`admin/tests/`, static build, Chromium smoke test of sign-in). Nothing here works until the
server is deployed (BLOCKED.md #1).

| Requirement | Status | Evidence | What you must do |
|---|---|---|---|
| Next.js App Router + TS + Tailwind in /admin, own Hosting site | DONE (not deployed) | `admin/`, `.github/workflows/admin-deploy.yml`, CI job `admin-dashboard` | ADMIN.md setup steps 4-5; connect admin.<domain> |
| Email sign-in + required TOTP 2FA | DONE in code; needs Identity Platform TOTP turned on | `admin/components/AuthGate.tsx` (enrol + sign-in); server refuses calls with no second factor (`roles.test` "authorize") | ADMIN.md step 2 |
| App Check | DONE in code, off until you register a key | `admin/lib/firebase.ts`, `ENFORCE_APP_CHECK` in `admin/staff.js` | ADMIN.md step 6 |
| 30-min idle timeout | DONE | `admin/lib/session.ts`, `admin/tests/lib.test.ts`; server also refuses sessions older than 12 h | -- |
| Roles via custom claims; only owner grants | DONE | `roles.js` matrix test per role; emulator "only the owner grants roles" | -- |
| Every privileged action via Cloud Functions with server role check | DONE | `staff.js` (`makeStaffSection`); emulator "each role can / can't do user actions" | -- |
| Append-only audit log (who/what/target/before/after/IP/time), CSV, can't edit/delete | DONE | `audit.js` hash chain + CSV tests; emulator: clients can't read/write `auditLog`, `verifyAudit` intact | -- |
| Never see/set passwords; masked fields; reveal is logged | DONE | `mask.js` tests; emulator "reveal is logged; profile is masked" | -- |
| Overview cards, 7/30/90 charts, usage by area (no individuals), alerts panel | DONE (crash-free % needs Sentry token) | `insights.js`, `usageCells` k≥5 test, emulator overview test | Optional `SENTRY_AUTH_TOKEN` |
| Users: search + filters, profile, devices, trust, reports, purchases, tickets, audit history | DONE | `users.js`, emulator profile/search tests | -- |
| User actions (reset email/SMS, sign out all, disable, report bans, reset trust, remove report, credit/refund note, merge, export, delete with 7-day undo, in-app message) | DONE (SMS needs Twilio) | emulator tests per action + audit entries | Optional Twilio keys |
| Messages: composer, 4 channels, audience filters, live estimate, schedule/cancel, templates, results, respects Notification settings | DONE (push only after deploy, real devices) | `messages.js` tests; emulator "messages respect each user's Notification settings" | -- |
| App control: feature flags (global/country/%), min version soft/forced, maintenance, tunables with history + rollback, What's New | DONE | `appConfig.js` validation tests; emulator rollback; app `remote/appConfig.ts` tests | Device test (TEST_ON_PHONE §27) |
| Moderation: reports queue (flagged first, votes, approve/remove/edit type/ban), map edits, photos/map chats/names with profanity flag, spam view | DONE | `moderation.js` tests + emulator | -- |
| Support inbox: status, assign, canned replies, internal notes, history | DONE | emulator "help ticket from a guest" | -- |
| AI assistant (summary, reply, risk, duplicates; never acts) | DONE in code; needs key | `support.js` (Claude, structured output, no tools) + fake-client test | Add `ANTHROPIC_API_KEY` |
| Recovery A: email link / SMS code (10 min, 5 tries, 15-min cooldown), sign out others, "password changed" notice, no account fishing | DONE (email link works on deploy; SMS + notice emails need Twilio / Trigger Email) | emulator recovery tests (same reply, expiry, lockout, reset, notice) | Twilio + Trigger Email extension |
| Recovery B: identify → code → new password; no access → chat + verified new contact → ticket with risk score → review → 24 h change + notice to old contact + cancel; 3/day per account and device | DONE | emulator "assisted recovery…", "applies after 24 h"; app screen tests | -- |
| Guests: anonymous auth, data stored server-side, linking keeps data, warnings, Save prompts (Home/Work, purchase, 3rd trip, Settings), Restore purchases | DONE | emulator "guest -> account linking keeps the same uid and every saved thing"; `savePrompt` tests | Device test (§27) |
| Dashboard guest vs linked counts + conversion | DONE | Overview cards (`linkedAt`, `isAnonymous`) | -- |
| Money: sales, refunds/credits, provider cost per check, profit/day | DONE (Apple/Google fees not subtracted) | `insights.js` money + `costsByProvider` tests | -- |
| API spend for Mapbox / TfNSW / AdMob | NOT DONE: no billing API connected; listed as "not tracked" on the page | `insights.js` | See each provider's console |
| System health: feeds, function errors, app versions, owner-only rerun jobs | DONE (latency: Cloud console link) | emulator "only the owner runs jobs" | -- |
| Privacy & legal: requests queue (30-day overdue), versioned Privacy/Terms with re-accept, business name + ABN | DONE | `governance.js`, `LegalGate` test | -- |
| Firestore rules for every new collection | DONE | `firebase/firestore.rules`; emulator rules tests | Deploy rules |
| ADMIN.md | DONE | `ADMIN.md` | -- |

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

## Earlier work (summary; detail in PROGRESS.md and TEST_ON_PHONE.md)

| Requirement | Status | Evidence | What you must do |
|---|---|---|---|
| Waze-style redesign (home, Where to?, voices, menu, Plan a drive, Inbox, settings groups) | DONE + NEEDS DEVICE TEST | `__tests__/presses/*`, `scripts/test-ui-logic.ts` | TEST_ON_PHONE §9 |
| Mapbox map, shields, labels, postcodes, street pill | DONE + NEEDS DEVICE TEST | `mapV2.test.ts`, `auSuburbs.test.ts`, `streetPill.test.tsx` | §11 |
| Lane guidance, exit zoom, robust progress matching, orientation | DONE + NEEDS DEVICE TEST | `__tests__/nav/*` | §13 |
| School zones + speed limits | DONE; server needs deploy | `__tests__/schoolZones/*`, emulator road-report tests | Deploy, run refreshSchoolZones |
| Live Traffic NSW | DONE; server needs deploy + key | `trafficNswCore.test.js` | `TFNSW_API_KEY`, deploy |
| Trackys, Ghost mode, presence | DONE; presence needs deploy | `functions.test.js`, rules tests | Deploy; §18 two-account check |
| Alert settings (item 1) | DONE | `__tests__/reports/*`, `ALERT_SETTINGS.md` | §22 |
| Report card (item 2): Tracky bubble, saved-place popup, 3 s undo, anti-spam, Still there | DONE; server needs deploy | `reportCard/client.test.tsx`, `reports.test.js` | Deploy; §23 |
| Vehicle full check | CODE DONE; BLOCKED for sale | `vehicleCheck.test.js`, `vehicleCheck.test.tsx` | PROVIDERS.md steps 1-4 |
| Worldwide map previews | BLOCKED (no Mapbox token here) | `docs/map-previews/README.md` | -- |

## Future items (not built)

| Item | Status | Scope | What you must do |
|---|---|---|---|
| CarPlay + Android Auto | NOT STARTED (future) | NOTES.md › "Future: CarPlay + Android Auto": entitlement / Car App Library, Expo config plugin, 6 car screens, ~4–6 weeks after approval | Request Apple's CarPlay Navigation entitlement for `com.trackline.navigate`; decide whether to do it before or after launch |
