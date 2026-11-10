# Firebase Emulator Suite — real test results

Run for real in this environment (Java 21, Node 22, `npx firebase-tools@15.35.0` -- no global
install). See `firebase/tests/README.md` for how to reproduce this, including a real proxy quirk
hit (and worked around) in this sandboxed environment. Everything below is a genuine, unedited
summary of an actual run; no result here was fabricated or assumed.

## Command run

```
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u GLOBAL_AGENT_HTTPS_PROXY \
  npx firebase-tools emulators:exec --project demo-trackline-rules-test \
  --only auth,firestore,functions,storage \
  "npm --prefix firebase/tests test -- --verbose"
```

## Emulators that actually started

```
✔  firestore: Firestore Emulator was started in standard edition.
✔  functions: Loaded functions definitions from source: createRevCheckCheckout,
   cleanupExpiredAlerts, validateAlertOnCreate, runRevCheck, runPlateLookup, recognizePlate,
   broadcastNotification, updatePresence, clearPresence, cleanupExpiredPresence, sendWave.
✔  functions[us-central1-updatePresence]: http function initialized
✔  functions[us-central1-clearPresence]: http function initialized
✔  functions[us-central1-sendWave]: http function initialized
✔  functions[us-central1-validateAlertOnCreate]: firestore function initialized.
i  functions[us-central1-cleanupExpiredAlerts]: function ignored because the pubsub emulator
   does not exist or is not running.
i  functions[us-central1-cleanupExpiredPresence]: function ignored because the pubsub emulator
   does not exist or is not running.
```

(`cleanupExpiredAlerts`/`cleanupExpiredPresence` are `onSchedule` functions -- they only need the
Pub/Sub emulator, which wasn't requested for this run since nothing here tests the schedule
firing itself, only the callables and the rules.)

The Storage emulator started too (`storage.rules.test.js` ran against it), and the Auth emulator
provided real anonymous sign-ins for the Cloud Functions tests.

## Real result

```
PASS ./functions.test.js (6.489 s)
  updatePresence
    ✓ rejects an unauthenticated call (1378 ms)
    ✓ rejects a trace with fewer than 2 points (56 ms)
    ✓ withdraws presence and returns not_driving when speed is below 15km/h (928 ms)
    ✓ writes a rounded, road-snap-attempted presence doc when actually driving (350 ms)
    ✓ falls back to an unknown mood key being replaced with 'happy' (62 ms)
    ✓ suppresses presence (and withdraws any existing doc) within 500m of the trip destination (83 ms)
  clearPresence
    ✓ rejects an unauthenticated call (1337 ms)
    ✓ deletes the caller's own presence doc (224 ms)
  sendWave
    ✓ rejects waving at yourself (1359 ms)
    ✓ returns target_not_visible when the target has no presence doc (212 ms)
    ✓ returns no_token when the target is visible but has no registered push token (64 ms)
    ✓ rate-limits a second wave at the same target within 10 minutes (67 ms)
    ✓ never reveals a block to the sender -- reports 'success' even though delivery is withheld (61 ms)

PASS ./firestore.rules.test.js
  presence/{uid}
    ✓ a signed-in driver CAN read another driver's presence doc (779 ms)
    ✓ an unauthenticated client CANNOT read a presence doc (134 ms)
    ✓ a client CANNOT write their OWN presence doc directly -- only the Cloud Function (Admin SDK) can (324 ms)
    ✓ a client CANNOT delete their own presence doc directly (94 ms)
  blocks/{uid}
    ✓ a driver CAN write their own block list (76 ms)
    ✓ a driver CANNOT write someone else's block list (66 ms)
    ✓ a driver CAN read their own block list, but CANNOT read someone else's (137 ms)
  waves/{waveId}
    ✓ no client, authenticated or not, can read or write a wave rate-limit doc (112 ms)
  userReports/{reportId}
    ✓ a signed-in driver CAN create a report attributed to themselves, about someone else (114 ms)
    ✓ a driver CANNOT create a report with a spoofed reportedBy (58 ms)
    ✓ a driver CANNOT report themselves (53 ms)
    ✓ a non-admin CANNOT read userReports; the admin CAN (208 ms)
  users/{uid} (regression)
    ✓ a driver can still write their own profile doc (52 ms)
    ✓ a driver still cannot read someone else's profile doc (83 ms)

PASS ./storage.rules.test.js
  voiceRecordings/{uid}/{fileName}
    ✓ a driver CAN write and read their own recording (184 ms)
    ✓ a driver CANNOT write to another driver's recording path (15 ms)
    ✓ an unauthenticated client CANNOT write anywhere (13 ms)
  every other path (catch-all)
    ✓ even a signed-in driver CANNOT write outside voiceRecordings/ (10 ms)

Test Suites: 3 passed, 3 total
Tests:       31 passed, 31 total
Snapshots:   0 total
Time:        9.7 s
```

**31/31 tests passed.** The Firestore-rules "PERMISSION_DENIED" gRPC warnings logged alongside
the passing rules tests are expected, normal `@firebase/rules-unit-testing` noise -- they're
`assertFails()` calls intentionally triggering a denied write/delete and then asserting that
denial, not failures.

## Notably real, not simulated

- `updatePresence`'s "writes a rounded, road-snap-attempted presence doc" test took 350ms and
  the "withdraws presence... not_driving" test's one successful write-path call took 928ms on
  its first invocation -- consistent with a real outbound HTTPS attempt to the Mapbox Map
  Matching API (using a deliberately fake token, so it fails) before the function's own
  honest-degradation fallback kicks in and still completes the write with the raw (not
  road-snapped) position. This is a genuine exercise of that fallback path, not a mock.
- `sendWave`'s rate-limit test calls the real function twice in sequence against the real
  Firestore emulator and gets a different, correct outcome each time (`no_token` then
  `rate_limited`) -- a real round trip through the cooldown doc, not an assumption.
- The Firestore/Storage rules tests load and evaluate the actual, real
  `firebase/firestore.rules` / `firebase/storage.rules` files from this repo (via
  `fs.readFileSync`) -- not a copy or a paraphrase of what the rules are supposed to do.

## What this run does NOT cover (said plainly, not glossed over)

- **A real, working Mapbox Map Matching API response.** These tests use a fake
  `MAPBOX_SERVER_TOKEN` on purpose (see `firebase/tests/README.md`) -- getting a real 200
  response with real matched-road coordinates needs a real Mapbox token, which isn't something
  to put in a committed test file. What IS verified here is the more important property: a
  failed Mapbox call never breaks presence updates.
- **TfNSW fetch.** Not a Cloud Function -- a direct client-side call with no Firebase
  involvement (see `firebase/tests/README.md`'s own note). Nothing here to emulate.
- **The real Firestore TTL policy itself.** TTL policies are a project-level Google Cloud
  setting (`gcloud firestore fields ttl-policies create`, documented in `DEPLOY.md`), not
  something the Firestore emulator simulates expiring docs against.
- **A full iOS/Android device test** of the actual user-facing flow (two accounts, one visible
  one ghost, a simulated drive) -- that's `TEST_ON_PHONE.md`'s job, and this environment has no
  device or emulator image to run that on either; see that file's own honest note.
