# §0 line-by-line: MAP POLISH and the two PERMANENT FIX prompts against the code

Each line of the three earlier prompts, checked against `claude/go-session-0d5bup` on 2026-11-24.
**Wired** = used by the live screen (`MapScreen` / `TrackLineMap` / `MapboxLayers`), not just a
helper. "Needs phone" = in code and tested, but only a TestFlight run proves the look.

## Why build 217 still showed big blue speed-bump dots

OSM speed bumps already followed the small-icon rule. The big blue dots were **driver-reported**
road features (speed bump, crossing, curve, roadworks from the Reports pipeline). They went through
the alert-pin path, which drew a 24 pt coloured badge up close and a far "dot" at low zoom. Fixed in
one place: `roadFeatureReportIcon(item, zoom)` (`src/map/roadSignVisibility.ts`). Reported road
features now use the same icon / checker / hidden states as OSM ones, and never a far dot.
Test: `__tests__/wazeMatch/noFeatureDots.test.ts`. The fix needs the new build: the last OTA update
targets runtime 1.2.0 and the app is 1.3.0, so no update could reach build 217.

## MAP POLISH

| Line | Status | Where |
|---|---|---|
| Light: near-white land, light grey roads, white casing, main roads thicker, motorways darker | Wired | `src/map-v2/styles/buildStyle.ts` (light palette); `__tests__/map/styleContrast.test.ts` |
| Water #9EDBFA range, soft green parks, flat light buildings (no 3D unless on) | Wired | same; `show3DBuildings` default false |
| Suburbs #4F6F8A mixed case, semi-bold, white halo; street names darker/larger | Wired | `buildStyle.ts`; `__tests__/mapV2.test.ts` (mixed case) |
| Green shields with yellow text (AU), other countries their own | Wired | `buildStyle.ts › shieldTextExpression`; `__tests__/map/styleValid.test.ts` |
| Dark mode slate, readable | Wired | dark palette; contrast rules |
| Fewer labels, no overlaps, POI labels at street zoom only | Wired | style symbol priorities / minzoom |
| Zoom states: close full pin, mid 60% + clusters with count, far coloured dot (max ~60) | Wired | `src/map/zoomStates.ts`, `src/map-v2/pins.ts`; `__tests__/map/zoomStates.test.tsx` |
| Tap cluster zooms in; tap item opens card | Wired | `MapScreen › onMapboxPinPress` |
| Same rules for Live Traffic NSW (+ "i" badge) | Wired | `pins.ts` |
| **Remove the blue dot layer completely** | **Fixed now** (reported road features were the remaining dots) | `roadFeatureReportIcon`; `noFeatureDots.test.ts` |
| Speed bump: z ≥ 16 icon ~18 pt, z 14–16 checker 6–8 pt, < 14 hidden | Wired (OSM + reported) | `roadSignVisibility.ts` |
| Never large circles, never on top of report pins/labels | Wired | sign priority 3–6 < alert 20–31 |
| On-route features trigger "ahead" banners | Wired | `src/nav/ahead/` |
| Live traffic thin coloured lines on congested roads only | Wired | `trafficStretches` + Mapbox congestion |
| Recentre round dark button, only after panning, not over the speedometer | Wired | `homeControlFrames` / `navControlFrames`; `__tests__/map/controlsLayout.test.ts` |
| Screenshots z11–z17 light/dark | Done earlier | `docs/map-polish` |

## PERMANENT FIX (route preview, list, arrow, nav camera, nav controls)

| Line | Status | Where |
|---|---|---|
| Fit all routes + start + destination, 600 ms, on every reload / mode / Avoid change | Wired | `previewCamera.ts` (`PREVIEW_FIT_MS`), `MapScreen` previewFit effect |
| Padding from measured top card + pills + 24, sheet + 24, sides 32; recompute on size change | Wired | `previewEdgePadding`; effect deps `routeTopCardBottom`, `routeSheetHeight` |
| Pitch 0, north-up, no 3D in preview | Wired | `PREVIEW_PITCH`; `show3DBuildings && !inRouteSelection` |
| Selected thick purple + dark casing on top; alternatives lavender, thinner, tappable | Wired | `MapboxLayers` route layers |
| Time bubbles on every route, never overlapping | Wired; **tightened now**: placement uses each bubble's real size (the selected one is 60 tall) | `screenBubbleAnchors(…, sizes)`; `routeSheet.test.tsx` |
| Start marker + checkered flag | Wired | `StartDot`, `CheckeredFlagPin` |
| Sheet collapsed / half; map keeps ≥ 40% | Wired | `MAX_SHEET_FRACTION = 0.55` |
| Refit when sheet changes height; row tap selects, highlights, refits | Wired | `cameraOwnership.test.ts`; `routeSheet.test.tsx` |
| Selected row fill + blue bar + blue time; separators; "Add a stop" | Wired | `RouteSelectionSheet` |
| Arrow replaces the dot everywhere; no flat cone | Wired | `UserArrow.tsx`; `oneUserMarker.test.tsx` |
| Own Tracky never drawn | Wired | `presenceFilter.ts` (`me`) |
| Single purple line, one casing, starts at the arrow, travelled part hidden | Wired | `navArrowLine.test.tsx` |
| Go now → 1.2 s to follow, pitch 45, zoom by speed, heading-up, arrow ~70% | Wired | `navCamera.ts`; `navCamera.test.ts` |
| Buildings flat in nav unless 3D on, then low/translucent | Wired | `buildingExtrusionPaint` |
| Nav controls: speed sign over speedometer, recentre bottom-right, report, sound; no overlaps 320–430 | Wired | `navControlFrames`; `navControls.test.tsx` |
| Bottom bar Search · ETA · Routes; ETA sheet with red End | Wired | `NavOptionsSheet`, `exitNavigation` |
| Search along route (detour sort, +min, Add stop, 10 s timeout) | Wired | `SearchAlongRouteSheet.tsx`; `__tests__/presses/search.test.tsx` |
| "Stuck search" root cause + test | Done earlier | `__tests__/presses/pressableScale.test.tsx` (the stuck-touch root cause) |

## PERMANENT FIX §1–§7 (marker, camera, fit, nav orientation, 3D, buttons)

| Line | Status | Where |
|---|---|---|
| Only UserArrow draws the user; no puck / showsUserLocation; same arrow without heading | Wired + lint-enforced | `eslint.config.js`; `oneUserMarker.test.tsx` |
| 60 fps, stale/out-of-order fixes dropped | Wired | `userMotion.ts` |
| FOLLOW / FREE / ROUTE_PREVIEW / OVERVIEW / NAV_FOLLOW; gesture → FREE; only Recentre/start/end leave it | Wired | `cameraController.ts`; `cameraController.test.ts` |
| All camera calls through the controller (lint) | Wired | `CAMERA_OWNERS`; `cameraOwnership.test.ts` |
| Nav auto-recentre 15 s untouched, > 10 km/h, nav only, setting on | Wired | `shouldAutoRecentre` |
| Preview: refit on select/mode/Avoid/sheet height; never on location updates | Wired | ROUTE_PREVIEW refuses follow moves |
| Nav bearing = matched segment (first segment before moving), pitch 45, arrow 70%, north-up only by setting | Wired | `navStartBearing`, `navCameraBearing` |
| Recentre above Report bottom-right, 12 pt; speed sign above speedometer; mic+sound top right; banner never overlaps | Wired | `controlsLayout.test.ts` |
| Flat footprints by theme; 3D capped 40%, fade from z16, translucent near route; pitch ≤ 45 | Wired | `buildingExtrusionPaint`; `mapV2.test.ts` |
| Ad banner full width, no black bars | Wired | `BannerAdBar` (inline adaptive) |
| Build stamp (commit) in Settings › About | Wired | `formatBuildStamp`; `noFeatureDots.test.ts` checks the About line carries the commit |

## Left honestly as not done

- ~~Home arrow at ~72%~~ **Done:** fixed 81 pt sheet peek, 44 pt pill, arrow at 71.2% on 390×844
  (`__tests__/wazeMatch/homeArrow.test.ts`, `home-map.png`).
- **Simulator recordings.** Linux build machine, no iOS simulator (BLOCKED #28). Frames are
  rendered from real tiles and the app's own code instead.
