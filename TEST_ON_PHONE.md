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

## 1. Install a build on both devices

Either kind of build works for this test:

- **A production build** (TestFlight on iPhone, the `.aab`/Play internal track on Android) --
  the simplest route, and the only one that has actually been built successfully for both
  platforms so far. It runs on its own with no computer attached. The one thing it lacks is the
  **GPS replay** tool mentioned above, which only exists in development builds -- so with a
  production build you need to really be moving.
- **A development build** (`eas build --profile development --platform android`) -- has GPS
  replay, but needs a computer running `npx expo start` on the same network for the app to load.
  The Android development profile builds for 64-bit ARM phones only (every current Android
  phone; not x86 emulators) -- building all four chip types at once ran the EAS build machine
  out of memory. An iPhone development build can't be made from an automated session: it needs
  your devices registered and its provisioning set up interactively (`eas device:create`, then
  `eas build --profile development --platform ios` from your own terminal).

Any build from before this feature was added won't have it -- install a new one.

**Before any of this will work**, the server side has to be deployed: run the "Deploy Firebase (functions, Firestore rules, Storage rules)"
GitHub Action once (see `DEPLOY.md`). Until then the app builds and runs normally, but no
Tracky will ever appear on another phone, because the Cloud Functions it calls don't exist yet.

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

## 9. UI pass 2 — NEEDS DEVICE TEST

One device is enough. Install the development build from §1, sign in, and allow location.

**Home map**
- [ ] Every screen is in Rubik (compare a menu label with the system font — Rubik's "g" and "y" are rounder).
- [ ] Buttons shrink slightly and tick (haptic) when pressed.
- [ ] Your arrow sits about two-thirds of the way down the screen; the map turns with your heading.
- [ ] Drag the "Where to?" sheet up: the floating buttons ride on top of it, then fade out just above half height and can't be tapped.
- [ ] Pan away: Re-centre appears; tap it and the map flies back in about half a second.
- [ ] Compass needle turns as the map rotates; tapping it points north.
- [ ] Street pill under the arrow changes name smoothly as you turn onto a new road; parked for 10 s with reports nearby, it slides to "N reports around you".
- [ ] Report pins grow as you zoom in and group into counts when zoomed out.

**Search and place page**
- [ ] The search slides up quickly; Food/Fuel/Parking/Hotels chips work; typing shows Australian results nearest-first among equal matches.
- [ ] Swipe a recent search left to delete it.
- [ ] Pick a place: the place page covers the bottom 60% with the place pinned in the middle above it; Back returns to the search.
- [ ] Add photo: pick one from your library; it shows as yours (pending) and nobody else sees it until approved.

**Route selection** (pick any destination a few km away)
- [ ] No ad banner. The top card shows "Your location" and the destination; tapping each lets you change it; ↑↓ swaps them.
- [ ] Up to three routes: the selected one purple with a dark edge, others lavender; tapping a lavender line or its bubble selects it.
- [ ] Time bubbles sit on their own lines and never cover each other; the selected one is dark purple with "Best" / "Fastest" / "No tolls" under the time.
- [ ] In heavy traffic, the slow parts of the purple line are orange and jams red.
- [ ] All routes fit between the top card and the bottom sheet.
- [ ] Bottom sheet shows the time, distance, "Via …" and e.g. "Best route, Typical traffic · Toll"; pull it up for the list, with the selected row marked by a blue bar.
- [ ] Avoid ▾: switch on Toll roads — routes reload, the pill reads "Avoid · 1", and it's still on for the next trip.
- [ ] Drive ▾ → Walk / Bike / Transit shows those routes.
- [ ] Do nothing for 10 s: Go now fills darker blue and navigation starts. Touch the screen during the fill: it stops.
- [ ] Leave later opens Plan a drive with this destination filled in. "Add a stop" (pulled-up list) adds a stop.

## 10. Buttons respond (bug fix) — NEEDS DEVICE TEST

- [ ] Menu › each row (Plan a drive, Sign in, Inbox, Dashcam, Map display, Settings, Invite a friend, Help, Visible to other drivers, View profile) opens its screen in front, and Back returns to the Menu. No keyboard appears on the Menu.
- [ ] Dashcam › Run REV Check opens REV Check on top of the camera; Scan plate/VIN opens on top of that.
- [ ] Every floating home button, place-page button and route-screen button responds on the first tap.
- [ ] With the search keyboard up, tapping a result works first time (doesn't just close the keyboard).
- [ ] Settings › Developer › Touch debugger on: each tap shows a red box with a component name on what you touched.

## 11. The new Mapbox map — NEEDS DEVICE TEST

Install the development build from the `mapbox-map` branch.
- [ ] Map opens on your position: pale land, green parks, blue water, light-grey roads with white edges; Mapbox logo bottom-left.
- [ ] Zoom out to a city view: motorway/primary names still show; residential names appear from street level; names never overlap.
- [ ] Highway numbers (M2, A3…) sit on green shields with yellow text; suburb names are large blue-grey capitals.
- [ ] Settings › Map appearance: each colour theme and road thickness changes the map; Map view › Satellite shows imagery with names.
- [ ] Tilt the map with two fingers past ~30°: buildings rise (with 3D buildings on). Front view button tilts further.
- [ ] Your arrow glides smoothly (no jumping), turns with heading; the teal accuracy circle stays the same size on the ground when zooming.
- [ ] Drag the map: Re-centre appears; tap it to fly back. Twist/pinch also count as moving the map.
- [ ] Pick a destination: lavender alternatives (tap to select), purple selected route with orange/red traffic, time bubbles, blue start dot, checkered flag; routes fit between card and sheet.
- [ ] Go: purple route with white edge; the part behind you fades; a white arrow on the route at the next turn; dark-purple street callouts; tap the route for overview; auto-zoom eases in near turns and out on motorways.
- [ ] Dev build: tap **Simulate drive** during navigation; the car drives the route at 50 km/h and guidance follows. Tap again to stop.
- [ ] Report pins sit on the road and group into numbered circles when zoomed out; tapping opens the report; a selected report shows its comment.
- [ ] Traffic lights / speed cameras / fuel / food / hotel pins and their clusters; NSW incidents and traffic cameras; Trackys of other drivers glide along roads.
- [ ] Tap a shop/park name on the map: its place card opens.
- [ ] About › Licences lists © Mapbox and © OpenStreetMap.

## 12. Buttons and colours — NEEDS DEVICE TEST

- [ ] Settings › About shows `Build v… · <commit> · <date> UTC`; on a development build it also says "JS from dev server".
- [ ] Home: Menu is a white rounded square, Sound and Compass white circles, Report a yellow circle with a black outline, Re-centre (after panning) a dark-grey circle. All cast the same soft shadow.
- [ ] Press any button: it dips slightly and darkens, with a light tap; no bounce.
- [ ] Route selection: Go now is solid blue, Leave later light grey with blue text; "Light traffic" green, "Heavy traffic" red; the selected route's time is blue.
- [ ] Danger: Delete actions are red text on pale red; only a final "yes, delete" is solid red.
- [ ] Live Traffic NSW pins: report colours, roadwork a diamond, a small white "i" badge.
- [ ] Settings › Map appearance › Dark: floating buttons turn dark grey with white icons.
- [ ] iOS/Android Reduce Motion on: Go now has no countdown fill; Tracky stops bobbing; nothing else loops.

## If something doesn't match this

This document describes the intended, real behavior as built and already verified at the
rules/Cloud-Function level (`TEST_RESULTS.md`). If a step above doesn't match what you actually
see on a real device, that's a genuine bug in the client-side wiring (`src/screens/MapScreen.tsx`,
`src/services/presence.ts`, `src/screens/PresenceCard.tsx`) that the emulator tests wouldn't have
caught, since they don't exercise the React Native UI at all — please report exactly which step
failed and what you saw instead.
