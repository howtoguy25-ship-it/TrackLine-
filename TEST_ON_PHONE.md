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

## 13. Lane guidance on a real motorway — NEEDS DEVICE TEST

Needs the Mapbox token in the build. Do these as a passenger, or note what you saw after parking.
- [ ] Development build: Settings › Developer › "M4 Silverwater exit (taken)". The car drives onto the M4; ~1 km before the Silverwater Road exit the top card shows 4 lane tiles with the left one blue and a little bigger; the voice says "...keep left, use the left lane to take the exit to Silverwater Road".
- [ ] Same drive, ~400 m before the exit (it's doing 90 km/h): the map zooms in and tilts (about 1 s), the route through the split is wider and brighter, the exit side glows, a label sits at the split, and other drivers and venue pins disappear meanwhile.
- [ ] After the exit: a green "Exit taken ✓" chip under the top card with a soft chime (silent if sound is off), then the camera eases back to the normal view.
- [ ] Settings › Developer › "M4 Silverwater exit (missed)": the car stays on the M4; within a few seconds of passing the exit the camera eases back, "Rerouting…" shows, you hear "Re-routing" and then the new first instruction, and a new route is drawn from where the car is.
- [ ] Real drive: a motorway exit you know (e.g. M4 eastbound to Silverwater Rd, M5 eastbound to Marsh St). Lane tiles where the data has them; nothing where it doesn't (that's correct, not a bug).
- [ ] Real drive: joining a motorway from an on-ramp. Approach zoom near the merge, then "Merge complete ✓".
- [ ] Real drive: miss an exit on purpose where safe. Rerouting starts within a few seconds and the new route arrives in about 2 s.
- [ ] Pan the map during an approach: the zoom stops and doesn't come back until the next manoeuvre.
- [ ] Turn instructions now name the turn that's coming (not the one you've just done), with the right distance.
- [ ] Every ordinary turn is followed too (no zoom for plain turns): make a city turn as told and a green "Turn complete ✓" shows; at a roundabout, "Roundabout done ✓".
- [ ] Miss an ordinary city turn on purpose (go straight where it says turn): "Rerouting…" within a few seconds, then the new route. It must never say "Turn complete ✓" for a turn you didn't make.
- [ ] Slow traffic through a run of roundabouts: each one still gets its chip (the approach waits up to 3 min, not 45 s).
- [ ] iPhone with the ring/silent switch ON silent, and EV Radar off: start a drive. The voice, recorded clips and the "Exit taken ✓" chime are all heard. Lock the screen: the voice carries on. Music from another app keeps playing underneath.
- [ ] Leave a car park whose exit doglegs (turn, short bit, turn back): the instructions follow you round in order; going straight instead gives "Rerouting…", never "Turn complete ✓".
- [ ] A tunnel (M5 East, Eastern Distributor, Lane Cove Tunnel): the arrow keeps moving along the road while there's no GPS, nothing reroutes, and the exit after the tunnel still gets its chip.
- [ ] Phone in airplane mode mid-drive, then miss a turn: "No connection — keep following the current road"; the old route stays drawn.
- [ ] Zoomed approach on a slow exit: the camera goes back after at most 20 s; switching apps and back during an approach returns to the normal view.
- [ ] Lane strip and zoom feel smooth (no stutter) on an iPhone 11 or older; battery drain over a 30-min drive with the screen off is reasonable.
- [ ] Outside Australia (or in a right-hand-traffic country on a trip): an exit or motorway split zooms in the same way; a U-turn lane arrow swings left there (right in the UK, Japan, Australia...); roundabout arrows go the local way round.

## 14. School zones and speed limits — NEEDS DEVICE TEST

Real data only: NSW official zones (Transport for NSW). Do these as a passenger.
- [ ] Before a first test, the school-zone data must be on the server: the `refreshSchoolZones` function runs every Monday 3:17 am Sydney time after deploy (or run it once from the Firebase console).
- [ ] School day (e.g. Tue 17 Nov 2026), 8:00–9:30 am or 2:30–4:00 pm: drive into a NSW school zone. The sign changes to 40 with a school badge and "until 9:30 am" (or "until 4:00 pm"); you hear "School zone, 40" once; the zone on the map is bright amber with a school icon.
- [ ] Same zone outside the hours, at a weekend, on a public holiday or in the school holidays: no badge, no call-out, the road's normal limit on the sign; the zone on the map is faded.
- [ ] Parked in a zone at 7:59 am on a school day: at 8:00 exactly the sign switches to 40 (and at 9:30 back).
- [ ] A parallel road or a cross street next to a zone: no school-zone sign.
- [ ] Settings › Alerts & community › Road features › School zones: "Show on map" off hides the amber zones; "Alert while driving" off stops the call-out (the sign still shows the school-zone limit).
- [ ] Settings › Navigation & voice › Speed › "Alert at threshold": set 1 km/h; at 42 in a 40 zone the chime sounds. Set 5; it doesn't until 45.
- [ ] Where there's no real limit for a road, there is no sign at all (not a guess).
- [ ] iPhone set to a US region: the sign is a white rectangle; with Settings distance in miles it shows mph.
- [ ] Tap the speed sign: "Speed limit and school zones" opens. Report "Wrong speed limit" → "Thanks…". From a second account at the same spot, the report shows with "Confirm"; the first account can't confirm its own.
- [ ] Turn on airplane mode after driving an area once: zones still work there (cached), for up to 30 days.
- [ ] Settings › About › Data sources lists where the map, limits and school zones come from.

## 15. Travel modes — NEEDS DEVICE TEST

- [ ] Pick a destination, tap the **Drive ▾** pill: "Getting there" shows Drive, Motorbike, Bike, Walk, Transit, each with a time (or "—" and why). The selected one is blue.
- [ ] Pick Bike: bike routes are drawn and listed; the pill says Bike. Close the screen, pick another destination: it opens in Bike (remembered).
- [ ] Pick Motorbike: routes are shown; if Google has no motorbike routing here, the sheet says "Motorbike routes use car roads here".
- [ ] Putney → Mortlake (the Mortlake car ferry): Ferry appears in the picker and the drive route row says "Includes ferry". Avoid › Ferries on: the ferry route disappears.
- [ ] Circular Quay → Manly: Ferry appears; picking it shows the transit trip with the Manly ferry.
- [ ] Bankstown → Parramatta: no Ferry in the picker.
- [ ] Switching modes keeps From, To and any stop.

## 16. Street-name pill and home buttons — NEEDS DEVICE TEST

- [ ] Home map, sheet at its lowest: the white pill is bottom-centre, 12pt above the sheet, level with the yellow report button (same height, same bottom). Your arrow sits right above it, the pill just touching the bottom of the grey accuracy circle.
- [ ] Drag the sheet up: the pill and Report ride up together and fade out past half height.
- [ ] Drive past 3 streets (as a passenger): the pill changes at each corner, cross-fading, to the street you're on -- not a parallel or cross street.
- [ ] A long street name shrinks a little, then ends with "…"; it never touches the report button (try iPhone SE and Pro Max if you have them).
- [ ] Stop for 10 s where there are reports nearby: "N reports around you"; drive off: back to the street name. No reports: stays the street name.
- [ ] Start navigation: the pill disappears (top card and bottom banner take over). Pan the map away: the pill hides and the dark re-centre button appears bottom-left.
- [ ] Settings › Map appearance › Map labels: Local / My app language / Both change the map's names straight away (try Both in Tokyo, Riyadh or Beirut on the map).
- [ ] Zoom to street level in Sydney: suburb labels read e.g. "PUNCHBOWL 2196". Overseas: suburb names with no postcode.

## 17. Tap a pin: alert card + spotlight — NEEDS DEVICE TEST

Before this, deploy the Firestore rules (DEPLOY.md). Until you do, thumbs-up and "Still here /
Not here" are refused by the old server rules.

1. On the home map (not navigating), tap any report pin. A dark card slides down from the top:
   type, live distance ("Here" under 20 m), road + suburb, the note in quotes if it has one,
   "N min ago by anonymous", a big round icon, and a blue thumbs-up with a count.
2. The map dims everywhere except a soft circle on the pin, and the camera glides to the pin
   without zooming.
3. Close it three ways: tap the dimmed map; swipe the card up; leave it 8 seconds. Each time the
   camera returns to where it was.
4. Tap the card itself: the full details sheet opens (delete / hide / still here), as before.
5. Thumbs-up on someone else's report: the count goes up by one; tap again, nothing happens.
   On your own report the pill is grey.
6. Drive somewhere with a Live Traffic NSW incident and tap it: the card says
   "by Live Traffic NSW" with Transport for NSW's place and advice; no thumbs-up.
7. Start navigation and tap a pin: a smaller card appears under the instruction card (never over
   it or the lane arrows), no dimming, the map keeps following you.

## 18. Trackys between two accounts — NEEDS DEVICE TEST

Needs the Firebase deploy run first (functions + rules; `MAPBOX_SERVER_TOKEN` as a GitHub secret).
Two phones (or a phone and a friend's), two different accounts, both with Ghost mode off.

1. Phone A: Settings › Visibility = Everyone. Drive (over 15 km/h) for a minute.
2. Phone B, within a few km: A's Tracky appears on the map, moving along the road, with A's
   chosen mood/look. Tap it: the card shows the name only if A allowed names.
3. Phone A: turn on Ghost mode. Within a minute A's Tracky disappears from B.
4. Phone A: stop for a while (under 15 km/h). A's Tracky disappears from B.
5. Swap roles and repeat.

## 19. Brand badges on the map — NEEDS DEVICE TEST

1. Zoom to street level in a shopping area. At zoom 13+ fuel stations and hospitals show as small
   square badges with a pointer (fuel pump / "H"); at 15+ supermarkets, cafés, fast food, shops
   and parking appear too, each with its name beside it.
2. They never overlap each other; zoom in to see more.
3. No brand logos: only our own icons.
4. Tap a badge: that place's page opens.

## 20. Vehicle full check — NEEDS DEVICE TEST (after keys + products, PROVIDERS.md)

Signed in as the owner, on TestFlight (sandbox purchases work for the owner only).

1. Menu → Vehicle check. The owner panel lists each section `ready` / `BLOCKED: …`.
2. "See a sample report": the banner says Sample; every section shows green/amber/red.
3. Enter a plate and state (state pre-selected from where you are), or a 17-character VIN. A
   VIN with I, O or Q, or the wrong length, is refused before paying.
4. "Get full check — $19.99" → sandbox purchase → the sections fill in one by one → report.
5. Share / export PDF opens the share sheet with a PDF; PPSR certificate opens.
6. Buy again for the same car: "Open today's report", with no second charge.
7. Airplane mode right after paying, then reopen Vehicle check: the check continues by itself.
8. With your phone region set to New Zealand and location off: "Full check not available in
   your country yet".

## 21. Map orientation and turn directions — NEEDS DEVICE TEST

1. **Magnetic mount**: put the phone in a magnetic mount and drive. The map and arrow follow the
   road; they never swing when you bump the phone or drive past metal. (The phone-direction cone
   on the arrow is hidden while you're moving.)
2. **Stop at lights** for a minute: the map doesn't turn at all while stopped, and carries on the
   same way when you pull away.
3. **Roundabout**: drive one (AU: clockwise, exits to the left). The arrow and the turn icons go
   the right way round; the map follows the road through it without flipping.
4. **U-turn**: do a legal U-turn. The map turns round only once you're actually driving back
   (a few seconds), never from a GPS blip.
5. **Tunnel / app switch**: after a tunnel, or coming back to the app, the map keeps its direction
   until the next few fixes agree.
6. **North-up**: on the home map tap the compass: the map turns north and **stays** north while
   you drive. Tap again: back to heading-up.
7. **Arabic**: Settings > voice language Arabic (and the phone in Arabic if you like). Lane arrows
   keep their order (leftmost lane on the left), turn arrows point the right way, and the voice
   says the correct side ("انعطف يميناً" for a right turn).

## 22. Alert settings (Reports, Speedometer, Map shortcuts) — NEEDS DEVICE TEST

Settings › Map information & overlays.

1. **Reports**: every row has its own icon, a title, a grey line and a chevron. Open "Railway
   crossing": icon, explanation, "Data: OpenStreetMap", two switches. Open "Bus lane camera": it
   says "Coming soon in your area" and both switches are greyed out.
2. **Show on map**: near a mapped level crossing, switch Railway crossing › Show on map off — its
   pin goes; on — it comes back. Same for Police (with a police report nearby) and Roadwork (with a
   Live Traffic NSW roadwork nearby).
3. **Alert while driving**: drive towards a mapped red light camera / railway crossing at 50+ km/h.
   About 300-500 m before it, a chip with its icon appears and the voice says "Red light camera
   ahead" once. Switch that item's alert off and drive past again: no chip, no voice.
4. **Speed limit changes**: drive from a 60 into an 80 zone: after a few seconds the voice says
   "Speed limit 80". Off: nothing is said (the sign still changes).
5. **Speedometer**: Show speedometer off hides the dial. Speed limit › "When above the limit":
   the sign only appears while you're over. Pick "+10%": at 100 km/h the chime sounds from 110.
6. **Map shortcuts**: Sound button off removes the speaker button on the home map; Traffic flow
   off removes the coloured traffic (home map and route); Show Trackys off hides other drivers.
7. **Restart**: force-quit and reopen: every switch is as you left it. Signed in on a second
   phone: the same switches arrive there.

## 23. Report card: undo, anti-spam, Still there, saved places, Tracky bubble — NEEDS DEVICE TEST

Server parts need the Firebase deploy first (DEPLOY.md).

1. **Undo**: report Police. A dark bar "Police reported · 3" counts down with **Undo**. Tap Undo:
   "Report taken back" and nothing appears on the map. Report again and let it run out: the pin
   appears after 3 s. Undo a third time within an hour: "You can undo 2 reports an hour."
2. **Duplicate**: on a second phone, report Police within ~150 m of the first: "Police was already
   reported here -- you've confirmed it." No second pin.
3. **Limits**: send 4 reports inside 2 minutes: "Too many reports in a short time" (15 min pause).
   Move the pin more than 1 km from you and Set: "You can only report within 1 km".
4. **Still there?**: on the second phone drive towards a 10-minute-old police report: the card
   asks once, sits above the bottom bar while navigating, never appears during a turn close-up,
   and never on the phone that reported it. "Still here" keeps it longer; two "Not here" from two
   phones remove it.
5. **Saved places**: set Home and Work. They show as pins on the home map. Tap Home: Send (share
   sheet with a link), Routes (route preview), ••• → Preview location (map zooms there), Mark your
   parking spot (a P pin appears), Find my car (route to the P), Edit address (search opens to pick
   a new Home), Remove (pin goes). A saved place's ••• has Edit name.
6. **Tracky bubble**: tap another driver's Tracky: a small bubble (their name only if they show
   it, mood, "2 min ago"), Wave, More (the full card with Block / Report).

## 24. Every alert type live (no "Coming soon") — NEEDS DEVICE TEST

1. Settings › Map information & overlays › Reports: open every row. None says "Coming soon";
   every switch can be turned on and off; each shows "Sources: …" (e.g. "Sources: OSM · driver
   reports").
2. Tap the Report button: categories Police, Crash, Traffic, Camera, Hazard, Road feature,
   Emergency vehicle, Map chat, I need help, Speed limit / school zone. Camera opens 12 cameras,
   Road feature 12 features, each with its own icon.
3. Report a **Stop sign camera**: place the pin, Set, the Undo bar says "Stop sign camera
   reported". After 3 s a camera pin with the stop badge appears. Tap it: the card says "Stop sign
   camera" and "Source: TrackLine drivers · waiting for confirmation".
4. On two more phones, drive past and answer "Still here": after the third, the card says
   "confirmed, stays on the map". (Or, as the owner: Settings › … › Reports › Moderation queue ›
   Approve.)
5. Map chat: choose it, type up to 7 words, Set. Without words: "Add a few words for your map chat."
6. Lane ending: navigate a road where a lane drops (e.g. a 3-to-2 lane merge on a main road): a
   lane-ending pin on the route, and "Lane ends ahead" as you approach (with its switch on).
7. Crash history: near a spot with two or more recorded crashes (needs the Firebase deploy and a
   few days of Live Traffic NSW data), "Crash-prone area ahead" once as you approach.

## 25. Badge ranking — NEEDS DEVICE TEST

1. Zoom into a busy shopping street (zoom 15+): about a dozen badges at most, none on top of each
   other. Pan: they re-rank when the map settles.
2. Zoom out to 13-14: only fuel and hospitals.
3. Drive past a small café: within ~300 m it can get a badge it wouldn't have from further away.
4. After the deploy with `GOOGLE_PLACES_SERVER_KEY`: big, well-rated places win over small ones
   at the same spot; a place Google lists as closed has no badge.
5. Settings › Privacy › Share arrivals: off by default; turn on, navigate to a named place, arrive.

## 26. Transit timeline, ferry details, getting off — NEEDS DEVICE TEST

1. Plan Circular Quay → Manly, mode Transit (or Ferry). Tap **Trip details**: walk, then the Manly
   ferry from Circular Quay to Manly Wharf with times; "Pay with an Opal card…"; Ferry block with
   departures, ~20 min crossing, "Cars: no", **Tickets and timetable** opens transportnsw.info.
2. After the deploy with `TFNSW_API_KEY`: the ride says "Live · on time" or "Live · N min late".
3. Ride a bus or train with navigation on: near your stop, "Get off at the next stop: …" and one
   buzz.
4. Walk mode: the map turns with the phone. Bike mode: no camera / police alerts.

## 27. Account recovery, guests, messages, remote switches — NEEDS DEVICE TEST

Most of this needs the server deployed (BLOCKED.md #1); SMS needs Twilio (#5).

1. **Guest warning.** Fresh install, don't sign in. Settings > Account: says you're a guest and
   "If you delete the app or change phones, your saved places and settings will be lost unless
   you create an account." with a *Create account* button.
2. **Save prompt.** Still a guest, save a Home address: a "Create your account" card appears
   once. *Not now* closes it. (It won't come back for 3 days.)
3. **Linking keeps data.** Tap *Create account*, create an email account. Home is still
   saved, your Tracky look and settings unchanged. Delete and reinstall, sign in: Home is back.
4. **Forgot password (email).** Sign out. Sign in > *Forgot password?* > your email > *Send*.
   The message says "If an account exists…". Email arrives; set a new password; sign in.
   Try an address with no account: same message, no email.
5. **Can't sign in (assisted).** Sign in > *Can't sign in?* > *I can't use my email or phone* >
   answer the questions > enter a new email > enter the code from it > "Thanks…". The ticket
   shows in the dashboard's Support with a risk score.
6. **Help request.** Menu > Help > *Contact support in the app* > send. Reply from the
   dashboard: the reply shows in the request and as an Inbox message.
7. **Messages.** From the dashboard send a *banner* to yourself (Single user ID = your uid from
   Users): it shows on the home map; X dismisses it. Turn off Settings > Notifications >
   *Traffic advisories*, send a Traffic message: it does not arrive.
8. **Remote switches.** Dashboard > App control: untick *vehicleCheck* > Publish. Within seconds
   the menu's Vehicle check row disappears; tick it again and it comes back. Set Maintenance to
   *Banner* with a message: the banner shows. Set *Force update below* above your version: the
   app shows the Update screen (set it back after).

## 28. Phone number, Google and Apple sign-in — NEEDS DEVICE TEST

Needs BLOCKED.md #19 (Phone provider on + website deployed).

1. Sign out (Settings > Account). Sign in > **Continue with phone number** > your mobile >
   *Send code*. A browser sheet opens for a second and closes; an SMS with a 6-digit code arrives.
   Enter it: you're signed in, and Settings > Account shows your number straight away.
2. As a guest with Home saved, do step 1: Home is still saved (same account).
3. **Forgot password by phone** (an account with email + password and your phone): Sign in >
   *Forgot password?* > your mobile > code > new password. Sign in on another device with the old
   password: refused.
4. **Continue with Google** and **Continue with Apple** each sign in; Settings > Account updates
   at once.
5. Website: open it, logo > Account > *Account, help & inbox*: create an account, send a Help
   request, check Inbox.

## 29. Nav permanent fix: preview, route list, arrow, camera, controls — NEEDS DEVICE TEST

Drive it for real: **323 Stacey St, Bankstown → 40 Bazentin St, Belfield** (the same route the
simulation in `docs/nav-fix/` and `__tests__/nav/staceyToBazentin.test.ts` drives).

1. **Route preview.** Search 40 Bazentin St > the route screen: the map is flat (not tilted) and
   north-up. Every route line, your start dot and the chequered destination are all on screen,
   between the dark top card and the route sheet: none under either. Drag the sheet up and down:
   the map re-fits each time. Pick another route in the list: the map fits that one.
2. **Route list.** The sheet never covers more than about 60% of the screen. If there's a
   back-street way, it's listed and says **Side streets** under the time.
3. **Go now.** The camera eases over ~1 s into the driving view: tilted (45°), heading-up, your
   arrow about 70% of the way down the screen. Only ONE arrow (teal, white outline): no second
   Tracky or dot on top of you, no faint copy where you were.
4. **Route line.** One purple line with a dark edge, starting exactly at the tip of your arrow:
   no grey "already driven" line behind you, no gap and no stub.
5. **Speed.** Faster roads zoom out a little, slow streets zoom in. A turn more than ~45 m away
   shows the small purple callout only for the next turn.
6. **Controls.** Bottom-left: speed limit sign above the speedometer, a clear gap between.
   Bottom-right: yellow Report. Pan the map: Re-centre appears ABOVE Report (never over the
   speedometer); tap it to return. Nothing overlaps on your phone.
7. **Bottom bar.** Swipe it up (or tap the time): the dark trip sheet opens. Long-press it: asks
   to end navigation.
8. **End.** Stop in the trip sheet ends the drive: all sheets close, the map goes back to the
   normal home view, no route line left behind.

## 30. Street and back-lane shortcuts — NEEDS DEVICE TEST

1. During a drive in suburbs with traffic, within ~1.5 min a banner can appear: **Back-lane
   shortcut** / **Side-street shortcut** / **Faster route found**, "Save 3 min via Smith Ln —
   arrive 5:42 pm". The green line on the map is the shortcut. Yes switches to it; No or ✕ keeps
   your road. Nothing shows when no road really saves time (that's correct, not broken).
2. If traffic just ahead is slow, the title starts "Traffic ahead ·" and the voice says so.
3. The arrival time in the bottom bar follows the live time of the road you're actually on.

## 31. Driving sheets look like the driving UI — NEEDS DEVICE TEST

1. Tap the bottom bar's time: the trip sheet is dark. A row of round tiles: Share drive, Report,
   Add a stop, Dashcam, Map. Each does its job; Add a stop opens Search along route.
2. Search (magnifier on the bottom bar): dark sheet, pill search field and **Back**, round
   category tiles (Fuel, Food, Parking, Coffee, EV; the chosen one has a white ring), results with
   a coloured disc, "+3 min" in bold and the distance, and **Add stop**. Back returns to driving.
3. Yellow Report: dark sheet titled **Report**, big round icons in a 3-wide grid.

## 32. Dashcam vehicle detection (new tracker) — NEEDS DEVICE TEST

1. Menu > Dashcam (or the trip sheet's Dashcam tile) and point at traffic: boxes appear after
   about two frames, stay locked to each car as it moves (no lag behind a car pulling away), and
   don't blink off when a car is briefly faint or partly hidden.
2. Two cars crossing: each keeps its own box and number (no swapping).
3. A bus or truck reads further away than a car with the same-size box; a motorbike closer.

## 33. Ending a drive and the driving controls — NEEDS DEVICE TEST

1. While driving: compass top-left; audio, sound and voice buttons top-right; nothing overlaps
   the speedometer, Report or the bottom bar on your phone.
2. Tap the time on the bottom bar: option rows (Share drive, Add a stop, Report, Sound & voice,
   Map view, Dashcam, Avoid, Help), then **Stop** (asks to confirm) and **Continue**.
3. Say "stop navigation" after tapping the voice button: the drive ends.
4. Drive to the end: the arrival card (chequered flag) shows; Done (or 5 s) returns to the home
   map with the camera back on you. Every way of ending leaves no sheet or banner behind.

## 34. Plan a drive — NEEDS DEVICE TEST (and the Firebase deploy first)

1. Owner: run Actions > "Deploy Firebase" once. Until then saving can fail on the live app.
2. Menu > Plan a drive > pick a place. **From** is a segmented control (Here / Home / Work);
   days are short pills (Today, Tomorrow, Wed 25); **Arrive by / Leave at** is segmented.
3. No row of hour chips. The list starts at the next quarter hour (8 am on other days). **Jump to
   time** opens the phone's own time wheel; Done moves the list there. **Show later times** adds 8.
4. Each row is tall, with a coloured bar (green quickest, amber, red slowest of the shown times)
   and **Best time** on the quickest. The chosen row has a blue outline. Save shows "Drive saved".

## 35. Route preview — NEEDS DEVICE TEST

1. Pick a destination: the routes sheet starts small; all routes fit above it, flat, north up.
2. Pull the sheet up: it stops at about half the screen and the map re-fits so every route
   still shows. The time bubbles never sit on top of each other (try two near-identical routes).

## 36. Traffic lights, cameras and government hazards — NEEDS DEVICE TEST

1. Home map, zoom in to a few streets: speed / red-light cameras show as a purple camera sign
   (from suburb zoom); traffic lights as a small three-lamp light (only at street level).
2. Live Traffic NSW roadworks, crashes, floods, fires, closures show as a coloured warning
   triangle with a small "i". Tap one: the card shows the type, distance, where, the advice,
   what's happening, the delay and "Major incident" when the feed says so, and the source.
3. While driving, only the ones on your route ahead (1 km) show, with the alert chip.

## 37. Speed sign between close roads — NEEDS DEVICE TEST

Drive from a main road into a side street or slip lane next to it: the limit changes to the
new road's within a few seconds (it used to stick to the first road).

## 38. Nothing fake — NEEDS DEVICE TEST

1. Airplane mode, open Menu: upcoming events show "Couldn't read your calendar, try again" only
   if the calendar really can't be read; never "No upcoming events" for an error.
2. Every list that can't load says so and offers Try again; no spinner runs forever.

## 39. Siren radar — NEEDS DEVICE TEST

1. Settings › Vehicle & AI tools › Emergency vehicle radar: turn **Siren radar** on (it starts off).
   Read the footer: "Driver assistance only — always watch and listen for emergency vehicles yourself."
2. Parked (not navigating): play a siren video on another device near the phone. Nothing happens
   (it only listens while driving: over 10 km/h, 2 min after, or navigating).
3. Start navigating anywhere, stay parked, play the siren for ~5 s: the red/blue "Emergency vehicle
   nearby" banner appears at the top under the turn card, with the type ("Police", "Ambulance",
   "Fire truck" or "Emergency vehicle") and "Getting closer" / "Nearby" / "Moving away"; the voice
   says "Emergency vehicle nearby, make way when safe." Walk the playing device towards the phone:
   it should say "Getting closer". Any ahead banner steps aside while it shows.
4. Stop the siren: the banner goes ~8 s later and, as you're stopped, "Did you see an emergency
   vehicle or incident?" appears. Leave it: it goes after 10 s and nothing is posted.
5. Do 3-4 again and tap **Yes**: the report sheet opens with the pin where it was loudest. Try
   Ahead of me / Behind me / Where I heard it, pick a vehicle and "Passing through", add a title,
   tap Report: the 3 s Undo shows; the report is on the map and disappears after 15 minutes.
6. With "Hey TrackLine" on, answer the question by saying "no": it closes.
7. Music: play music loudly on the phone's speaker (no siren): no banner. While TrackLine speaks
   a direction, a siren isn't counted for that second.
8. Turn Siren radar off mid-drive: the microphone indicator (orange dot) goes away.

## 40. Live road view — NEEDS DEVICE TEST

1. Settings › Vehicle & AI tools › AI vehicle detection: turn **Live road view** on (it starts off).
2. Mount the phone upright on the dashboard, back camera facing the road. Start a drive.
3. A panel appears above the ETA bar: "Starting the camera…", then "Live view · N vehicles" with a
   3D road, your purple route line bending with the real route, your car in blue, and a small
   live camera thumbnail in the corner. The map's arrow sits above the panel; the speedometer and
   buttons are above it too.
4. Vehicles ahead appear as boxes (cars, trucks/buses bigger, motorbikes narrow) at about the
   right distance and side; one close ahead in your lane turns amber. When nothing's in front:
   "no vehicles in view" and an empty road — never made-up cars.
5. Deny camera access (Settings app) and start again: it says why and "Open settings" opens it.
6. Tap ✕: the view turns off (the setting goes off). Open AI vehicle detection while driving:
   the live view's camera pauses and comes back after.

## 41. Points & badges — NEEDS DEVICE TEST (and the Firebase deploy first)

1. Menu › Points & badges: your level, points, "N points to …", badges with progress.
2. Report something that goes live; a minute later the points go up (+5). Another account votes
   Still there on it: +3. The weekly board lists drivers with points this week.
3. Airplane mode, open it: "Couldn't load in 10 seconds…" with Try again.

## 42. Trip history — NEEDS DEVICE TEST

1. Drive a route (any length over 200 m), arrive. Menu › Trip history: the trip is listed with
   its distance, time, average and top speed and "Arrived". Stop one early: "Stopped early".
2. Totals switch between This week / This month / All time. Tap a trip → Delete → it's gone.
3. Settings › Privacy › Keep trip history off: the next drive isn't saved.

## 43. EV availability and driver fuel prices — NEEDS DEVICE TEST (prices need the Firebase deploy)

1. Petrol list › EV: charging sites show "N of M free · up to X kW" where the network reports it,
   otherwise "live availability not reported".
2. At a station (within 500 m), petrol list › your fuel: "Report E10 price at …" → type the sign's
   price → Send: "it shows once 3 drivers report the same price". From 3 accounts within 2 ¢, the
   station shows the price with "3 drivers" — only where there's no official price.

## 44. Web map editor — NEEDS THE ADMIN SITE + FIREBASE DEPLOY

1. Admin site › Map editor: pins for reports (red), fixed items (blue), needs approval (amber), map
   edits (purple) in the area on screen; zooming out too far asks to zoom in.
2. As a moderator, drag a pin a little: asked for a reason, then it stays there (and on phones).
   Dragging more than 2 km is refused. Click a pin: Approve / Remove. Audit log shows each change.

## 45. Permanent fix: one marker, camera control, route fit, nav facing the road, controls — NEEDS DEVICE TEST

1. **One marker.** Open the app outside: only the teal arrow. No blue dot or ball, before or after
   the first fix. Stand still: it's the same arrow, not a dot. Your own Tracky never appears on
   top of you.
2. **Pinch stays.** On the home map, pinch out to see the suburb. Wait a full minute (walk or drive
   a little if you can). The map must not zoom back in or move. Re-centre appears bottom-right,
   above the yellow Report.
3. **Re-centre.** Tap it: the map flies back to you at street zoom and follows again. The button goes.
4. **3D on.** Settings › Map view › 3D buildings on. The home map tilts once, to at most 45°. Pinch
   out: it stays out (it used to snap back to a close-up on every GPS fix). Buildings appear from
   street zoom, low and see-through. In dark mode they're slate, not white.
5. **Route preview.** Search a place → routes. Every route, the start and the destination are
   visible between the top card and the sheet. Pull the sheet up: it refits. Change the mode or
   Avoid: it refits. Walk around: it doesn't move. Pinch: it stays where you put it until you pick
   a route or change an option.
6. **Go now while parked.** The map turns to face the road you're about to drive, even before you
   move. It's tilted (45°), with the arrow about 70% down the screen and the purple line starting
   at the arrow. It's never north-up unless Settings › Map view › Keep map north up is on.
7. **Drag while driving.** Drag the map: Re-centre appears above Report. Keep driving over 10 km/h
   without touching it: after 15 s it follows again (Settings › Map view › Recentre automatically
   turns this off). Stopped at the lights, it doesn't snap back.
8. **Controls.** While driving with an ahead banner showing, nothing overlaps. The speed sign is
   above the speedometer (bottom-left), mic and sound are top-right, and Re-centre is above Report.
   On a small phone (SE) the mic/sound may step aside while the banner shows.
9. **Ad bar.** On the home map the ad fills the full width under the sheet. No black strips at
   its sides, in light or dark.

## 46. Map styles and clean satellite — NEEDS DEVICE TEST

1. **Themes.** Settings › Map display › Map theme: each tile is a real map picture (streets,
   water, a purple route), not colour blocks. Above the tiles there's a live map in the chosen
   theme, at your position. Pick each theme in turn. The tick moves, and going back to the map it
   has re-coloured in place. Start a route first: the route and the camera stay put while you
   change theme.
2. **Readable everywhere.** In every theme, main roads are thicker than streets, street names
   are bold with halos, suburb names are in mixed case, water is clearly water, and the purple
   route stands out from the roads.
3. **Dark map.** Settings › Map display › Dark map: On → the map and its buttons and sheets go
   dark at once. Off → back to your theme. Only at night → dark after sunset where you are.
   Same as phone → follows iPhone Settings › Display › Dark.
4. **Dark is clear.** Dark slate ground, lighter blue-grey roads, bright labels, and blue water you
   can tell from the land. Nothing near-black or murky.
5. **Satellite.** Home map: Satellite. The imagery is calmer (less saturated) with light road lines,
   white street names with dark halos, and shields. No grey tiles flash while panning. No raised
   buildings even with 3D buildings on.
6. **Satellite while driving.** Start a route → bottom bar › options › Satellite: On. The route
   stays bright purple with a white edge. The arrow, alerts and speed sign stay readable. Turn it
   Off again from the same row.
7. **Controls.** On every theme and on satellite, the round buttons, the yellow Report button,
   Re-centre, the speedometer and the bars all have a visible edge or shadow and never blend into
   the map.
8. **Overseas.** Search a place in London (or anywhere abroad): street and suburb names show and
   roads are drawn the same way.

## 47. Startup, "Trackys around you", private zones, arrow heading — NEEDS DEVICE TEST

1. **Start-up.** Close TrackLine fully and open it. While tiles load you see a soft grey grid (dark
   grid with the dark map), never white or black. The menu, compass, sound and Report buttons are
   already in their final places and don't move when the map appears. The map starts where you
   last were, then eases to your live position.
2. **Trackys around you.** A white pill with the Tracky icon shows above the sheet for 5 s:
   "A few Trackys around you", or a number rounded to 10. Tap it: the map zooms out. Leave the app
   for more than 10 minutes and come back: it shows again. (Needs the Firebase deploy, BLOCKED #27.
   Until then the pill doesn't show, rather than showing a made-up number.)
3. **Private zones.** With a second phone signed in to another account and visible: within 400 m
   of its saved Home, its Work, or where its trip started, it never appears on your map. Drive it
   away and it appears; it disappears again near its destination. Ghost mode hides it at once.
4. **Arrow when stopped.** Parked, turn on the spot holding the phone: the arrow turns smoothly
   with you (never faster than a quarter turn per second, no twitching), and ignores a quick jolt
   near a magnet or the car's metal. Drive off: above about 8 km/h it follows the road instead.
5. **Heading-up home map, arrow at ~72%.** On the home map the map turns with you. The arrow sits
   about three-quarters of the way down the screen with the street-name pill right under it, and
   the "Where to?" sheet shows just its search field (swipe up once for Home / Work / New).
   "N Trackys around you" appears in the street pill's place for 5 s. Settings › Map view › Keep
   map north up: the map stays north-up.

## 48. Route preview, route list, "What's your ride?" — NEEDS DEVICE TEST

1. **First open.** Delete and reinstall (or a new phone). After the location question,
   "What's your ride?" shows once: our car-and-motorbike picture, Private car · Motorcycle · Taxi,
   blue ✓ on Private car. Skip → Private car. It never shows again. Signed in on a second phone
   that already chose: it doesn't show there.
2. **Settings.** Settings › Navigation & voice › Driving preferences › Vehicle type: the same three,
   one ticked. Picking Taxi turns your map icon into the taxi, unless you'd picked your own icon.
3. **Route preview card.** Pick a destination: a white rounded card at the top with ‹, a grey box
   with "Your location" (blue ring) and the destination (red pin), and ⇅ on the right. Under it a
   white "Avoid ▾" pill with blue text and the vehicle pill ("Private car ▾").
4. **Clean map.** The map is flat and north-up with no 3D buildings. It shows no POI badges, no
   speed-bump or sign icons, no report dots and no other Trackys: only the routes, their time
   bubbles, your blue start dot and the checkered flag.
5. **Routes.** Selected route thick purple with a dark edge, others light lavender and thinner;
   tap one to select it. Bubbles: white "13 min", selected dark purple "12 min / Best"; never on
   top of each other.
6. **Sheet.** Collapsed: big time on the left, distance on the right, "Via <two main roads with
   their suburbs>" on one line, "Best route…" in grey, a thin line, then Leave later / Go now.
   Pull up: every route with time (selected in blue), distance, Via on up to 2 lines, the traffic
   line, separators; the selected row has a grey fill and a blue bar on the left. The map refits
   so every route stays visible in both positions.
7. **Vehicle pill.** Tap it: "Your vehicle" at the top of Getting there. Pick Motorcycle: routes
   reload as Motorbike. In Australia they're car routes labelled "Motorbike routes use car roads
   here" (Google has no motorcycle routing in AU). Pick Taxi: car routes with the note "Taxi and
   bus lanes aren't in our routing data yet…".
8. **No blue dots on home.** On the home map near a reported speed bump: a small grey icon on the
   road at street zoom, a tiny checker mark at mid zoom, nothing when zoomed out. Never a big
   blue dot.
9. **About.** Settings › About shows the build number and the commit.

## If something doesn't match this

This document describes the intended, real behavior as built and already verified at the
rules/Cloud-Function level (`TEST_RESULTS.md`). If a step above doesn't match what you actually
see on a real device, that's a genuine bug in the client-side wiring (`src/screens/MapScreen.tsx`,
`src/services/presence.ts`, `src/screens/PresenceCard.tsx`) that the emulator tests wouldn't have
caught, since they don't exercise the React Native UI at all — please report exactly which step
failed and what you saw instead.

## 49. Fix pass 5 — NEEDS DEVICE TEST

1. Route preview in Drive, Walk, Bike, Transit: every route, your start and the flag fit on screen with a margin (nothing off an edge, nothing under the top card); switch mode, change Avoid, tap another route, drag the sheet up — still all visible, just smaller when the sheet is up (build 221+: no more zooming into the middle).
2. Time bubbles sit beside their own route with a small tail, never on top of a line, each other, the flag, the top card or the sheet. Alternatives say "+1 min"; the selected one its time and "Best".
3. Your own Tracky never appears on the map (home, preview, driving).
4. Start driving: heading-up, tilted, your arrow about three-quarters down. Pan or rotate: "Re-centre" fades in bottom-left and the compass gets a blue ring; tap either → back in about half a second. Tap the compass when not ringed: "North up" / "Heading up".
5. Nothing overlaps in any state (also with an ahead banner up). There's no floating "Keep current route" pill; a faster route shows in the banner with Switch / Keep and is kept after 10 s.
6. The black instruction bar runs up behind the clock; status-bar text is white. At a roundabout: our roundabout picture with the exit number, in the bar, the directions list and on the map callout.
7. Directions list: no two rows the same, big icons, bold distance and street, grey detail, the current step highlighted, follows dark mode; closing it leaves the map where it was.
8. Options sheet never covers the instruction; it scrolls; headings in sentence case; the best-time chart has equal bars, labels on one line, "Best" above; with no signal: "Couldn't load traffic predictions — tap to retry".
9. Change Map view, Satellite, Sound & voice, Avoid, vehicle, alerts, units, dark mode: each takes effect at once, survives a restart, and appears on a second phone signed in to the same account.

## 50. Map look 2 — NEEDS DEVICE TEST

1. Home map at street level: gently tilted, your arrow on a soft grey disc you can spot at a glance.
2. Pinch out slowly: the map leans further (more perspective, the distance fading softly), then straightens to flat, top-down, around city / region level. Smooth, no jumps, no fighting your fingers.
3. Pinch back in: the same curve in reverse.
4. Two-finger tilt the map yourself: it stays as you left it while you zoom; tap Re-centre and the automatic lean comes back.
5. Settings › Map view › Flat: no automatic lean. While driving, previewing routes or placing a report: unchanged.
6. Zoomed out, the map is calmer: no grey building blocks until street level.


## 51. Motorways in their own colour — NEEDS DEVICE TEST

1. Home map around Sydney: every motorway (M1, M2, M4, M5, M7, M8...) is amber with a slightly darker edge; highways (A-roads) slate; streets light grey.
2. On / off ramps onto a motorway are the same amber, so you can see where the motorway starts.
3. Pinch right out (city / state view): the motorway network is still drawn as fine amber lines.
4. Dark mode: muted amber, not glaring. Satellite: bright amber over the imagery.
5. Green M-shields (yellow numbers) still sit on the motorways. Your purple route is still clearly on top when it uses a motorway.

## 52. Permissions one by one — NEEDS DEVICE TEST

Delete TrackLine first, then install the new build so every permission is asked fresh.

1. First open: **location** is asked first, on its own. Answer it.
2. Then, a moment later, **notifications** (if you're signed in), then **"Allow TrackLine to track your activity…"** last. Never two at once, never one flashing over another.
3. No ad appears over a prompt or straight after you answer one; an app-open ad (if any) only after all the prompts are done.
4. Start a drive and answer a prompt that appears then (e.g. notifications for the lock-screen turn card): the voice doesn't talk over the prompt; it says the instruction once you've answered.
5. Siren radar / Hey TrackLine / voice search / record your voice / add a photo / scan a plate: each asks once, on its own.
6. Close and reopen the app: no prompts again, and the map's location is there straight away.

## 53. Map camera height — NEEDS DEVICE TEST

1. Open the app / tap Re-centre: the map is closer than before (street level, street names big), still gently leaning.
2. Start a drive: the camera is higher and further back than before; at 50-80 km/h you see roughly the next 500 m of road ahead, on the motorway about 700 m.
3. Tell me if either should go further (closer / higher) — each is one number.
