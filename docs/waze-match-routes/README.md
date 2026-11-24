# Waze-match: route preview, route list, "What's your ride?"

Rendered by `scripts/waze-match-proof.ts` (run it with a Mapbox `pk.` token file, see the script
header). **What is real and what is drawn:**

- **Real:** the map style (`src/map-v2/styles/trackline-light.json`), the Mapbox tiles, the two
  routes (Mapbox Directions `driving-traffic`, Stacey St Bankstown → Lakemba Station), their
  times and distances, the "Via" text (the app's own `viaText` on those routes' steps + the ABS
  suburb centres), the camera fit (`previewEdgePadding` + `previewFitCoordinates`), and the
  time-bubble positions (the app's `screenBubbleAnchors` with each bubble's real size).
- **Drawn:** the React Native screens on top are HTML drawings that copy the components' words,
  rows, colours and the layout numbers. There is no iOS simulator on the Linux build machine, so
  these are **not phone screenshots**. Every image says "drawn" in its caption.
- **Your reference screenshots:** none of the 34 images attached in this session are the Waze
  route-preview / route-list / vehicle-picker references (they're TrackLine, AdMob and TestFlight
  screenshots). Drop yours into `reference/` named `route-preview-collapsed`, `route-preview-pulled-up`,
  `vehicle-picker`, `home-map` (.png or .jpg) and re-run the script: it writes
  `compare-<name>.png` with yours on the left and ours on the right.

| File | What it shows | Measured (shots.json) |
|---|---|---|
| `route-preview-collapsed.png` | White top card ("Your location" → destination, swap), blue-text **Avoid ▾**, **Private car ▾** vehicle pill, flat north-up clean map, selected route thick purple with dark casing, alternative lavender, bubbles "14 min / Best" (dark purple) + "15 min" (white), blue start dot in grey accuracy circle, checkered flag; sheet: time · distance · Via · "Best route" · separator · Leave later / Go now | every route point inside the free map area: **true**; bubbles placed: both, no overlap |
| `route-preview-pulled-up.png` | Sheet pulled up: both routes with Via on up to 2 lines, selected row grey fill + blue bar + blue time; map refitted above the taller sheet | inside: **true** (bottom padding 263 → 363) |
| `vehicle-picker.png` | First-run "What's your ride?" — our illustration, title, the given line, Private car · Motorcycle · Taxi with separators, blue ✓ on Private car, blue Done, Skip | — |
| `home-map.png` | Home map, real tiles, no feature dots | — |

Routes in this run: `shots.json › routes` (e.g. 14 min · 4.9 km · "Via Wattle Street Mount Lewis;
Wiley Avenue Wiley Park"). Mapbox spells street types out ("Street"); Google's route list in the
app uses its own names ("Wattle St"), which `viaText` uses unchanged.

**Not offered, and why:** Electric car (no charging-stop routing in Google Routes or Mapbox
Directions) and Truck/Van (Google's TRUCK mode needs vehicle dimensions and isn't generally
available; the route list comes from Google). Taxi gets car routes with a note: neither API has
taxi or bus-lane rules. Motorcycle gets Google TWO_WHEELER where Google offers it (not AU/UK/US).
Elsewhere it gets car routes labelled "Motorbike routes use car roads here". BLOCKED.md #29.
