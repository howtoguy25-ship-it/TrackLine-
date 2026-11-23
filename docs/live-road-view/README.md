# Live road view

A Tesla-style view while you navigate, built from what your own phone's camera sees.
Toggle: **Settings › Vehicle & AI tools › AI vehicle detection › Live road view** (off by default).

| Part | Where | What it does |
|---|---|---|
| Camera | `components/LiveVehicleCamera.tsx` (loaded on demand by `LiveCameraSlot.tsx`) | Back camera, the same on-device SSD MobileNet model, sanity checks and trained box tracker as AI vehicle detection, 5 frames/s. Only tracked boxes leave the camera thread; nothing is recorded. 10 s model limit → "The vehicle model didn't load" + Try again. Paused when another screen is in front. |
| Scene | `nav/liveScene.ts` | Each tracked box → metres ahead (the tracker's smoothed pinhole distance, real width by kind) and metres left/right (box centre offset). Your route from your matched position, out ~100 m, turned into the car's frame. A chase-camera perspective. |
| Panel | `components/LiveRoadView.tsx` | 3D road (three lanes) following the route, the purple route line, your car, each vehicle as a box sized by kind (car, truck, bus, motorbike); close ahead in your lane = amber. Count line ("Live view · 2 vehicles" / "no vehicles in view"), ✕ turns it off, a live camera thumbnail. |
| Layout | `MapScreen.tsx` | Above the ETA bar (200-260 pt). The map's arrow stays at 70 % of the map above the panel (`navFollowPadding(h, reserved)`); bottom controls rise above it. |

Frames (`npx tsx scripts/live-road-view-frames.ts`, drawn with the same projection as the panel;
the three vehicles are an example of what three tracked camera boxes become):
`live-road-view-light.png`, `live-road-view-dark.png`.

Limits (honest): distance comes from one camera and an assumed vehicle width, so it's good to a few
metres, not centimetres; vehicles beside or behind you aren't seen (one forward camera); the road is
drawn three lanes wide because lane counts aren't known for every road.
