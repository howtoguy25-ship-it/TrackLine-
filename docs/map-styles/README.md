# Map styles — every style, Sydney and London

**How these were made.** The machine is Linux, so there's no iOS simulator. Each frame is drawn by
Mapbox GL JS in headless Chromium, using:

- the app's own style generator (`src/map-v2/styles/buildStyle.ts`, the same one the phone uses);
- real Mapbox tiles;
- the app's own arrow image;
- each style's own route colours on a real Mapbox Directions route.

`npx tsx scripts/map-styles-screenshots.ts` regenerates them. "Normal" in Settings is TrackLine
Light (same palette), so it isn't drawn twice.

The **contrast rules** each theme passes (road vs land, water vs land, labels vs halo/land, route vs
roads/land) are in `src/map-v2/styles/styleContrast.ts` and checked in
`__tests__/map/styleContrast.test.ts`. That test also proves every theme has exactly the same
layout (only colours differ) and keeps a colour snapshot of every style.

| Style | City | Frames (z11 · z14 · z17 · driving) | Arrow height when driving (target 0.70) |
|---|---|---|---|
| TrackLine Light | Sydney | [z11](light-sydney-z11.jpg) · [z14](light-sydney-z14.jpg) · [z17](light-sydney-z17.jpg) · [driving](light-sydney-nav.jpg) | 0.7 |
| TrackLine Light | London | [z11](light-london-z11.jpg) · [z14](light-london-z14.jpg) · [z17](light-london-z17.jpg) · [driving](light-london-nav.jpg) | 0.7 |
| TrackLine Dark | Sydney | [z11](dark-sydney-z11.jpg) · [z14](dark-sydney-z14.jpg) · [z17](dark-sydney-z17.jpg) · [driving](dark-sydney-nav.jpg) | 0.7 |
| TrackLine Dark | London | [z11](dark-london-z11.jpg) · [z14](dark-london-z14.jpg) · [z17](dark-london-z17.jpg) · [driving](dark-london-nav.jpg) | 0.7 |
| Purple & Blue | Sydney | [z11](purpleBlue-sydney-z11.jpg) · [z14](purpleBlue-sydney-z14.jpg) · [z17](purpleBlue-sydney-z17.jpg) · [driving](purpleBlue-sydney-nav.jpg) | 0.7 |
| Purple & Blue | London | [z11](purpleBlue-london-z11.jpg) · [z14](purpleBlue-london-z14.jpg) · [z17](purpleBlue-london-z17.jpg) · [driving](purpleBlue-london-nav.jpg) | 0.7 |
| Blue & Grey | Sydney | [z11](blueGrey-sydney-z11.jpg) · [z14](blueGrey-sydney-z14.jpg) · [z17](blueGrey-sydney-z17.jpg) · [driving](blueGrey-sydney-nav.jpg) | 0.7 |
| Blue & Grey | London | [z11](blueGrey-london-z11.jpg) · [z14](blueGrey-london-z14.jpg) · [z17](blueGrey-london-z17.jpg) · [driving](blueGrey-london-nav.jpg) | 0.7 |
| Green & Yellow | Sydney | [z11](greenYellow-sydney-z11.jpg) · [z14](greenYellow-sydney-z14.jpg) · [z17](greenYellow-sydney-z17.jpg) · [driving](greenYellow-sydney-nav.jpg) | 0.7 |
| Green & Yellow | London | [z11](greenYellow-london-z11.jpg) · [z14](greenYellow-london-z14.jpg) · [z17](greenYellow-london-z17.jpg) · [driving](greenYellow-london-nav.jpg) | 0.7 |
| Blue | Sydney | [z11](blue-sydney-z11.jpg) · [z14](blue-sydney-z14.jpg) · [z17](blue-sydney-z17.jpg) · [driving](blue-sydney-nav.jpg) | 0.7 |
| Blue | London | [z11](blue-london-z11.jpg) · [z14](blue-london-z14.jpg) · [z17](blue-london-z17.jpg) · [driving](blue-london-nav.jpg) | 0.7 |
| TrackLine Satellite Streets | Sydney | [z11](satellite-sydney-z11.jpg) · [z14](satellite-sydney-z14.jpg) · [z17](satellite-sydney-z17.jpg) · [driving](satellite-sydney-nav.jpg) | 0.7 |
| TrackLine Satellite Streets | London | [z11](satellite-london-z11.jpg) · [z14](satellite-london-z14.jpg) · [z17](satellite-london-z17.jpg) · [driving](satellite-london-nav.jpg) | 0.7 |

Satellite: the imagery is softened (`raster-saturation -0.35`, `raster-contrast -0.12`, brightness
lift) and fades in over a neutral ground. Roads are light semi-transparent lines, with a thin dark
casing on main roads only. Labels are white on dark halos, the route is vivid purple with a white
casing, and there are no 3D buildings.

The theme picker tiles in Settings come from `scripts/build-theme-previews.ts` (Sydney CBD,
z14) → `assets/map/theme-previews/*.jpg`.
