# Test results — real runs

Everything below is the genuine output of a real run in this environment (Java 21, Node 22,
`npx firebase-tools@15.35.0`, no global install). Nothing here was fabricated or assumed. See
`firebase/tests/README.md` for how to reproduce it, including a real proxy quirk hit (and worked
around) in this sandboxed environment.

Two separate things were run:

1. **The Firebase Emulator Suite** (Auth + Firestore + Functions + Storage) — the real security
   rules and the real Cloud Functions, plus pure unit tests of the server's path-building code.
2. **The playback maths** the app uses to animate other drivers' Trackys (`presencePlayback.ts`).

## 1. Firebase Emulator Suite — 59/59 passing

```
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u GLOBAL_AGENT_HTTPS_PROXY \
  npx firebase-tools emulators:exec --project demo-trackline-rules-test \
  --only auth,firestore,functions,storage \
  "npm --prefix firebase/tests test -- --verbose"
```

```
PASS ./functions.test.js (7.825 s)
  updatePresence
    ✓ rejects an unauthenticated call (1588 ms)
    ✓ rejects a batch with fewer than 2 samples (66 ms)
    ✓ withdraws presence AND the pending buffer, and returns not_driving, below 15km/h (1008 ms)
    ✓ PRIVACY DELAY: fresh samples are buffered privately and NOT published (304 ms)
    ✓ PRIVACY DELAY: only points at least 60s old are ever published (138 ms)
    ✓ a second call a moment later extends the published path instead of replacing it (252 ms)
    ✓ an unknown mood key is replaced with 'happy' (95 ms)
    ✓ a custom Tracky look is whitelisted field by field before other drivers can see it (94 ms)
    ✓ a look with an invalid core field is dropped entirely (103 ms)
    ✓ suppresses presence (and withdraws doc + pending buffer) within 500m of the trip destination (60 ms)
    ✓ points that passed through an exclusion zone earlier in the batch are never published (114 ms)
  clearPresence
    ✓ rejects an unauthenticated call (1452 ms)
    ✓ deletes the caller's own presence doc and private pending buffer (277 ms)
  sendWave
    ✓ rejects waving at yourself (1370 ms)
    ✓ returns target_not_visible when the target has no presence doc (251 ms)
    ✓ returns no_token when the target is visible but has no registered push token (77 ms)
    ✓ rate-limits a second wave at the same target within 10 minutes (93 ms)
    ✓ never reveals a block to the sender -- reports 'success' even though delivery is withheld (72 ms)

PASS ./firestore.rules.test.js
  presence/{uid}
    ✓ a signed-in driver CAN read another driver's presence doc (795 ms)
    ✓ an unauthenticated client CANNOT read a presence doc (149 ms)
    ✓ a client CANNOT write their OWN presence doc directly -- only the Cloud Function (Admin SDK) can (348 ms)
    ✓ a client CANNOT delete their own presence doc directly (121 ms)
  presencePending/{uid} (the server-side privacy-delay buffer)
    ✓ NO client can read it -- not another driver, not even the driver it belongs to (281 ms)
    ✓ no client can write it either (75 ms)
  blocks/{uid}
    ✓ a driver CAN write their own block list (90 ms)
    ✓ a driver CANNOT write someone else's block list (80 ms)
    ✓ a driver CAN read their own block list, but CANNOT read someone else's (169 ms)
  waves/{waveId}
    ✓ no client, authenticated or not, can read or write a wave rate-limit doc (123 ms)
  userReports/{reportId}
    ✓ a signed-in driver CAN create a report attributed to themselves, about someone else (110 ms)
    ✓ a driver CANNOT create a report with a spoofed reportedBy (69 ms)
    ✓ a driver CANNOT report themselves (73 ms)
    ✓ a non-admin CANNOT read userReports; the admin CAN (229 ms)
  users/{uid} (regression)
    ✓ a driver can still write their own profile doc (67 ms)
    ✓ a driver still cannot read someone else's profile doc (93 ms)

PASS ./presencePath.test.js
  timeAlongGeometry (Mapbox [lng, lat] road geometry -> timed points)
    ✓ first and last vertices get exactly the batch's own start/end times (1 ms)
    ✓ times are spread by DISTANCE along the road, not by vertex count (1 ms)
    ✓ swaps Mapbox's [lng, lat] order into {lat, lng} (1 ms)
    ✓ times never go backwards
    ✓ a zero-length match (stationary) doesn't divide by zero (1 ms)
  downsample
    ✓ leaves a short list untouched
    ✓ caps a long list at the limit and always keeps both endpoints (1 ms)
    ✓ keeps the original order (1 ms)
  sanitizeLook (a design shown on OTHER drivers' phones)
    ✓ passes a fully valid design through (1 ms)
    ✓ rejects the whole design: missing colour
    ✓ rejects the whole design: non-hex colour
    ✓ rejects the whole design: short hex (1 ms)
    ✓ rejects the whole design: unknown eye style
    ✓ rejects the whole design: unknown mouth style
    ✓ rejects the whole design: not an object
    ✓ rejects the whole design: null
    ✓ drops unknown optional parts instead of storing them
    ✓ an accessory colour is only kept alongside a valid accessory (1 ms)
  geometry helpers
    ✓ haversineMeters: 0.001 deg of latitude is ~111m
    ✓ bearingDegrees: north is 0, east is 90
    ✓ roundCoord keeps 5 decimal places (~1m)

PASS ./storage.rules.test.js
  voiceRecordings/{uid}/{fileName}
    ✓ a driver CAN write and read their own recording (168 ms)
    ✓ a driver CANNOT write to another driver's recording path (19 ms)
    ✓ an unauthenticated client CANNOT write anywhere (13 ms)
  every other path (catch-all)
    ✓ even a signed-in driver CANNOT write outside voiceRecordings/ (10 ms)

Test Suites: 4 passed, 4 total
Tests:       59 passed, 59 total
Snapshots:   0 total
Time:        11.554 s, estimated 12 s
```

The Firestore-rules "PERMISSION_DENIED" gRPC warnings logged during a run are expected, normal
`@firebase/rules-unit-testing` noise — they're `assertFails()` calls intentionally triggering a
denied read/write and then asserting that denial, not failures.

### What these prove about the privacy delay (ADD-ON Part B)

- **"fresh samples are buffered privately and NOT published"** — a driver's just-taken points go
  into `presencePending/{uid}` and no `presence/{uid}` doc exists for others to read.
- **"only points at least 60s old are ever published"** — given one 90-second-old sample and one
  taken just now, the readable doc contains only the old one; the new one is still in the
  private buffer.
- **`presencePending` rules** — no client can read that buffer: not another driver, and not the
  driver it belongs to. That's what makes the delay a guarantee rather than a convention.
- **exclusion zones** — being inside one withdraws both the published doc and the private buffer;
  points that merely passed through one earlier in a batch are filtered out before publishing.

## 2. Playback maths — 19/19 passing

```
npx tsx scripts/test-presence-playback.ts
```

```
presencePlayback
  ✓ empty path -> no pose
  ✓ before the first point -> parked on it, not moving
  ✓ exactly halfway through a segment -> halfway between its points
  ✓ heading north reads as ~0 degrees
  ✓ position is continuous across a point boundary
  ✓ dead-reckoning: just past the last point keeps going the same way at the same speed
  ✓ dead-reckoning is CAPPED: long after the last point the Tracky has stopped, not sailed off
  ✓ dead-reckoning speed is capped even if two points imply an absurd speed
  ✓ a single-point path never moves and never throws
  ✓ two points at the same place -> not 'moving', no NaN
displayTimeFor
  ✓ at the moment an update arrives, playback is the full delay behind it
  ✓ it then advances by exactly the viewer's own elapsed time
  ✓ a viewer clock that jumps BACKWARDS never rewinds playback before the delay point
  ✓ consecutive one-minute batches join up: batch 2 starts where batch 1 ends
  ✓ playback never shows a point newer than the server's 60s privacy delay allows
leanDegrees
  ✓ heading east leans fully one way, west the other, north/south not at all
  ✓ a stopped Tracky stands upright
playbackBudget
  ✓ more Trackys on screen -> slower ticks and fewer (then no) trail particles
  ✓ Reduce Motion: no trails, and only an occasional position update

19 checks passed
```

## What these runs do NOT cover (said plainly)

- **A real, working Mapbox Map Matching response.** The emulator tests use a fake
  `MAPBOX_SERVER_TOKEN` on purpose, so `updatePresence` always takes its "Mapbox failed, fall
  back to the raw samples" branch there. The code that turns a *successful* match into a timed
  road path is covered separately and directly by `presencePath.test.js` (`timeAlongGeometry`,
  `downsample`) with hand-built geometry — but no test here has ever received a real response
  from Mapbox. The first real confirmation of that will be a deployed function with a real token.
- **Anything on a real phone.** No device or emulator image exists in this environment. The map
  layer that actually moves the markers (`PresenceLayer.tsx`), the 15-second sampler in
  `MapScreen.tsx`, the customiser screen, and the trail particles have been typechecked and
  linted but **never run**. `TEST_ON_PHONE.md` is the real test for those.
- **TfNSW fetch.** Not a Cloud Function — a direct client-side call with no Firebase
  involvement. Nothing here to emulate.
- **The real Firestore TTL policies.** A project-level Google Cloud setting (see `DEPLOY.md`),
  not something the Firestore emulator simulates.
- **The scheduled cleanup (`cleanupExpiredPresence`).** It needs the Pub/Sub emulator, which
  these runs don't start; it's the same batched-delete pattern as the already-shipped
  `cleanupExpiredAlerts`.
