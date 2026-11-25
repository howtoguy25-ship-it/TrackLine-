# Map look 2 — lean by zoom, cleaner map, grey disc under the arrow

Rendered by `scripts/map-look-2-proof.ts`: the app's real styles on real Mapbox tiles (headless
Chromium), one spot in Bankstown from street level out to the region view, each frame tilted by
the app's own curve (`src/map/tiltCurve.ts`). Map renders, not phone screenshots (no iOS simulator
on the Linux build machine). `filmstrip.png` shows all 8 zooms, light and dark.

| Zoom (app scale) | Tilt |
|---|---|
| 17 (street) | 44° |
| 16 | 50° |
| 15 | 56° |
| 14.5 | 58° (most lean) |
| 13.5 | 52° |
| 12.5 | 34° |
| 11.5 | 21° |
| 10.5 and out | 0° (straight down) |

- Live while you pinch (at most every 60 ms), settles in 0.45 s when the map comes to rest; never
  during the app's own camera moves; a two-finger tilt by hand turns it off until Re-centre.
- Home map only; off for the flat Map view, while driving, previewing routes or placing a report.
- Soft haze toward the horizon (style `fog`), building footprints only from street level, softer,
  no outline.
- Grey disc under your arrow (`USER_HALO`), lying flat on the map, a little bigger zoomed in.
