# Mapbox Engine Switch — DONE on branch `mapbox-map` (see AUDIT.md §11)

> Superseded: the switch was built as a new map in `src/map-v2/` and react-native-maps removed.
> The plan below is kept for history.

## Original plan

**Status: BLOCKED/deferred, by explicit decision (see AUDIT.md section 2 and NOTES.md's
matching Phase 1B entry).** `@rnmapbox/maps` is installed, both real Mapbox tokens are live as
EAS env vars, and the native module is confirmed to compile on both platforms (real EAS build
logs) — but it is wired up only in an isolated, owner-only preview screen
(`MapboxMapScreen.tsx`), never in the live home/navigation map. This document is the real,
evidence-based plan for actually finishing that switch later, as its own dedicated branch with
device testing alongside it — not a decision to do it now.

## Why this is its own project, not a quick follow-up

`src/screens/MapScreen.tsx` is **6,042 lines**, and every one of the following is built directly
against `react-native-maps`' specific API shape, confirmed by direct count against the file as
it stands today:

| react-native-maps API | Count in MapScreen.tsx |
|---|---|
| `<Marker>` | 20 |
| `animateCamera` calls | 21 |
| `onRegionChangeComplete` | 14 |
| `fitToCoordinates` | 8 |
| `<Polyline>` | 8 |
| `animateToRegion` | 6 |
| `<Circle>` | 2 |
| `PROVIDER_GOOGLE` | 3 |
| `<MapView>` | 2 |

`@rnmapbox/maps` has a **structurally different** API for nearly every one of these — this is
not a prop rename exercise. The table below maps each real feature currently shipped to its
real Mapbox equivalent, with an honest effort/risk read on each.

## Feature-by-feature port plan

| Feature (current, react-native-maps) | Real Mapbox equivalent | Effort | Risk |
|---|---|---|---|
| `<MapView provider={PROVIDER_GOOGLE} customMapStyle={...}>` (theme JSON recoloring — `mapStyle.ts`, 7 themes incl. the new light/dark pair) | `<MapView styleURL={...}>` pointed at a real Mapbox Studio style, OR a Mapbox GL style-spec JSON (different spec from Google's style JSON — colors/road classes don't map 1:1) | **High** — every one of the 7 themes needs re-authoring against Mapbox's own vector tile schema (`road-simple`/`road-label`/`building`/`water` layer names, not Google's `featureType`/`elementType` pairs). `src/map/styles/trackline-light.json`/`trackline-dark.json` already exist as a first pass per NOTES.md's Phase 1B entry, but 5 more themes still need the same treatment. | Visual regression risk is high — a style ported wrong doesn't error, it just looks subtly different, hard to catch without a real device next to the old build. |
| Live position marker (`CarNavArrow`/`PersonLocationDot`, `<Marker flat rotation={heading}>`) | `<PointAnnotation>` + `<Camera heading={...}>`, or a `<ShapeSource>` with an icon layer | Medium | `flat` (billboard-vs-ground-plane rotation) has a different mental model in Mapbox GL (`icon-rotation-alignment: 'map'`) — needs real on-device verification that the arrow rotates with heading, not the camera. |
| Destination/origin pins, turn callouts, traffic-light/speed-camera/fuel/food/hotel/parking markers (20 total `<Marker>` instances) | `<PointAnnotation>` per marker, or (better, for the clustered viewport layers) a single `<ShapeSource>` + `<SymbolLayer>` fed a GeoJSON FeatureCollection | **High** — `PointAnnotation` has known perf ceilings around ~100 markers; the existing custom clustering logic for fuel/restaurant/hotel pins would need rewriting against `<ShapeSource cluster>`'s own built-in clustering instead, a different algorithm, not a port. |
| Route line + alt-route ghosts + stop-preview line (8 `<Polyline>`) | `<ShapeSource>` (LineString) + `<LineLayer>` | Medium | Casing/color/width-by-zoom (`lineWidth` as a zoom-expression, not fixed `strokeWidth`) is a real rewrite of the two-polyline casing trick already in use (line 3633 area), not a 1:1 prop swap. |
| Destination halo, GPS accuracy circle (2 `<Circle>`) | `<ShapeSource>` (Point) + `<CircleLayer>`, radius as a real meter-to-pixel zoom expression | Low | Mapbox's `circle-radius` is in pixels, not meters — needs a zoom-level expression to fake a geo-accurate radius (Google's `<Circle radius>` is natively in meters). |
| Chase-cam / overview / exit-zoom / speed-based auto-zoom (21 `animateCamera` calls, all this session's new work) | `<Camera ref>` imperative `camera.setCamera({...})`, or `cameraRef.current.flyTo(...)` | **High** — pitch/heading/zoom/center are set together in every one of these 21 call sites; Mapbox's `Camera` component has a different default animation curve and a different "already mid-animation, new setCamera interrupts how" behavior, which this app's rapid-fire GPS-tick camera updates lean on. Needs real device testing per call site, not just a compile check. |
| `fitToCoordinates` (route preview framing, 8 call sites) | `cameraRef.current.fitBounds(ne, sw, padding, duration)` | Medium | Mapbox's `fitBounds` takes a bounding box, not an arbitrary coordinate array — the padding/edge-inset semantics differ from Google's `edgePadding`. |
| `onRegionChangeComplete` + `isGesture` (manual-pan/pinch/rotate detection that drops `followTilt`, 14 sites feeding into one real gesture-detection pattern) | `onCameraChanged` (`gestures.isGestureActive`) / `onMapIdle` | Medium | Mapbox's gesture-vs-programmatic distinction is reported differently (`properties.isUserInteraction` on `onCameraChanged`) — the exact "manual gesture wins" architecture this whole file is built around needs re-verifying against real device gesture events, not assumed equivalent. |
| `onPoiClick` (tap a native Google POI icon to see its info) | **No equivalent.** Mapbox's vector tiles don't expose clickable native POI features the way Google Maps' baked-in business layer does. | N/A | Real feature loss, not a port — `onMapPoiClick`'s whole flow (tap a gas station icon baked into Google's map tiles itself, not one of this app's own `<Marker>`s) has no Mapbox equivalent and needs an honest "removed" note. |
| `showsTraffic` (native live traffic coloring) | Requires a separate Mapbox traffic-v1 tileset + a dedicated `<VectorSource>`/`<LineLayer>` styled by congestion, not a boolean prop | **High** | Not a toggle — a real additional data source + style layer to build from scratch. |
| `mapType="hybrid"` (satellite toggle) | `styleURL={MapboxGL.StyleURL.Satellite}` or a dedicated satellite style | Low | Straightforward swap once a Mapbox satellite style is chosen. |
| 3D buildings (Google's native extrusion layer, toggled by pitch/zoom only — no separate API) | `<FillExtrusionLayer>` against Mapbox's `building` layer `height`/`min_height` fields | Medium | NOTES.md's Phase 1B entry already flags this exact gap in the existing trial style JSON (flat + extrusion layers both present, runtime pitch-based swap not yet wired) — this work is partially started. |
| Viewport-based marker fetch/clustering (fuel/restaurant/hotel pins loaded per visible map bounds) | `onCameraChanged`/`onMapIdle` for the bounds-changed trigger, feeding the same existing `fetchOsmPlacesInBounds` — the OSM data layer itself is unaffected, only the "what's the current visible bbox" trigger changes | Low | This part is genuinely low-risk — the data/business logic doesn't change, only which map event supplies the bounding box. |

## Phased plan (once undertaken)

1. **Spike branch, not the real branch yet.** Build one throwaway screen that does ONLY: base
   `<MapView>` + one theme style + the live position marker + one static route line + camera
   `setCamera`. Get that running on a real device/simulator before touching `MapScreen.tsx` at
   all — this answers the biggest open unknowns (gesture detection semantics, camera animation
   feel) cheaply.
2. **Port the 7 map themes** to real Mapbox style JSON/Studio styles, verified against a live
   Mapbox Studio preview or real device — this is pure data work, parallelizable, no screen
   logic risk.
3. **Port markers + polylines + circles** inside a feature-flagged duplicate screen
   (`MapScreenMapbox.tsx`), kept side-by-side with the real `MapScreen.tsx` the whole time so the
   app never ships broken — exactly the "side-by-side, swap in once verified" approach already
   used for the Waze-style UI work this session, just applied to the engine itself.
4. **Port camera control** (chase-cam/overview/exit-zoom/speed-zoom/recenter) — the highest-risk
   single piece, needs its own real-device pass per pose (idle, following, overview, exit-zoom,
   each speed band), compared turn-by-turn against the live `MapScreen.tsx`'s current behavior.
5. **Decide on `onPoiClick` and `showsTraffic`** — both need an explicit product call (accept the
   loss / find a different data source), not an engineering fix, before the branch can call
   itself feature-complete.
6. **Side-by-side device QA** — the full driving-test checklist (re-centre, overview, auto-zoom,
   turn callouts, markers, alert placement, 3D buildings, traffic) run on both screens back to
   back on a real phone, not just a simulator, before ever touching the live `MapScreen.tsx`
   route registration.
7. **Cut over** — swap the navigator route only once step 6 passes clean, keep the old screen
   available behind a quick revert path for one release cycle.

## Rough total effort

Given the "High" effort items above (theme ports ×6 remaining, camera control ×21 call sites,
marker/clustering rewrite, traffic layer from scratch) alongside the Medium/Low items, this is
realistically **multiple full working sessions**, not a single pass — each High item alone is
comparable in scope to everything shipped in this session's entire Waze-UI pass combined. It is
not a "finish it" afternoon task, which is the real basis for deferring it rather than
attempting it inline with the Phase 1–6 feature work.
