# Map style previews

**Status: not rendered yet -- no Mapbox token is available in the environment that builds these.**

`scripts/render-map-previews.mjs` draws the app's own style files
(`src/map-v2/styles/trackline-light.json` / `trackline-dark.json`, exactly what ships) with
Mapbox GL JS in a headless browser, for every place below at zoom 11, 14, 16 and 18, light and
dark (176 images). The Mapbox Static Images API can't be used: it only renders styles uploaded to
a Mapbox account, and ours is a local file built from rules.

To render: add the app's **public** Mapbox token (`pk.`..., the same value as the EAS variable
`MAPBOX_PUBLIC_TOKEN`) to the Claude Code cloud environment as an environment variable named
`MAPBOX_PUBLIC_TOKEN` (claude.ai/code > your environment > Environment variables), start a
session, and ask for the previews. It's the public token already inside the app, but anyone with
access to that environment can read it.

What each image is checked for: road + street names visible when zoomed out, shields readable
(each country's own colours, from the tiles' `shield` data), labels in the local language and
script (Arabic, Japanese, Cyrillic) with no missing glyphs, parks/water colours, no overlapping or
missing labels, dark mode readable.

| Place | Zoom | Light | Dark | Issues found |
|---|---|---|---|---|
| Sydney CBD | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Greenacre / Bankstown | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Parramatta | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Dubbo (regional NSW) | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Melbourne | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Brisbane | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Perth | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Auckland | 11, 14, 16, 18 | not rendered | not rendered | -- |
| London | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Paris | 11, 14, 16, 18 | not rendered | not rendered | -- |
| New York | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Los Angeles | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Toronto | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Dubai | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Tokyo | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Riyadh | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Beirut | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Mexico City | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Cape Town | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Hume Hwy near Marulan (rural highway) | 11, 14, 16, 18 | not rendered | not rendered | -- |
| M4 / M7 Light Horse Interchange | 11, 14, 16, 18 | not rendered | not rendered | -- |
| Sydney Harbour (coastline, ferries) | 11, 14, 16, 18 | not rendered | not rendered | -- |
