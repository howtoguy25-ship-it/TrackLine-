# Fix pass 7 — proof images

(Saved in `docs/fix-pass-6`, the folder the brief asked for.)

Drawn by `scripts/fix-pass-7-proof.ts`. The map is the app's real style on real Mapbox tiles in
headless Chromium. The data is real: OpenStreetMap sites and gates (Overpass, through the app's
own query and parser) and real routes (Mapbox Directions, live; the app asks Google's Routes API,
which needs the server key — same idea). The app's screens are drawn on top **from the app's own
code**: `routeExitGate`, `decideExit`, `exitAnswerPlan`, `exitReroute`, `exitCardPlacement`,
`stillLockStep`, `HeadingHold`, `smoothAlong`, `screenLayout`, `bannerSlotHeight`,
`navControlFrames`, `calloutSide` / `calloutAnchor`. They are drawings of the React Native screens,
not phone screenshots (there's no iOS simulator on the Linux build machine). Every image is
captioned "drawn". Measured values are in `shots.json`.

| Image | Shows | Measured |
|---|---|---|
| `1-exit-question.png` | Parked inside a real Wetherill Park warehouse lot (OSM `w888808353`, 5,732 m², 3 gates). The real route begins on Hassall Street, 40 m from gate `n8263376903`, so that's the exit. Stopped → "Is the exit on Hassall Street open?" with [Open] [Closed]. The card sits above the controls and the arrow | `decideExit` = ask |
| `2-exit-closed-reroute.png` | Tapped **Closed** → "Using another exit": the new real route starts at gate `n8263376905` (53 m from where it begins) and doesn't pass the closed gate | `exitAnswerPlan` = reroute; 6.84 km, 14 min |
| `3-arrow-still-60s.png` | Parked 60 s: 61 noisy GPS fixes (red, wandering up to 14.7 m, including speed spikes); the arrow doesn't move | arrow moved **0 m**, heading changed **0×** |
| `3b-arrow-still-vs-driving.png` | Parked vs driving at 50 km/h on the recorded route | driving: input 10.9 m → arrow **4.0 m** (95th percentile); lets go 2 s after pulling away |
| `4-home-phone.png`, `4-home-phone-landscape.png`, `4-home-ipad.png`, `4-home-ipad-landscape.png` | Home at zoom 16 (Mapbox 15), 45°. The motorway (M4) is slim, with a softer amber. Phone: sheet along the bottom. Landscape / iPad: a left panel, with the arrow centred in the visible map. Full-width ad slot that follows the ad's real height | motorway **11 px** incl. edge |
| `5-nav-following.png` | Driving: "St Hilliers Road" callout beside the right turn on its outside, with a tail to the corner. Route = one fill + one casing, no white stripe. No own Tracky | **0** control overlaps |
| `5-nav-free.png` | Panned: round Re-centre in the right column right above Report. No "End suggested route" pill (it's in the options sheet) | Re-centre 318,564 · Report 318,632 · **0** overlaps |

What the renders caught (all fixed in the app, with regression tests):

1. The arrow unlocked on one spurious speed reading → now needs two moving fixes 1 s apart.
2. The exit card covered the speed sign, Re-centre and the arrow → `exitCardPlacement`.
3. "Another exit" could be the other half of a double gate (20 m apart) → gates within 40 m count as one exit.
4. Routers snap a start inside a yard onto the street outside, so the route passed no gate and the app never asked → `routeExitGate`.
5. After Closed, a reroute from that snapped start could still leave through the closed gate → the new route starts at the other gate, and off-route rerouting waits until you're out of the site.

Re-run: `MAPBOX_TOKEN_FILE=<file with a pk. token> MAPBOX_GL_DIR=<dir with mapbox-gl> [OVERPASS_CACHE_DIR=<dir>] npx tsx scripts/fix-pass-7-proof.ts`.
