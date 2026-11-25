// Settings search: every setting by name and a few words people might type for it, and which
// group it lives in. Picking a result opens that group and flashes the row (SettingsScreen's
// `highlight` param). Plus the one-line state shown under each group on the Settings home.
// Pure, so it's tested directly (__tests__/settings/redesign.test.ts).
import type { AppSettings } from "@/services/settings";
import type { SettingsCategory } from "@/screens/settingsCategories";
import { MAP_THEME_LABELS } from "@/utils/mapStyle";
import { currentChoiceLabel } from "@/settings/choiceLists";

export interface SettingsIndexEntry {
  /** The row's title in SettingsScreen (what gets highlighted). */
  title: string;
  category: SettingsCategory;
  keywords?: string[];
}

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  // Account
  { title: "Signed in", category: "account", keywords: ["account", "email", "profile"] },
  { title: "Sign out", category: "account", keywords: ["log out", "logout"] },
  { title: "Create account", category: "account", keywords: ["sign up", "register", "guest", "save"] },
  { title: "Delete account", category: "account", keywords: ["remove account", "erase"] },
  { title: "Restore purchases", category: "account", keywords: ["buy", "purchase", "receipt", "app store"] },
  // Privacy & visibility
  { title: "Ghost mode", category: "privacy", keywords: ["invisible", "hide", "visibility", "who can see me", "friends only", "visible to everyone"] },
  { title: "Show my name on reports", category: "privacy", keywords: ["name", "anonymous", "a tracky"] },
  { title: "Share arrivals", category: "privacy", keywords: ["popular places", "badge", "arrive"] },
  // Map display
  { title: "Automatic", category: "mapDisplay", keywords: ["appearance", "dark mode", "light mode", "theme"] },
  { title: "Satellite view", category: "mapDisplay", keywords: ["aerial", "imagery"] },
  { title: "3D buildings", category: "mapDisplay", keywords: ["buildings", "3d"] },
  { title: "Alerts on the map", category: "mapDisplay", keywords: ["reports on map", "hide alerts"] },
  { title: "Dark map", category: "mapDisplay", keywords: ["dark mode", "night", "night mode map", "same as phone", "automatic dark"] },
  { title: "Map theme", category: "mapDisplay", keywords: ["colours", "colors", "dark map", "light map", "style"] },
  { title: "Road thickness", category: "mapDisplay", keywords: ["road width", "bold roads", "thin roads"] },
  { title: "Default map view", category: "mapDisplay", keywords: ["tilted", "overhead", "2d", "satellite 3d", "camera"] },
  { title: "Local language", category: "mapDisplay", keywords: ["map labels", "language", "street names"] },
  { title: "Navigation card", category: "mapDisplay", keywords: ["turn card", "instruction card", "colours"] },
  { title: "Your map marker", category: "mapDisplay", keywords: ["car icon", "arrow", "vehicle icon", "marker"] },
  { title: "Alert icons", category: "mapDisplay", keywords: ["icon pack", "report icons"] },
  // Map information & overlays
  { title: "Reports", category: "mapInfo", keywords: ["cameras", "speed cameras", "police", "hazards", "school zones", "road features"] },
  { title: "Show within", category: "mapInfo", keywords: ["radius", "openstreetmap", "traffic lights", "distance"] },
  { title: "Traffic incidents", category: "mapInfo", keywords: ["live traffic", "nsw", "crashes", "roadworks"] },
  { title: "Traffic cameras", category: "mapInfo", keywords: ["live cameras", "cctv", "nsw"] },
  { title: "Show speedometer", category: "mapInfo", keywords: ["speed", "speedo"] },
  { title: "Speeding alert", category: "mapInfo", keywords: ["over the limit", "threshold", "speeding"] },
  { title: "Speeding chime", category: "mapInfo", keywords: ["beep", "sound", "speeding"] },
  { title: "Always", category: "mapInfo", keywords: ["speed limit sign", "limit"] },
  { title: "Compass", category: "mapInfo", keywords: ["north", "shortcut"] },
  { title: "Audio player", category: "mapInfo", keywords: ["music", "spotify", "apple music"] },
  { title: "Sound button", category: "mapInfo", keywords: ["mute", "shortcut"] },
  { title: "Show Trackys", category: "mapInfo", keywords: ["other drivers", "friends on map"] },
  { title: "Traffic flow", category: "mapInfo", keywords: ["traffic colours", "congestion"] },
  // Navigation & voice
  { title: "Voice on by default", category: "navigationVoice", keywords: ["voice guidance", "speech"] },
  { title: "Current voice", category: "navigationVoice", keywords: ["voice", "record voice", "language voice"] },
  { title: "Normal", category: "navigationVoice", keywords: ["spoken directions", "less chatty", "only alerts", "quiet"] },
  { title: "Kilometres", category: "navigationVoice", keywords: ["units", "miles", "km", "mph"] },
  { title: "Live tracking", category: "navigationVoice", keywords: ["public transport", "transit", "bus", "train"] },
  // Alerts & community
  { title: "Receive alerts", category: "alertsCommunity", keywords: ["alerts", "community"] },
  { title: "Which reports show and alert", category: "alertsCommunity", keywords: ["report types"] },
  { title: "Alert lifetime", category: "alertsCommunity", keywords: ["expiry", "how long", "duration"] },
  { title: "New South Wales", category: "alertsCommunity", keywords: ["regions", "states", "territories", "victoria", "queensland"] },
  { title: "Auto-share detections", category: "alertsCommunity", keywords: ["siren", "emergency vehicle", "radar"] },
  { title: "Detection sensitivity", category: "alertsCommunity", keywords: ["siren", "sensitivity"] },
  // Notifications
  { title: "Fun announcements", category: "notifications", keywords: ["notifications", "push"] },
  { title: "News and updates", category: "notifications", keywords: ["notifications", "push", "news"] },
  { title: "Traffic advisories", category: "notifications", keywords: ["notifications", "closures"] },
  // Planned drives
  { title: "Plan a drive", category: "plannedDrives", keywords: ["leave later", "schedule", "departure"] },
  // Vehicle & AI tools
  { title: "Battery", category: "vehicleAI", keywords: ["low power", "dashcam battery"] },
  { title: "Night mode", category: "vehicleAI", keywords: ["dark", "low light", "camera"] },
  { title: "Vehicle history and REV check", category: "vehicleAI", keywords: ["rego", "ppsr", "stolen", "written off", "plate"] },
  // About
  { title: "Build", category: "about", keywords: ["version", "commit"] },
  { title: "Map engine", category: "about", keywords: ["mapbox"] },
  { title: "Diagnostics", category: "about", keywords: ["debug", "not working", "token"] },
  { title: "Licences and attributions", category: "about", keywords: ["licenses", "open source", "credits"] },
  { title: "Privacy policy", category: "about", keywords: ["privacy", "data"] },
];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Settings matching what was typed: title matches first, then keyword matches. */
export function searchSettings(query: string, index: SettingsIndexEntry[] = SETTINGS_INDEX): SettingsIndexEntry[] {
  const q = norm(query);
  if (!q) return [];
  const scored: { e: SettingsIndexEntry; score: number }[] = [];
  for (const e of index) {
    const t = norm(e.title);
    let score = 0;
    if (t === q) score = 100;
    else if (t.startsWith(q)) score = 80;
    else if (t.includes(q)) score = 60;
    else if ((e.keywords ?? []).some((k) => norm(k).includes(q))) score = 40;
    else if (q.split(" ").every((w) => t.includes(w) || (e.keywords ?? []).some((k) => norm(k).includes(w)))) score = 20;
    if (score) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.e);
}

const VIEW_SHORT: Record<AppSettings["defaultMapViewStyle"], string> = { tilted3d: "3D", flat: "Overhead", satellite3d: "Satellite 3D" };

/** The one line under each group on the Settings home. */
export function categorySummary(
  category: SettingsCategory,
  s: AppSettings,
  ctx: { signedInEmail?: string | null; isGuest?: boolean; version?: string } = {}
): string {
  switch (category) {
    case "account":
      return ctx.isGuest ? "Guest. Create an account to keep your data" : ctx.signedInEmail ?? "Signed in";
    case "privacy":
      return s.visibility === "ghost" ? "Ghost mode on" : s.visibility === "friendsOnly" ? "Friends only" : "Visible to everyone";
    case "mapDisplay": {
      const theme = MAP_THEME_LABELS[s.mapTheme] ?? s.mapTheme;
      return `TrackLine ${theme} · ${VIEW_SHORT[s.defaultMapViewStyle] ?? ""}`.trim();
    }
    case "mapInfo":
      return `Speedometer ${s.showSpeedometer ? "on" : "off"} · alert ${currentChoiceLabel("speedingThreshold", s)}`;
    case "navigationVoice":
      return `Voice ${s.defaultVoiceEnabled ? "on" : "off"} · ${currentChoiceLabel("spokenDirections", s)}`;
    case "alertsCommunity":
      return s.alertsEnabled ? `Alerts on · ${s.visibleRegions.length} region${s.visibleRegions.length === 1 ? "" : "s"}` : "Alerts off";
    case "notifications": {
      const on = [s.notifyFun, s.notifyNews, s.notifyTraffic].filter(Boolean).length;
      return on === 0 ? "All off" : on === 3 ? "All on" : `${on} of 3 on`;
    }
    case "plannedDrives":
      return "Drive time for when you leave";
    case "vehicleAI":
      return `Night mode ${currentChoiceLabel("nightMode", s).toLowerCase()}`;
    case "about":
      return ctx.version ?? "Version and data sources";
    case "developer":
      return "Development builds only";
  }
}

