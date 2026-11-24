import type { ReportPrefs } from "@/settings/reportCatalog";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase";
import type { AlertType } from "@/types/alert";
import { SETTINGS_VERSION, migrateStoredSettings } from "@/services/settingsMigration";
import type { MapThemeKey, RoadThicknessKey } from "@/utils/mapStyle";
import type { NavCardThemeKey } from "@/utils/navCardTheme";
import type { AuRegionCode } from "@/utils/auStates";
import type { AlertIconThemeKey } from "@/utils/alertIconThemes";
import type { MapMarkerStyleKey } from "@/utils/mapMarkerStyles";
import { DEFAULT_ROUTE_AVOID, normalizeRouteAvoid, type RouteAvoidPrefs } from "@/map/routeChoices";

export { SETTINGS_VERSION, migrateStoredSettings };

// Real, explicit request (Waze-style redesign build rules) -- every setting persists locally
// via AsyncStorage AND syncs to Firestore once a driver is actually signed in (not the app's own
// always-on anonymous session, see firebase.ts's ensureSignedIn), so a setting changed on one
// device shows up on another. "Which audio output is currently in use" is never one of these --
// that's live device state, not a stored preference.
export type SpokenDirectionsMode = "normal" | "lessChatty" | "onlyAlerts" | "off";

export const ALL_ALERT_TYPES: AlertType[] = [
  "police",
  "emergency_vehicle",
  "hazard",
  "camera",
  "crash",
  "traffic_light",
];

export interface AppSettings {
  // Real Australian state/territory selection -- replaces the old 1-200km alertRadiusKm
  // slider, per explicit request. A driver sees every non-expired alert in every region they've
  // toggled on, regardless of how far away it is; toggling off a region stops showing its
  // alerts entirely. Empty until the first-launch auto-detect effect (see MapScreen.tsx) seeds
  // it with whichever region the device's own current location falls in.
  visibleRegions: AuRegionCode[];
  // Master on/off for receiving/showing community alerts (police/camera/crash/etc.) at all --
  // off means none are shown regardless of which regions are toggled on, matching the user's
  // "if toggled off user who is active doesn't receive no alerts" spec.
  alertsEnabled: boolean;
  // Which AlertTypes to actually show/receive while alertsEnabled is on -- lets a driver
  // e.g. only care about police + hazards and not crashes.
  visibleAlertTypes: AlertType[];
  autoShareDetections: boolean; // default false (opt-in)
  /** Siren radar (services/sirenTracker.ts): listens for sirens while driving. Off until turned on. */
  sirenRadar: boolean;
  /** Live road view (nav/liveScene.ts): while navigating, the vehicles the camera sees, drawn live around your route. Off until turned on. */
  liveRoadView: boolean;
  /** Trip history (trips/tripLog.ts): each navigated trip's distance, time and speeds, kept on the phone only. */
  tripHistory: boolean;
  sirenSensitivity: number; // confidence threshold 0-1, default 0.6
  defaultVoiceEnabled: boolean; // initial voiceEnabled value on launch
  // Static, permanently-mapped OSM infrastructure layer (every known traffic light / speed
  // camera location) -- independent of the live community AlertType "camera"/"traffic_light"
  // reports above, which are temporary/mobile and user-submitted.
  showTrafficLights: boolean;
  showSpeedCameras: boolean;
  // Real NSW government live traffic camera feed -- see services/liveTrafficCameras.ts.
  // Entirely separate from the static OSM traffic-light/speed-camera layer above: this is a
  // small (~197 camera), NSW-only dataset of actual live-refreshing road images, opt-in and
  // off by default since it's a real, distinct, opt-in dataset rather than the always-on OSM
  // infrastructure layer. Mirrors web's useSettings.ts default exactly.
  showLiveCameras: boolean;
  // Live Traffic NSW: current road incidents (crashes, heavy traffic, roadworks, floods, fires)
  // from Transport for NSW, as pins on the map. On by default -- unlike the cameras above it's
  // exactly the kind of thing a driver wants without asking -- but it shows nothing at all until
  // the project owner has provided a Transport for NSW key (see DEPLOY.md).
  showLiveTraffic: boolean;
  // How far from the driver's own location that layer is fetched/shown -- independent of
  // visibleRegions above (community alerts), which is region-based rather than a radius.
  osmLayerRadiusKm: number; // 1-200km
  // Which map color theme customMapStyle renders -- see utils/mapStyle.ts.
  mapTheme: MapThemeKey;
  // Real, confirmed request -- a separate road-thickness/design preset, independent of the
  // color theme above (see utils/mapStyle.ts's own getMapStyle/ROAD_THICKNESS_MULTIPLIERS).
  roadThickness: RoadThicknessKey;
  // AI Vehicle Detection's own night-processing mode (brightened frame + lowered detection
  // thresholds, see VehicleDetectionScreen.tsx) -- "auto" switches it on/off by itself using a
  // real astronomical sunset/sunrise calculation at the driver's own current location (see
  // utils/sunTimes.ts), never a fixed clock time. "on"/"off" are a manual, explicit override for
  // a driver who wants it always (a permanently dim garage) or never (bright street lighting
  // makes it unnecessary) regardless of the real sun.
  nightModePreference: "auto" | "on" | "off";
  // Which color theme the navigation instruction card renders -- see utils/navCardTheme.ts.
  navCardTheme: NavCardThemeKey;
  // Real override for how long an alert THIS device reports stays live before it auto-expires
  // and disappears for everyone -- null means "use the app's own per-type defaults"
  // (types/alert.ts's ALERT_TTL_MS: 45min for police/emergency vehicle, 2h for hazard/crash/
  // traffic light, 24h for camera), matching behavior before this setting existed. Set in
  // milliseconds so services/alerts.ts's reportAlert can use it directly without reconverting.
  alertExpiryMs: number | null;
  // Which real vector icon pack alert markers render with -- see utils/alertIconThemes.ts.
  alertIconTheme: AlertIconThemeKey;
  // Which real vehicle icon the driver's own live-position marker renders as -- see
  // utils/mapMarkerStyles.ts.
  mapMarkerStyle: MapMarkerStyleKey;
  // Real, explicit request -- a single soft chime when the driver's own live speed goes over
  // the posted limit by 3+ km/h, at most once every 30s (see LiveSpeedometer.tsx). Default ON,
  // same as every other audible-alert setting in this app.
  speedWarningChimeEnabled: boolean;
  /** "Hey TrackLine": listen on the phone for the wake phrase while the map is open (off by default). */
  wakePhrase: boolean;
  /** Save where the car was parked when a drive ends (nav/autoParking.ts). On by default. */
  autoParking: boolean;
  /** Warn (chime/colour) this many km/h over the limit -- school-zone limits included. 1-10. */
  speedingThresholdKmh: number;
  /** Travel mode last picked (Drive by default): drive, motorbike, bike, walk, transit, ferry. */
  lastTravelMode: string;
  /** Map labels: the local name (default), the app's language, or both. */
  mapLabels: "local" | "app" | "both";
  /** Settings > Reports > Road features > School zones. */
  schoolZonesShowOnMap: boolean;
  /** Alert while driving: the school badge on the sign and "School zone, 40" when entering. */
  schoolZonesAlert: boolean;
  // Real, explicit request -- which camera pose the map opens into (idle browsing) and starts
  // navigation in, applied with no flash of a different style first. "tilted3d" is a true no-op
  // default (byte-identical to this app's existing always-on tilted chase-cam/idle-3D-buildings
  // behavior, see MapScreen.tsx's own show3D/chase-cam effects) -- "flat" is a genuinely new
  // top-down pitch-0 pose this app never had before; "satellite3d" is the same tilted pose with
  // mapType set to hybrid instead of standard. A live map toggle (the existing 3D-buildings/
  // satellite FABs) can still change the view mid-session same as always; this only controls
  // what it opens/starts into.
  defaultMapViewStyle: "tilted3d" | "flat" | "satellite3d";
  // Real, explicit request -- Waze-style home screen's compass button, directly under the new
  // Menu button, resets heading/north on tap. Settings > Map shortcuts > Show compass controls
  // whether it's actually rendered at all.
  showCompass: boolean;
  // Settings > Map shortcuts > Audio player: a round music button, top-right on the home map,
  // that opens the driver's music app. Off by default -- it's a shortcut, not a core control.
  showAudioPlayer: boolean;
  // Which one-off settings adjustments have been applied to this phone (see
  // migrateStoredSettings). Not something a driver sets.
  settingsVersion: number;
  // Settings > Map display > 3D buildings. (Was a row in the old Map tools panel, kept only in
  // memory; it's a setting now, so it's remembered.)
  show3DBuildings: boolean;
  // Settings > Map view > Keep map north up: while driving the map stays north-up (the arrow
  // still turns). Off: the map turns with the road ahead (permanent fix §4).
  keepNorthUp: boolean;
  // Settings > Map display > Dark map: Off / On / Only at night / Same as phone. When it applies,
  // the map (and the controls on it) switch to TrackLine Dark; otherwise the Map theme shows.
  mapDarkMode: "off" | "on" | "night" | "system";
  // Settings > Map view > Recentre automatically: while driving, after you've moved the map, the
  // camera goes back to following you after 15 s untouched if you're moving over 10 km/h. Never on
  // the home map (permanent fix §2).
  navAutoRecentre: boolean;
  // Route selection > Avoid: what every driving route request steers around (tolls, motorways,
  // ferries, U-turns). Remembered, so it applies to the next trip too.
  routeAvoid: RouteAvoidPrefs;
  // Real, explicit request -- how chatty spoken turn-by-turn guidance is: "normal" speaks every
  // manoeuvre, "lessChatty" trims routine ones, "onlyAlerts" speaks only hazard/police/camera
  // call-outs (no turn-by-turn speech at all), "off" is fully silent. Distinct from (and takes
  // priority over) the existing defaultVoiceEnabled/voiceEnabled master toggle -- that one is
  // "is guidance speech on at all", this is "how much of it".
  spokenDirections: SpokenDirectionsMode;
  /** Settings and other full screens: follow the phone (auto), or always light / dark. */
  appearance: "auto" | "light" | "dark";
  // Real, explicit request -- Settings > General > Distance units. Default "km" per "default
  // units km, Australian English" -- see utils/navFormat.ts's own formatDistance for the exact
  // threshold rules in each unit.
  distanceUnit: "km" | "miles";
  /** Petrol list: which fuel's price to show (E10, 91, 95, 98, diesel, LPG, EV chargers). */
  preferredFuelType: "E10" | "91" | "95" | "98" | "diesel" | "lpg" | "ev";
  // Real, explicit request (Ghost mode + visibility control) -- whether this driver's presence
  // can be shown to other drivers at all (see Part 3's presence system, not yet built): "ghost"
  // never writes a presence doc, "friendsOnly" restricts it to accepted friends only once that
  // system exists, "everyone" is the fully-visible, opt-in choice. Defaults to "ghost" for every
  // install (new AND pre-existing, since a device that's never set this has never actually opted
  // in to being shown either) per the explicit "default for new users: GHOST MODE -- opt-in to
  // be visible" requirement -- see VisibilitySheet.tsx/SettingsScreen.tsx's own Privacy section.
  visibility: VisibilityMode;
  // Real, explicit request -- when a report (alert) is attributed to this driver's presence
  // card, whether their real display name is shown instead of "A Tracky". Off by default --
  // reporting itself never requires giving up anonymity.
  showNameOnReports: boolean;
  // Real, explicit request -- "Settings > Map shortcuts > 'Show Trackys' toggle." Whether this
  // device subscribes to and renders OTHER visible+driving drivers' presence markers at all
  // (see presence.ts/MapScreen.tsx) -- independent of this device's OWN visibility above, which
  // controls whether it's shown to others, not whether it sees others.
  showTrackysOnMap: boolean;
  // Settings > Map information & overlays > Reports: per-item "Show on map" / "Alert while
  // driving" (settings/reportCatalog.ts). Missing = that item's default.
  reportPrefs: ReportPrefs;
  // Speedometer section.
  showSpeedometer: boolean;
  /** The limit sign next to the speedometer: only when over the limit, never, or always. */
  speedLimitDisplay: "whenAbove" | "never" | "always";
  /** A percentage threshold over the limit (5/10/15); null = use speedingThresholdKmh. */
  speedingThresholdPercent: number | null;
  // Map shortcuts.
  showSoundButton: boolean;
  /** Live traffic flow colours on the map (home map too). */
  showTrafficFlow: boolean;
  /** Settings > Privacy: add an anonymous +1 to a place's popularity when you arrive there. Off by default. */
  shareArrivals: boolean;
  /** Settings > Notifications: which kinds of messages from TrackLine this phone gets (push,
   *  inbox, banners). Account & security messages always come. Synced to deviceSessions so the
   *  server never sends a switched-off kind. */
  notifyFun: boolean;
  notifyNews: boolean;
  notifyTraffic: boolean;
}

export type VisibilityMode = "everyone" | "friendsOnly" | "ghost";

export const DEFAULT_SETTINGS: AppSettings = {
  // Empty on a fresh install -- MapScreen.tsx's first-launch effect seeds this with whichever
  // region the device's own current location falls in, the moment a real GPS fix comes in.
  visibleRegions: [],
  alertsEnabled: true,
  visibleAlertTypes: ALL_ALERT_TYPES,
  autoShareDetections: false,
  sirenRadar: false,
  liveRoadView: false,
  tripHistory: true,
  sirenSensitivity: 0.6,
  defaultVoiceEnabled: true,
  showTrafficLights: true,
  showSpeedCameras: true,
  showLiveCameras: false,
  showLiveTraffic: true,
  osmLayerRadiusKm: 5,
  // Real, confirmed audit fix -- the brief's own Phase 1 spec explicitly asks for a "default
  // Waze-like light vector style." "normal" (the old default) is a dark forest-green theme,
  // not light -- see mapStyle.ts's own `light` theme (background #eef1f6) for the real one.
  mapTheme: "light",
  roadThickness: "normal",
  nightModePreference: "auto",
  navCardTheme: "dark",
  alertExpiryMs: null,
  alertIconTheme: "default",
  mapMarkerStyle: "default",
  speedWarningChimeEnabled: true,
  wakePhrase: false,
  autoParking: true,
  speedingThresholdKmh: 5,
  lastTravelMode: "drive",
  mapLabels: "local",
  schoolZonesShowOnMap: true,
  schoolZonesAlert: true,
  defaultMapViewStyle: "tilted3d",
  showCompass: true,
  showAudioPlayer: false,
  settingsVersion: SETTINGS_VERSION,
  show3DBuildings: false,
  keepNorthUp: false,
  mapDarkMode: "off",
  navAutoRecentre: true,
  routeAvoid: DEFAULT_ROUTE_AVOID,
  spokenDirections: "normal",
  appearance: "auto",
  distanceUnit: "km",
  preferredFuelType: "91",
  visibility: "ghost",
  showNameOnReports: false,
  showTrackysOnMap: true,
  reportPrefs: {},
  showSpeedometer: true,
  speedLimitDisplay: "always",
  speedingThresholdPercent: null,
  showSoundButton: true,
  showTrafficFlow: true,
  shareArrivals: false,
  notifyFun: true,
  notifyNews: true,
  notifyTraffic: true,
};

const STORAGE_KEY = "@trackline/settings";

// "aqua" was a real, selectable NAV_CARD_THEMES key before it was replaced with several new
// themes this session (see navCardTheme.ts's own comment) -- a device that had actually picked
// it has that exact string sitting in AsyncStorage right now. Left as-is, `{ ...DEFAULT_SETTINGS,
// ...JSON.parse(raw) }` below would overwrite the safe "dark" default with that now-nonexistent
// key, and NAV_CARD_THEMES["aqua"] is undefined -- every component reading `.text`/`.background`
// etc. off it would throw. Real, confirmed migration, not a hypothetical.
const RETIRED_NAV_CARD_THEME_KEYS = new Set(["aqua"]);

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    if (RETIRED_NAV_CARD_THEME_KEYS.has(parsed.navCardTheme)) {
      delete parsed.navCardTheme;
    }
    const migrated = migrateStoredSettings(
      { ...DEFAULT_SETTINGS, ...parsed, routeAvoid: normalizeRouteAvoid(parsed.routeAvoid) },
      parsed.settingsVersion
    );
    // Saved straight away when an adjustment was applied -- otherwise the stored copy would
    // still look out of date on the next launch and the same "one-off" change would be made
    // again every time, undoing whatever the driver had chosen since.
    if (parsed.settingsVersion !== SETTINGS_VERSION) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)).catch(() => {});
    }
    return migrated;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// Real, explicit request -- cross-device settings sync for a real signed-in account. Same
// `users/{uid}` doc userProfile.ts already writes to (displayName/email/provider,
// visibleRegions), under its own `settings` field so it can't collide with those. Pushed on
// every updateSettings call (see SettingsContext.tsx) while signed in with a real (non-
// anonymous) account -- never for the app's own always-on anonymous session, which has no
// other device to sync with anyway.
export async function pushSettingsToProfile(uid: string, settings: AppSettings): Promise<void> {
  await setDoc(doc(db, "users", uid), { settings, settingsUpdatedAt: Date.now() }, { merge: true });
}

// Pulled once per real sign-in (see SettingsContext.tsx) -- returns null when this account has
// never synced settings from any device yet (a real "nothing to merge" case, not a fetch
// failure), so the caller keeps whatever's already stored locally instead of overwriting it
// with an empty object.
export async function pullSettingsFromProfile(uid: string): Promise<Partial<AppSettings> | null> {
  const snap = await getDoc(doc(db, "users", uid));
  const remote = snap.exists() ? (snap.data().settings as Partial<AppSettings> | undefined) : undefined;
  if (!remote) return null;
  if (remote.routeAvoid !== undefined) remote.routeAvoid = normalizeRouteAvoid(remote.routeAvoid);
  // The copy on the account may predate a one-off adjustment (see migrateStoredSettings). It
  // gets the same adjustment before it's merged in -- otherwise signing in would bring back
  // exactly what the adjustment on this phone had just changed.
  if (typeof remote.settingsVersion === "number" && remote.settingsVersion >= SETTINGS_VERSION) return remote;
  const adjusted: Partial<AppSettings> = { ...remote, settingsVersion: SETTINGS_VERSION };
  if (adjusted.defaultMapViewStyle === "satellite3d") adjusted.defaultMapViewStyle = "tilted3d";
  if (adjusted.mapTheme !== undefined) adjusted.mapTheme = "light";
  return adjusted;
}
