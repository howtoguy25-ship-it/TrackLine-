import type { IconName } from "@/components/ui/Icon";
import type { SettingsIconMeaning } from "@/theme/colors";

// Settings' top-level groups: their names, icons and colours (the Settings home), and which of
// SettingsScreen's sections each one shows. Kept out of SettingsScreen.tsx so the list can be
// used (and tested) without loading that whole screen.
export type SettingsCategory =
  | "account"
  | "privacy"
  | "mapDisplay"
  | "mapInfo"
  | "navigationVoice"
  | "alertsCommunity"
  | "notifications"
  | "plannedDrives"
  | "vehicleAI"
  | "about"
  | "developer";

export const SETTINGS_CATEGORY_LABELS: Record<SettingsCategory, string> = {
  account: "Account",
  privacy: "Privacy & visibility",
  mapDisplay: "Map display",
  mapInfo: "Map information & overlays",
  navigationVoice: "Navigation & voice",
  alertsCommunity: "Alerts & community",
  notifications: "Notifications",
  plannedDrives: "Planned drives",
  vehicleAI: "Vehicle & AI tools",
  about: "About",
  developer: "Developer",
};

export const SETTINGS_CATEGORY_ICONS: Record<SettingsCategory, IconName> = {
  account: "person-circle",
  privacy: "eye-off",
  mapDisplay: "map",
  mapInfo: "layers",
  navigationVoice: "volume-high",
  alertsCommunity: "warning",
  notifications: "notifications",
  plannedDrives: "calendar",
  vehicleAI: "car-sport",
  about: "information-circle",
  developer: "code-slash",
};

export const SETTINGS_CATEGORY_MEANING: Record<SettingsCategory, SettingsIconMeaning> = {
  account: "account",
  privacy: "privacy",
  mapDisplay: "map",
  mapInfo: "map",
  navigationVoice: "sound",
  alertsCommunity: "reports",
  notifications: "sound",
  plannedDrives: "routes",
  vehicleAI: "safety",
  about: "account",
  developer: "account",
};

export const CATEGORY_SECTIONS: Record<SettingsCategory, string[]> = {
  account: ["Account", "Purchases"],
  privacy: ["Who can see you", "Reports and places"],
  mapDisplay: ["Appearance", "Map view", "Map theme", "Road thickness", "Default map view", "Map labels", "Navigation card", "Your map marker", "Alert icons"],
  // Reports (every camera, road feature and report type), the speedometer, and the map's buttons.
  mapInfo: ["Reports", "Mapped road features", "Live traffic (NSW)", "Speedometer", "Speed limit sign", "Map shortcuts"],
  navigationVoice: ["Voice guidance", "Spoken directions", "Units", "Public transport"],
  alertsCommunity: ["Live alerts", "Alert regions", "Emergency vehicle radar"],
  notifications: ["Messages from TrackLine"],
  plannedDrives: ["Planned drives"],
  vehicleAI: ["AI vehicle detection", "Vehicle checks", "Owner tools"],
  about: ["About"],
  developer: ["Touch debugger (dev only)", "GPS replay (dev only)"],
};

export const CATEGORY_ORDER: SettingsCategory[] = [
  "account",
  "privacy",
  "mapDisplay",
  "mapInfo",
  "navigationVoice",
  "alertsCommunity",
  "notifications",
  "plannedDrives",
  "vehicleAI",
  "about",
];
