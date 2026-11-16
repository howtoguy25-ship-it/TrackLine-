# Alert settings — Settings > Map information & overlays > Reports

Generated from `src/settings/reportCatalog.ts` (the one list the screens, the map and the tests all read).
Every row has its own icon (`ReportItemIcon`), a title, a grey description and a chevron to a detail screen
with the icon, an explanation, the data source and its real switches. Switches are saved with the rest of the
settings (AsyncStorage, and the signed-in account's `users/{uid}.settings` via the existing sync).

An item with no data source anywhere shows **"Coming soon in your area"** with its switches disabled — never a
switch that saves but changes nothing, never invented pins.

| Item | Show on map | Alert while driving | Data source | Status | Evidence |
|---|---|---|---|---|---|
| Speed camera | Yes | Yes | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Red light camera | Yes | Yes | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Red light & speed camera | Yes | Yes | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Stop sign camera | disabled | disabled | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |
| Mobile police camera | Yes | Yes | TrackLine driver reports | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Transit lane camera | disabled | disabled | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |
| Carpool lane camera | disabled | disabled | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |
| Bus lane camera | disabled | disabled | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |
| Mobile phone camera | Yes | Yes | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Noise camera | disabled | disabled | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |
| Safe distance camera | Yes | Yes | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Seat belt camera | Yes | Yes | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Railway crossing | Yes | Yes | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Traffic lights | Yes | Yes (default off) | OpenStreetMap, TrackLine driver reports | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Toll booth | Yes | Yes | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Speed bump | Yes | Yes (default off) | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Sharp curve | Yes | Yes | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Speed limit changes | — | Yes | Posted limits (OSM / school zones) | DONE | engine.test.ts "Speed limit changes" + toggles.test.ts restart |
| Complex intersection | Yes | Yes | Route road data (Mapbox) | DONE | engine.test.ts "Route items" (zoom gated by alert, label by show) |
| Multi-lane merge | Yes | Yes | Route road data (Mapbox) | DONE | engine.test.ts "Route items" (zoom gated by alert, label by show) |
| School zones | Yes | Yes | TfNSW school zones | DONE | toggles.test.ts "Older settings" (schoolZonesShowOnMap / schoolZonesAlert) + existing school-zone tests |
| Lane ending | disabled | disabled | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |
| Raised crossing | Yes | Yes | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Pedestrian crossing | Yes | Yes (default off) | OpenStreetMap | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Shoulder ending | disabled | disabled | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |
| Narrow bridge | disabled | disabled | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |
| Police | Yes | Yes | TrackLine driver reports | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Crash | Yes | Yes | TrackLine driver reports, Live Traffic NSW | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Traffic | Yes | — | Live Traffic NSW | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Sudden slowdown | — | Yes | Live route traffic (Google) | DONE | engine.test.ts "Sudden slowdown" + toggles.test.ts restart |
| Emergency vehicles | Yes | Yes | TrackLine driver reports | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Roadwork | Yes | Yes | Live Traffic NSW | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Map chats | disabled | — | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |
| Closures | Yes | Yes | Live Traffic NSW | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Animals | Yes | Yes | Live Traffic NSW | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Crash history | — | disabled | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |
| Car on shoulder | Yes | Yes | Live Traffic NSW | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Other hazards | — | Yes | TrackLine driver reports, Live Traffic NSW | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Bad weather | — | Yes | Live Traffic NSW | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Blocked lane | Yes | Yes | Live Traffic NSW | DONE | toggles.test.ts (pins/alert/voice/restart) + screens.test.tsx (detail switch) |
| Tracky needs help | — | disabled | None anywhere yet | BLOCKED — "Coming soon in your area" | toggles.test.ts "Coming soon" + screens.test.tsx disabled switches |

## Speedometer (Map information & overlays > Speedometer)

| Item | Status | Evidence |
|---|---|---|
| Show speedometer | DONE | `visible={speedometerVisible && settings.showSpeedometer}` in MapScreen; restart test |
| Speed limit: Always / When above the limit / Don't show (with tick) | DONE | `showLimitSign` (engine.test.ts "Speedometer"), LiveSpeedometer `showLimit` render test |
| Threshold: At the limit, +5/+10/+15/+20 km/h (mph labels in miles), +5/+10/+15 % | DONE | `thresholdOptions` / `thresholdKmhFor` tests |
| Alert at threshold (chime) | DONE | existing chime switch; threshold now from `thresholdKmhFor` |

## Map shortcuts (Map information & overlays > Map shortcuts)

| Item | Status | Evidence |
|---|---|---|
| Compass | DONE (existing) | settingsLayout.test.ts |
| Audio player | DONE (existing) | settingsLayout.test.ts |
| Sound button | DONE | HomeMapControls `showSoundButton` |
| Show Trackys | DONE (moved from Map layers) | settingsLayout.test.ts |
| Traffic flow | DONE | `showsTrafficLayer = settings.showTrafficFlow` (home map too) |

## How "Alert while driving" works

`alerts/collectFeatures.ts` gathers every real feature whose item alerts (OSM cameras/crossings, driver reports
except your own, Live Traffic NSW incidents); `alerts/approachAlerts.ts` picks the nearest one coming up —
on the route ahead while navigating, within ±30° of the heading otherwise — at a distance of speed × 25 s
(250–800 m), once per feature (forgotten after 15 min), only when driving at 15 km/h or more. It shows a chip
with the item's icon and says one line (`alerts/featurePhrases.ts`, en/es/ru/tr/ar), following the voice
settings (said in "Only alerts" mode, silent when sound is off).
