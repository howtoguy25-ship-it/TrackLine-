# Firebase Emulator Suite tests

Real tests for `firebase/firestore.rules`, `firebase/storage.rules`, and the Ghost mode/presence
Cloud Functions (`updatePresence`, `clearPresence`, `sendWave`) in `firebase/functions/index.js`
-- run against the actual Firebase Emulator Suite, not a hand-rolled simulation. See
`../../TEST_RESULTS.md` (repo root) for the real, pasted output of the last full run.

## One-time setup

```
npm --prefix firebase/functions install
npm --prefix firebase/tests install
```

`updatePresence` reads a Cloud Functions secret (`MAPBOX_SERVER_TOKEN`) via `defineSecret`. The
emulator needs *some* value for it even though these tests never need it to be a real, working
Mapbox token -- `updatePresence` is deliberately built to fall back gracefully (and still build
a valid path from the raw samples) if the real Mapbox Map Matching API call fails, which is exactly what
happens with a fake token, and is itself one of the things these tests verify. Create
`firebase/functions/.secret.local` (already gitignored) with:

```
MAPBOX_SERVER_TOKEN=pk.emulator-test-not-a-real-token
```

## Running the tests

From the repo root:

```
npx firebase-tools emulators:exec --project demo-trackline-rules-test \
  --only auth,firestore,functions,storage \
  "npm --prefix firebase/tests test"
```

`--project demo-trackline-rules-test` (any `demo-*` project ID) tells every emulator to run in a
fully offline, no-real-credentials-needed mode -- this never touches a real Firebase project.

### A real environment quirk hit while building this

In the sandboxed environment this suite was first run in, the Functions emulator's own
*internal* call to the Firestore emulator (both on `127.0.0.1`, registering the pre-existing
`validateAlertOnCreate` Firestore trigger) was being incorrectly routed through that
environment's outbound HTTPS proxy, which doesn't speak the emulator's internal protocol -- the
proxy's own plain-text error response broke the emulator's JSON parsing, and it had nothing to
do with any code in this repo (the environment's own `NO_PROXY`/`no_proxy` already listed
`127.0.0.1`/`localhost`, which should have exempted this, but evidently didn't for every tool in
that proxy chain). Unsetting the proxy env vars for just this one command fixed it completely:

```
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u GLOBAL_AGENT_HTTPS_PROXY \
  npx firebase-tools emulators:exec --project demo-trackline-rules-test \
  --only auth,firestore,functions,storage \
  "npm --prefix firebase/tests test"
```

If you hit the same `Error adding firestore function: FirebaseError: Unable to parse JSON` error
running these locally or in CI behind a proxy, try the same thing.

## What's covered

- **`firestore.rules.test.js`** -- `presence/{uid}` (read-any-signed-in/write-never-from-a-
  client), `presencePending/{uid}` (the privacy-delay buffer: no client read or write at all),
  `blocks/{uid}` (owner read/write only), `waves/{waveId}` (fully denied to every client),
  `userReports/{reportId}` (self-attributed create only, admin-only read), and a regression
  check on the pre-existing `users/{uid}` rules.
- **`storage.rules.test.js`** -- the pre-existing `voiceRecordings/{uid}` rules (own-only
  read/write, catch-all deny everywhere else).
- **`functions.test.js`** -- `updatePresence` (auth, sample validation, the speed<15km/h
  withdrawal, the 60s privacy delay actually holding fresh points back, path extension across
  calls, mood and custom-look whitelisting, exclusion-zone suppression and filtering),
  `clearPresence`, and `sendWave`.
- **`presencePath.test.js`** -- pure unit tests (no emulator needed) of
  `firebase/functions/presencePath.js`: turning Mapbox road geometry into timed points,
  downsampling, and the custom-look whitelist.

The app-side playback maths has its own check, run separately from the repo root:

```
npx tsx scripts/test-presence-playback.ts
```

## What this does NOT cover

- A real, working Mapbox Map Matching API call (would need a real `MAPBOX_SERVER_TOKEN` --
  these tests intentionally use a fake one to exercise the honest-degradation fallback path
  instead, which is the behavior that actually matters for correctness).
- "TfNSW fetch" -- this isn't a Firebase Cloud Function at all (see `src/services/
  liveTrafficCameras.ts`/`liveVehiclePositions.ts`): it's a direct client-side HTTPS call to
  `transport.nsw.gov.au`/`opendata.transport.nsw.gov.au`, with no Firebase involved, so there is
  nothing for the Firebase Emulator Suite to emulate here.
- The real Firestore TTL policy on `presence.expireAt` -- TTL policies are a Google Cloud
  project setting (`gcloud firestore fields ttl-policies create`, see `DEPLOY.md`), not something
  the Firestore emulator simulates; `cleanupExpiredPresence`'s own scheduled-cleanup logic is
  the same `where("expireAt", "<=", now)` batch-delete pattern already proven correct by
  `cleanupExpiredAlerts`, so a dedicated emulator test for it would mostly be re-testing that
  same, already-shipped pattern rather than anything new.
