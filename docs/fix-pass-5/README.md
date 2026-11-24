# Fix pass 5 — proof images

Drawn by `scripts/fix-pass-5-proof.ts`: the app's real map style on real Mapbox tiles (headless
Chromium), real routes (Mapbox Directions, live) and the recorded route the tests use
(`recorded-route.json`, parsed from `__tests__/fixtures/travel/bankstown-parramatta.json`), with the
app's screens drawn on top **from the app's own maths** (fit, bubble solver, nav camera, control
frames, roundabout drawing, directions rows, sheet heights, chart bars). They are drawings of the
React Native screens, not phone screenshots: there is no iOS simulator on the Linux build machine.
Every image is captioned "drawn". Measured values are in `shots.json`.

| Image | Shows |
|---|---|
| `1-preview-drive/walk/bike.png` | Every route + start + flag fitted inside the map area (`inside: true` measured), bubbles placed by `layoutRouteBubbles` beside their own line with tails |
| `2-bubbles-sheet-half.png` | Same with the sheet at 460 pt: bubbles still clear of lines, each other, the flag, the start and the sheet |
| `3-nav-default-view.png` | Heading-up, 45°, arrow at 72% (measured 0.72), 60 km/h → ~410 m ahead |
| `4-nav-free-recentre-hint.png` | FREE: Re-centre pill bottom-left, compass ringed blue |
| `4b-nav-compass-toast.png` | Compass tap while following → north-up with a "North up" toast |
| `5-controls-all-states.png` | `navControlFrames` on 320/375/390/430 × following / FREE / FREE + banner — 0 overlaps everywhere |
| `6-roundabout-icon.png` | Our roundabout (clockwise, exit arm highlighted, exit number) for exits 1–4, and the real recorded step in the bar, the list and the callout |
| `7-directions-list-light/dark.png` | 23 route steps → 22 rows, big icon / bold distance / bold street / grey detail, current row highlighted |
| `8-options-sheet-half/full-light/dark.png` | Half 380 pt, full 585 pt = screen − bar − 120 (120 pt clear under the bar); best-time chart with equal bars, one-line labels, Best tag |

The chart values in the images are real predictions for those departure times from Mapbox
`driving-traffic` (the app asks Google's Routes API, which needs the server key; same shape of data).

Re-run: `MAPBOX_TOKEN_FILE=<file with a pk. token> MAPBOX_GL_DIR=<dir with mapbox-gl> npx tsx scripts/fix-pass-5-proof.ts`.
