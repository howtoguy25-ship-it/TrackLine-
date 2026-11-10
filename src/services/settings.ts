import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase";
import type { AlertType } from "@/types/alert";
import type { MapThemeKey, RoadThicknessKey } from "@/utils/mapStyle";
import type { NavCardThemeKey } from "@/utils/navCardTheme";
import type { AuRegionCode } from "@/utils/auStates";
import type { AlertIconThemeKey } from "@/utils/alertIconThemes";
import type { MapMarkerStyleKey } from "@/utils/mapMarkerStyles";

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
  // Real, explicit request -- how chatty spoken turn-by-turn guidance is: "normal" speaks every
  // manoeuvre, "lessChatty" trims routine ones, "onlyAlerts" speaks only hazard/police/camera
  // call-outs (no turn-by-turn speech at all), "off" is fully silent. Distinct from (and takes
  // priority over) the existing defaultVoiceEnabled/voiceEnabled master toggle -- that one is
  // "is guidance speech on at all", this is "how much of it".
  spokenDirections: SpokenDirectionsMode;
  // Real, explicit request -- Settings > General > Distance units. Default "km" per "default
  // units km, Australian English" -- see utils/navFormat.ts's own formatDistance for the exact
  // threshold rules in each unit.
  distanceUnit: "km" | "miles";
}

export const DEFAULT_SETTINGS: AppSettings = {
  // Empty on a fresh install -- MapScreen.tsx's first-launch effect seeds this with whichever
  // region the device's own current location falls in, the moment a real GPS fix comes in.
  visibleRegions: [],
  alertsEnabled: true,
  visibleAlertTypes: ALL_ALERT_TYPES,
  autoShareDetections: false,
  sirenSensitivity: 0.6,
  defaultVoiceEnabled: true,
  showTrafficLights: true,
  showSpeedCameras: true,
  showLiveCameras: false,
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
  defaultMapViewStyle: "tilted3d",
  showCompass: true,
  spokenDirections: "normal",
  distanceUnit: "km",
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
    return { ...DEFAULT_SETTINGS, ...parsed };
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
  return remote ?? null;
}
