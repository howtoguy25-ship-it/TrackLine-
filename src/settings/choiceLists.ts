// Every single-choice list in Settings: its options, which one is selected, and the change
// picking one makes. Pure, so a test can check that exactly one option is ticked for any saved
// settings. Short lists show inline; long ones open their own page (SettingsChoiceScreen).
import type { AppSettings, SpokenDirectionsMode, VisibilityMode } from "@/services/settings";
import { VEHICLE_OPTIONS, isVehicleType, vehiclePatch } from "@/services/vehicle";
import { SPEED_LIMIT_DISPLAY_OPTIONS, selectedThresholdKey, thresholdOptions, thresholdPatch } from "@/settings/speedometer";

export interface ChoiceListOption {
  key: string;
  label: string;
  hint?: string;
}

export interface ChoiceList {
  id: ChoiceListId;
  /** Row name, page title and back button all use this. */
  title: string;
  footer?: string;
  options: (s: AppSettings) => ChoiceListOption[];
  selected: (s: AppSettings) => string | null;
  patch: (key: string, s: AppSettings) => Partial<AppSettings>;
}

export type ChoiceListId =
  | "visibility"
  | "speedLimitDisplay"
  | "speedingThreshold"
  | "spokenDirections"
  | "distanceUnit"
  | "mapLabels"
  | "appearance"
  | "nightMode"
  | "alertLifetime"
  | "vehicleType";

export const VISIBILITY_OPTIONS: { key: VisibilityMode; label: string; hint: string }[] = [
  { key: "everyone", label: "Visible to everyone", hint: "Drivers nearby see your Tracky while you drive" },
  { key: "friendsOnly", label: "Friends only", hint: "Only drivers you've added as friends see you" },
  { key: "ghost", label: "Ghost mode", hint: "Nobody sees you. You can still see and report alerts" },
];

export const SPOKEN_DIRECTIONS_OPTIONS: { key: SpokenDirectionsMode; label: string; hint: string }[] = [
  { key: "normal", label: "Normal", hint: "Every turn and alert" },
  { key: "lessChatty", label: "Less chatty", hint: "Fewer routine turn call-outs" },
  { key: "onlyAlerts", label: "Only alerts", hint: "Police, hazards and cameras. No turn-by-turn" },
  { key: "off", label: "Off", hint: "No spoken guidance" },
];

const HOUR = 60 * 60 * 1000;
export const ALERT_LIFETIME_PRESETS: { key: string; label: string; ms: number | null }[] = [
  { key: "default", label: "Default", ms: null },
  { key: "12h", label: "12 hours", ms: 12 * HOUR },
  { key: "1d", label: "1 day", ms: 24 * HOUR },
  { key: "3d", label: "3 days", ms: 72 * HOUR },
  { key: "7d", label: "7 days", ms: 168 * HOUR },
];

export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

const list = (l: ChoiceList) => l;

export const CHOICE_LISTS: Record<ChoiceListId, ChoiceList> = {
  vehicleType: list({
    id: "vehicleType",
    title: "Vehicle type",
    footer: "Sets your routes and your map icon. Motorcycle uses motorcycle routes where Google has them, car routes elsewhere.",
    options: () => VEHICLE_OPTIONS.map((o) => ({ key: o.key, label: o.label })),
    selected: (s) => s.vehicleType,
    patch: (key, s) => (isVehicleType(key) ? vehiclePatch(s, key) : {}),
  }),
  visibility: list({
    id: "visibility",
    title: "Who can see you",
    options: () => VISIBILITY_OPTIONS,
    selected: (s) => s.visibility,
    patch: (key) => ({ visibility: key as VisibilityMode }),
  }),
  speedLimitDisplay: list({
    id: "speedLimitDisplay",
    title: "Speed limit sign",
    options: () => SPEED_LIMIT_DISPLAY_OPTIONS.map((o) => ({ key: o.value, label: o.label, hint: o.hint })),
    selected: (s) => s.speedLimitDisplay,
    patch: (key) => ({ speedLimitDisplay: key as AppSettings["speedLimitDisplay"] }),
  }),
  speedingThreshold: list({
    id: "speedingThreshold",
    title: "Speeding alert",
    footer: "How far over the limit counts as speeding. The limit only ever comes from real data: a school zone, your route or the road's posted limit.",
    options: (s) => thresholdOptions(s.distanceUnit).map((o) => ({ key: o.key, label: o.label })),
    selected: (s) => selectedThresholdKey(s, s.distanceUnit),
    patch: (key, s) => {
      const opt = thresholdOptions(s.distanceUnit).find((o) => o.key === key);
      return opt ? thresholdPatch(opt) : {};
    },
  }),
  spokenDirections: list({
    id: "spokenDirections",
    title: "Spoken directions",
    options: () => SPOKEN_DIRECTIONS_OPTIONS,
    selected: (s) => s.spokenDirections,
    patch: (key) => ({ spokenDirections: key as SpokenDirectionsMode }),
  }),
  distanceUnit: list({
    id: "distanceUnit",
    title: "Units",
    options: () => [
      { key: "km", label: "Kilometres", hint: "km and km/h" },
      { key: "miles", label: "Miles", hint: "mi and mph" },
    ],
    selected: (s) => s.distanceUnit,
    patch: (key) => ({ distanceUnit: key as AppSettings["distanceUnit"] }),
  }),
  mapLabels: list({
    id: "mapLabels",
    title: "Map labels",
    footer: "Local language shows names as they're signed. Both adds your language underneath where it's different.",
    options: () => [
      { key: "local", label: "Local language" },
      { key: "app", label: "My app language" },
      { key: "both", label: "Both" },
    ],
    selected: (s) => s.mapLabels,
    patch: (key) => ({ mapLabels: key as AppSettings["mapLabels"] }),
  }),
  appearance: list({
    id: "appearance",
    title: "Appearance",
    footer: "Settings and other full screens. The map has its own theme.",
    options: () => [
      { key: "auto", label: "Automatic", hint: "Follows your phone" },
      { key: "light", label: "Light" },
      { key: "dark", label: "Dark" },
    ],
    selected: (s) => s.appearance ?? "auto",
    patch: (key) => ({ appearance: key as AppSettings["appearance"] }),
  }),
  nightMode: list({
    id: "nightMode",
    title: "Night mode",
    footer: "Brightens the camera and loosens detection in low light. Automatic turns on 10 minutes after sunset where you are, and off at sunrise.",
    options: () => [
      { key: "auto", label: "Automatic" },
      { key: "on", label: "Always on" },
      { key: "off", label: "Always off" },
    ],
    selected: (s) => s.nightModePreference,
    patch: (key) => ({ nightModePreference: key as AppSettings["nightModePreference"] }),
  }),
  alertLifetime: list({
    id: "alertLifetime",
    title: "Alert lifetime",
    footer: "How long an alert you report stays on the map for everyone. Default uses each type's own time: 45 min for police, 2 hours for hazards and crashes, 24 hours for speed cameras.",
    options: (s) => {
      const preset = ALERT_LIFETIME_PRESETS.some((p) => p.ms === s.alertExpiryMs);
      return [
        ...ALERT_LIFETIME_PRESETS.map((p) => ({ key: p.key, label: p.label })),
        { key: "custom", label: "Custom", hint: !preset && s.alertExpiryMs != null ? formatDuration(s.alertExpiryMs) : "Set your own hours and minutes" },
      ];
    },
    selected: (s) => ALERT_LIFETIME_PRESETS.find((p) => p.ms === s.alertExpiryMs)?.key ?? "custom",
    patch: (key) => {
      const p = ALERT_LIFETIME_PRESETS.find((x) => x.key === key);
      return p ? { alertExpiryMs: p.ms } : {};
    },
  }),
};

/** The current choice's label, for the row that opens the list ("Speeding alert · +5 km/h"). */
export function currentChoiceLabel(id: ChoiceListId, s: AppSettings): string {
  const l = CHOICE_LISTS[id];
  const key = l.selected(s);
  if (id === "alertLifetime" && key === "custom" && s.alertExpiryMs != null) return formatDuration(s.alertExpiryMs);
  return l.options(s).find((o) => o.key === key)?.label ?? "";
}
