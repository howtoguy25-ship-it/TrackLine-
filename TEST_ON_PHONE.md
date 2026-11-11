# Testing Ghost mode + presence on real devices (two-account test)

This environment has no physical device or Android/iOS emulator image, so the Ghost mode/
presence feature (Part 2/3) couldn't be exercised end-to-end here beyond the Firebase Emulator
Suite tests in `TEST_RESULTS.md` (which cover the real server-side rules/Cloud Function logic,
not the on-device UI). This is the real, step-by-step test to run yourself, on two phones (or one
phone + one tablet/second device — anything that can run the dev build and get a real GPS fix).

## What you need

- **Two devices**, each with the latest development build installed (see below).
- **Two different accounts** — doesn't need to be two different people; a second real Google/
  Apple/phone sign-in on the second device is enough. Two anonymous sessions also work for most
  of this, except the "Show my name on reports" step (needs a real sign-in to have a name at
  all).
- Both devices need a real GPS fix and, ideally, to actually be moving above 15 km/h (walking
  fast still won't clear that — driving, or being a passenger, does). If you can't physically
  drive while testing, use the **GPS replay (dev only)** section in Settings (a `__DEV__`-only
  feature) to replay a real GPX export from your own phone's GPS logger / Strava / Google Maps
  Timeline at its own recorded pace — this drives `location.coords.speed` for real, so the
  presence system's speed gate reacts to it exactly like a real drive. There's no bundled sample
  GPX (a fake one would defeat the point) — export a short real drive from your own phone first.

## 1. Install the development build on both devices

```
eas build --profile development --platform all
```

Install the resulting build on each device the normal EAS way (QR code from the build page, or
`eas build:run`). If you already have a recent dev build installed from earlier in this project,
it won't have this feature yet — rebuild.

## 2. Sign in differently on each device

- **Device A ("Visible")**: open the app, sign in with a real account (Settings → Account →
  Sign in). Go to **Settings → Privacy** and choose **"Visible to everyone"**. If you want to
  also test the display-name path, turn on **"Show my name on reports"** here too.
- **Device B ("Ghost")**: open the app, sign in with a different real account (or stay
  anonymous). Leave it alone — **Ghost mode is the default**, so there's nothing to change here.

## 3. Start "driving" on Device A

- From the home map, tap **Plan a drive** (or just **Start** on any route) so a real route is
  active — presence updates only run while a route is active.
- Get Device A's real speed above 15 km/h and **keep it there for at least 3 minutes** (drive,
  be a passenger, or use GPS replay as above). Device A samples its position every 15 seconds
  and sends them once a minute.

## 4. Verify Device B can see Device A — and that it's delayed

- On Device B, make sure **Settings → Map layers → "Show Trackys"** is on (it's on by default).
- **Nothing should appear for the first ~2 minutes.** That's the privacy delay working, not a
  bug: the server holds every point back for at least 60 seconds, so Device A's first minute is
  still private when its first update is sent. Expect Device A's Tracky to appear on Device B
  roughly 2–3 minutes after Device A started moving.
- Once it appears, it should **glide smoothly along the road** rather than jumping, lean
  slightly into its direction of travel, and be showing where Device A was about **two minutes
  ago** — put the two phones side by side and confirm Device B's Tracky is trailing behind
  Device A's real position, not on top of it. If it's ever ahead of or level with Device A's
  real position, that's a real bug — report it.
- Tap that marker. The card should show: Device A's mood (or "Custom Tracky"), its real display
  name (if you turned on "Show my name on reports" in step 2) or "A Tracky" if not, and
  "Driving on <a real nearby road name>".

## 4b. Make your Tracky (the customiser)

- On Device A: Menu → **View profile** → **Make your Tracky**. Pick a preset or build one from
  the Colour / Eyes / Mouth / Extras / Trail tabs, then **Save**.
- Device A's menu header and profile should switch to the new design immediately.
- A locked part (e.g. Party hat before a 7-day driving streak) should show a lock and its
  unlock hint, and Save should be disabled while the design uses one.
- Within a couple of minutes of Device A's next update, Device B should see the custom design
  on the map instead of a mood face — and, if a Trail was chosen, a few small particles
  following behind it while it moves (only drawn when 12 or fewer Trackys are on screen).
- Back on Device A's profile, tap any mood: it should switch back to moods.

## 5. Verify Device A does NOT see Device B

- On Device A's own map, Device B should never appear, however long you wait — Device B is in
  Ghost mode, which is the one thing it controls (nothing to do with Device A's own "Show
  Trackys" setting).

## 6. Wave, Block, Report (from Device B's card for Device A)

- Tap **Wave 👋**. Device A should get a push notification ("A nearby driver waved at you!")
  within a few seconds, if Device A has notification permission granted.
- Tap **Wave 👋** again immediately. It should now show as rate-limited (can't wave again for
  ~10 minutes) — this is the same real server-side check whichever button you tap from.
- Tap **Block**, confirm. Device A's marker should disappear from Device B's map immediately,
  and never reappear even after Device A's next `updatePresence` call.
- On a fresh, unblocked pairing (or after unblocking), tap **Report** and pick a reason — this
  just needs to succeed without an error; there's no in-app way to see the report land since
  it's owner-only (`userReports`), but you can confirm it was written via the Firebase console's
  Firestore tab if you have project access.

## 7. Verify presence disappears correctly

Three separate real triggers, each worth checking on its own:

- **Stop driving.** Let Device A's speed drop below 15 km/h (stop the car, or stop the GPS
  replay) without ending the route. At Device A's next once-a-minute update, its marker should
  be withdrawn from Device B's map.
- **Arrive / end navigation.** Tap **Exit** on Device A's active route. Device A's marker should
  disappear from Device B's map right away (not wait out the ~2-minute TTL) — this also
  auto-flips Device A into Ghost mode (check Settings → Privacy on Device A to confirm).
- **Manually turn on Ghost mode mid-drive.** While Device A is still actively "driving" above 15
  km/h, long-press the Menu button (top-left on the map) → toggle the big switch to Ghost. Device
  A's marker should disappear from Device B's map immediately, not at the next 60s tick.

## 8. Verify the Home/Work/trip exclusion zone

- On Device A, set a **Home** address (Settings, or the "Where to?" sheet's Home/Work chips) to
  somewhere close to where Device A will actually be driving during this test.
- Start driving such that Device A's real position comes within ~500m of that saved Home
  address, while otherwise visible and driving above 15 km/h.
- Device A's marker should NOT appear on Device B's map while within that radius, even though
  every other condition (visible, driving, Show Trackys on) is met — it should reappear once
  Device A's real position moves back outside that ~500m radius.

## If something doesn't match this

This document describes the intended, real behavior as built and already verified at the
rules/Cloud-Function level (`TEST_RESULTS.md`). If a step above doesn't match what you actually
see on a real device, that's a genuine bug in the client-side wiring (`src/screens/MapScreen.tsx`,
`src/services/presence.ts`, `src/screens/PresenceCard.tsx`) that the emulator tests wouldn't have
caught, since they don't exercise the React Native UI at all — please report exactly which step
failed and what you saw instead.
