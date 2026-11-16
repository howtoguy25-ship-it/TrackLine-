# Code review — everything built so far (2026-11-16)

Branch `code-review`, merged into `claude/go-session-0d5bup`. Nothing here was run on a phone;
anything visible is also listed in `TEST_ON_PHONE.md`. Folder index: `CODEBASE_MAP.md`
("Full index"). Feature status: `PROGRESS.md`.

## Checks (re-run after the fixes)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx expo lint` | 0 errors, 51 warnings (was 176 errors before the review). Warnings are mostly `exhaustive-deps` on sites with a written reason. |
| `npx jest` | 34 suites: 33 passed, 1 skipped (the ferry fixture, which needs a Google key to record); 485 tests passed, 2 skipped |
| `scripts/test-*.ts` | 7 suites, all passed |
| Firebase emulator (`emulators:exec --only firestore,storage,functions,auth`) | 6 suites, 142 tests passed (was 131; +11 alert vote/thanks/byline rules tests). Also runs in CI on every push. |
| `npx expo export --platform ios --platform android` | see the "Export" line at the end of this file |
| `npx expo-doctor` | 18/21. Open: expo-camera is a peer of tfjs-react-native; React Native Directory doesn't know the local native modules; 6 patch-version mismatches (e.g. expo 57.0.32 → 57.0.33). |
| `npm audit --omit=dev` | 7 left (3 moderate, 4 high), all through the react-navigation 6 dependency chain; the fix is a react-navigation 7 migration. The critical `shell-quote` was fixed (`npm audit fix`); `@grpc/grpc-js` pinned to ^1.13.6 via `overrides`. |
| depcheck | `expo-task-manager`, `expo-linking` reported unimported: kept, used by native config. The rest are false positives (config-only packages). |
| Licences (license-checker) | No GPL / AGPL in production dependencies. |

## Findings by area

Severity: High = wrong behaviour or a security hole users would hit; Medium = visible bug or
real cost; Low = tidiness / rare case.

| Area | file:line | Problem | Severity | Fixed? |
|---|---|---|---|---|
| Security (alerts) | `firebase/firestore.rules:56` | Any signed-in user could bump `confirmCount` / `denyCount` without limit (no once-per-user check). | High | YES: votes and thanks now need a create-only `votes/{uid}` / `thanks/{uid}` marker in the same batch; bare bumps refused. 11 emulator tests. |
| Security (alerts) | `firebase/firestore.rules` create rule | A report could be created with a pre-loaded `thanksCount`, or "by" someone else. | Medium | YES: `thanksCount` must be 0; `reporterName` must equal the reporter's auth token name. |
| Alerts | `firebase/firestore.rules:119` | Inbox "Undo" (removing your own hide) was refused by the rule (it required a number). | Medium | YES |
| School zones (server) | `firebase/functions/index.js:1133` | Stale-tile query needed a composite index that doesn't exist, so it would have failed in production. | High | YES: single-field query, region filtered in code |
| CI | `.github/workflows/tests.yml` | Emulator job hung waiting for typed function params. | Medium | YES: `.env.local` with defaults written in CI |
| Navigation | `src/screens/MapScreen.tsx:1102` | Heading lagged one GPS fix behind (derived in an effect after render). | High | YES: derived while rendering |
| Navigation | `src/screens/MapScreen.tsx:4647` | Arrival clock froze while stopped (only recomputed on GPS fixes). | Medium | YES: 30 s clock tick |
| Plan a Drive | `src/screens/PlanADriveScreen.tsx:71` | ETA refetched on every GPS fix (billed request each second). | Medium | YES: keyed by place + departure minute |
| Home map | `src/screens/MapScreen.tsx:5202` | Traffic legend could show with the traffic layer off. | Low | YES |
| Map screen | `src/screens/MapScreen.tsx` | Refs/state used before their declaration (`approachRef`, `lineTapAtRef`, etc.); reset-in-effect cascades (frontView, overview, nav match, speed-limit, suggestions, live ETA). | Medium | YES: moved above first use; reset while rendering |
| Place card | `src/screens/PlaceInfoSheet.tsx` | Street View failure flag leaked between places. | Low | YES: keyed by URL |
| Dead code | 4 files | Unused: `vehicleClassifier.ts`, `types/liveShare.ts`, `trackys/index.ts`, `map/cameraZoom.ts`. | Low | YES: removed (`speedZoom.ts` replaces the last, with tests) |
| Dependencies | `package.json` | react-navigation 6 chain carries 4 high / 3 moderate advisories. | Medium | NO: needs a react-navigation 7 migration (touches every screen) |
| Dependencies | `package.json` | 6 Expo patch mismatches, camera peer warning. | Low | NO: patch bump on the next native build round |
| Maintainability | `src/screens/MapScreen.tsx` (6,537 lines) | One file holds the map, navigation, home controls and every sheet; hard to review. | Medium | NO: pure rules keep moving out to `src/map/*` and `src/nav/*`, but the screen itself still needs splitting |
| Lint | various | 51 warnings remain (mostly deliberate `exhaustive-deps` with reasons). | Low | Partly |
| Server not deployed | `.github/workflows/firebase-deploy.yml` | Presence, Live Traffic NSW, school zones and the new alert rules are tested but have never been deployed. | High (features dark) | NO: owner runs the deploy workflow (DEPLOY.md). Not run by me, as asked. |

## NEEDS DEVICE TEST

Everything visible: TEST_ON_PHONE.md §9-§19 (new: §17 alert card + spotlight, §18 Trackys with two
accounts, §19 brand badges; §16 street pill).

EOF
echo done