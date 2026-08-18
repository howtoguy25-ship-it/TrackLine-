import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AlertType } from "@/types/alert";
import type { MapThemeKey, RoadThicknessKey } from "@/utils/mapStyle";
import type { NavCardThemeKey } from "@/utils/navCardTheme";
import type { AuRegionCode } from "@/utils/auStates";
import type { AlertIconThemeKey } from "@/utils/alertIconThemes";
import type { MapMarkerStyleKey } from "@/utils/mapMarkerStyles";

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
  mapTheme: "normal",
  roadThickness: "normal",
  navCardTheme: "dark",
  alertExpiryMs: null,
  alertIconTheme: "default",
  mapMarkerStyle: "default",
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
