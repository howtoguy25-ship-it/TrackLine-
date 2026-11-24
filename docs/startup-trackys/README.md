# Startup, "Trackys around you", private zones, arrow heading

Rendered by `scripts/waze-match-proof.ts` with the app's real map style and real Mapbox tiles.
The app's screens on top are **HTML drawings** built from the app's own layout code, not phone
screenshots: there is no iOS simulator on the Linux build machine.

| Files | What it shows | Source of the numbers |
|---|---|---|
| `1-loading-grid-light.png`, `1-loading-grid-dark.png` → `2-loaded-light.png`, `2-loaded-dark.png` | The grid (our colours, `MAP_LOADING_GRID`) shows until the map draws its first frame. The controls sit at the same frames before and after, so nothing jumps | `homeControlFrames` for both states; `shots.json › frames-light.same` = **true**, `frames-dark.same` = **true** |
| `3-trackys-banner.png` | White pill above the sheet: Tracky icon + "40 Trackys around you" | The server's own counting code (`firebase/functions/trackysCore.js › trackysAround`) on 43 seeded users (37 active in the last 15 min, 6 stale). This is **not a production count**: production needs the functions deployed (BLOCKED #27). The same code passes end to end in the emulator (`firebase/tests/trackys.test.js`). |
| `4-arrow-still-t0000…t2400.png` (6 frames) | Standing still (0 km/h), phone turned 0° → 120° in 0.6 s with a 300° magnetic spike at 1.2 s. The arrow turns at most 90°/s, eases in and out, and ignores the spike. The chart shows compass in (grey) and arrow (blue) | `CompassFilter` + `HeadingTurret` + `targetHeading`, the same classes the app runs; samples in `shots.json › turret` |
| `5-trackys-moving-1…4.png` | Another driver on a real Mapbox route from their home to Lakemba: **hidden** at home (inside the 400 m zone), **shown** at the first point outside it, shown mid-drive, **hidden** on arrival (destination zone) | `trackysCore.privateZones` + `insideAnyZone`, the server's rule; `shots.json › zoneFrames` |

**Not shown as a picture:** "ghost hides instantly". It is covered by the emulator test
`firebase/tests/trackys.test.js` ("ghost mode hides instantly") and `src/map/presenceFilter.ts`.

**Home arrow position (honest note):** the spec asks for the arrow at ~72% of the screen with the
street pill under it. On a 390×844 phone the "Where to?" sheet's peek starts at 610 pt (72.3%), so
an arrow at 72% would sit behind the sheet with the pill under that. The app keeps the arrow
directly above the street pill instead: 61% on 390×844, 64% on 430×932, 50% on 375×667
(`homeArrowTargetY`). Moving it lower needs a smaller sheet peek. Say if you want that.
