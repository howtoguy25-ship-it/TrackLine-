import type { IconName } from "@/components/ui/Icon";

// Settings' top-level categories: their names and icons (SettingsCategoriesScreen), and which of
// SettingsScreen's sections each one shows. Kept out of SettingsScreen.tsx so the category list
// can be used (and tested) without loading that whole screen.
export type SettingsCategory = "account" | "privacy" | "mapDisplay" | "navigationVoice" | "alertsCommunity" | "vehicleAI" | "developer";

export const SETTINGS_CATEGORY_LABELS: Record<SettingsCategory, string> = {
  account: "Account",
  privacy: "Privacy",
  mapDisplay: "Map display",
  navigationVoice: "Navigation & voice",
  alertsCommunity: "Alerts & community",
  vehicleAI: "Vehicle & AI tools",
  developer: "Developer",
};

export const SETTINGS_CATEGORY_ICONS: Record<SettingsCategory, IconName> = {
  account: "person-circle-outline",
  privacy: "eye-off-outline",
  mapDisplay: "map-outline",
  navigationVoice: "navigate-outline",
  alertsCommunity: "notifications-outline",
  vehicleAI: "car-sport-outline",
  developer: "code-slash-outline",
};

export const CATEGORY_SECTIONS: Record<SettingsCategory, string[]> = {
  account: ["Account", "Purchases"],
  privacy: ["Privacy"],
  mapDisplay: ["Map view", "Map shortcuts", "Map appearance", "Navigation card colors", "Your map marker", "Map layers"],
  navigationVoice: ["Voice guidance", "Speed", "Public transit"],
  alertsCommunity: ["Live alerts", "Alert icons"],
  vehicleAI: ["AI Vehicle Detection", "Vehicle REV Checks", "EV Radar (siren detection)"],
  developer: ["Touch debugger (dev only)", "GPS replay (dev only)"],
};

