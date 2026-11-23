# Permanent fix — proof frames

**How these were made:** the build machine is Linux, so there's no iOS simulator to record. The
frames come from headless Chromium running Mapbox GL JS. That setup uses:

- the app's own map styles (`src/map-v2/styles/trackline-{light,dark}.json`) with real Mapbox tiles;
- the app's own arrow image (`assets/map/user-arrow@3x.png`);
- real driving routes from the Mapbox Directions API (Stacey St, Bankstown → Burwood);
- the camera driven by the app's own code: `CameraController`, `navStartBearing`, `navFollowPadding`,
  `previewEdgePadding`, `homeMapPadding`;
- controls drawn at the frames the app's own layout functions compute (`homeControlFrames`,
  `navControlFrames`).

The buttons are drawn to match, not screenshotted from the app. Every number below is measured
from the rendered map (`map.project`) and saved in `shots.json`. Regenerate with:
`MAPBOX_TOKEN_FILE=… MAPBOX_GL_DIR=… npx tsx scripts/permanent-fix-proof.ts`.

A phone test is still needed (TEST_ON_PHONE.md §45).

| Frame | What it shows | Measured |
|---|---|---|
| `home-light.png`, `home-dark.png` | Home map in FOLLOW: our arrow only (no blue dot), heading-up, pitch 45. The ad bar is full width under the sheet. | pitch 45, zoom 16 (Mapbox), arrow at 0.607 of the height |
| `pinch-out-t00s…t60s.png`, `pinch-out-then-recentre.mp4` | A pinch-out to zoom 13 on the home map. Then 60 s of GPS fixes and 3D-tilt requests go through the real `CameraController`: the zoom stays put while the arrow drives off. Re-centre is above Report. | `cameraMovesAllowedIn60s: 0`, zoom still 13 after 60 s |
| `recentre-after.png` | Tapping Re-centre: back to FOLLOW at street zoom. The button is gone. | mode FOLLOW, zoom 17 (app scale) |
| `route-preview-collapsed.png`, `route-preview-pulled-up.png` | ROUTE_PREVIEW: flat, north-up, both routes with time bubbles. The fit uses the measured top card + 24 and the sheet height + 24. | every route point, the start and the destination are inside the free area at **both** sheet heights (`inside: true`) |
| `nav-facing-road-light.png`, `nav-facing-road-dark.png` | Go now while still parked. The map already faces the road: the bearing comes from the route's first segment, not the parked GPS/compass. The route starts at the arrow. | bearing 265° = first segment; pitch 45; arrow at **0.700** of the height |
| `controls-banner.png`, `controls-banner-recentre.png` | Driving with the ahead banner down, then FREE with Re-centre showing. Re-centre is above the yellow Report, the speed sign above the speedometer, mic + sound top-right. | `overlaps: []` both times |
| `home-recentre-free.png` | Home map in FREE (dark) with the banner showing. Re-centre is above Report, and nothing overlaps. | — |

The overlap and fit checks also run as tests on 320 / 375 / 390 / 430 pt widths:
`__tests__/map/controlsLayout.test.ts`, `__tests__/map/cameraOwnership.test.ts`,
`__tests__/nav/previewCamera.test.ts`.
