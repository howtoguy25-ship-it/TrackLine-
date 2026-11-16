# Alert settings — Settings > Map information & overlays > Reports

Generated from `src/settings/reportCatalog.ts` (the one list the screens, the map and the tests all read).
Every row has its own icon (`ReportItemIcon`), a title, a grey description and a chevron to a detail screen
with the icon, an explanation, the data source and its real switches. Switches are saved with the rest of the
settings (AsyncStorage, and the signed-in account's `users/{uid}.settings` via the existing sync).

Every item is live (no "Coming soon" anywhere — tested). Each one has at least one real source: driver reports from the
report grid, official data, OpenStreetMap, or something derived from real route/traffic data. The same thing from several
sources is shown once, best first: official > confirmed driver report > OpenStreetMap > unconfirmed report; the pin's card
says which. Fixed cameras and road features stay on the map once 3 drivers confirm them or an admin approves them
(Settings › Map information & overlays › Reports › Moderation queue, owner only).

| Item | Show on map | Alert while driving | Data source | How it gets reported | Status | Evidence |
|---|---|---|---|---|---|---|
| Speed camera | Yes | Yes | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Red light camera | Yes | Yes | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Red light & speed camera | Yes | Yes | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Stop sign camera | Yes | Yes | TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Mobile police camera | Yes | Yes | TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Transit lane camera | Yes | Yes | TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Carpool lane camera | Yes | Yes | TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Bus lane camera | Yes | Yes | TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Mobile phone camera | Yes | Yes | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Noise camera | Yes | Yes | TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Safe distance camera | Yes | Yes | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Seat belt camera | Yes | Yes | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Railway crossing | Yes | Yes | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Traffic lights | Yes | Yes (default off) | OpenStreetMap, TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Toll booth | Yes | Yes | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Speed bump | Yes | Yes (default off) | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Sharp curve | Yes | Yes | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Speed limit changes | — | Yes | Posted limits (official zones + OSM), TrackLine driver reports | Road report sheet (Speed limit / school zone) | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Complex intersection | Yes | Yes | Route data (Mapbox lanes / intersections), TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Multi-lane merge | Yes | Yes | Route data (Mapbox lanes / intersections), TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| School zones | Yes | Yes | TfNSW school zones (official), TrackLine driver reports | Road report sheet (Speed limit / school zone) | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Lane ending | Yes | Yes | Route data (Mapbox lanes / intersections), TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx "lane ending" + grid/pin/alert |
| Raised crossing | Yes | Yes | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Pedestrian crossing | Yes | Yes (default off) | OpenStreetMap, TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Shoulder ending | Yes | Yes | TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Narrow bridge | Yes | Yes | TrackLine driver reports | Report grid · permanent after 3 confirmations or admin approval | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Police | Yes | Yes | TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Crash | Yes | Yes | Live Traffic NSW (official), TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Traffic | Yes | — | Live Traffic NSW (official), TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Sudden slowdown | — | Yes | Live route traffic (Google), TrackLine drivers’ speeds, TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx "sudden slowdown" + engine.test.ts |
| Emergency vehicles | Yes | Yes | TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Roadwork | Yes | Yes | Live Traffic NSW (official), TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Map chats | Yes | — | TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Closures | Yes | Yes | Live Traffic NSW (official), TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Animals | Yes | Yes | Live Traffic NSW (official), TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Crash history | — | Yes | Recorded crashes (LTN + confirmed reports) | Derived (not reported) | DONE | liveItems.test.tsx "crash history"; firebase reports.test.js "crash history records" |
| Car on shoulder | Yes | Yes | Live Traffic NSW (official), TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Other hazards | — | Yes | Live Traffic NSW (official), TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Bad weather | — | Yes | Live Traffic NSW (official), TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Blocked lane | Yes | Yes | Live Traffic NSW (official), TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |
| Tracky needs help | — | Yes | TrackLine driver reports | Report grid · expires per type | DONE | liveItems.test.tsx (grid → pin → switches → alert → voice), toggles.test.ts (restart) |

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
