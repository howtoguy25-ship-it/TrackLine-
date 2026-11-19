// Settings > Map information & overlays > Reports: every item in the list, the toggles it has,
// the real data behind it, and how a toggle is read -- the one place MapScreen, the settings
// screens and the tests all ask "is this shown?" / "does this alert?".
//
// Every item has at least one live source: driver reports (any item can be reported from the
// report grid), official data, OpenStreetMap, or something derived from real route / traffic
// data. Never invented pins.

import type { AppSettings } from "@/services/settings";
import type { AlertType } from "@/types/alert";
import type { TrafficIncident } from "@/services/trafficNswModel";
import { OSM_FEATURE_KINDS, type OsmFeatureKind } from "@/services/osmTrafficData";

export type ReportItemId =
  // cameras
  | "speedCamera"
  | "redLightCamera"
  | "redLightSpeedCamera"
  | "stopSignCamera"
  | "mobilePoliceCamera"
  | "transitLaneCamera"
  | "carpoolLaneCamera"
  | "busLaneCamera"
  | "mobilePhoneCamera"
  | "noiseCamera"
  | "safeDistanceCamera"
  | "seatBeltCamera"
  // road features
  | "railwayCrossing"
  | "trafficLights"
  | "tollBooth"
  | "speedBump"
  | "sharpCurve"
  | "speedLimitChanges"
  | "complexIntersection"
  | "multiLaneMerge"
  | "schoolZones"
  | "laneEnding"
  | "raisedCrossing"
  | "pedestrianCrossing"
  | "shoulderEnding"
  | "narrowBridge"
  // other reports
  | "police"
  | "crash"
  | "traffic"
  | "suddenSlowdown"
  | "carOnShoulder"
  | "otherHazards"
  | "badWeather"
  | "blockedLane"
  | "trackyNeedsHelp"
  | "roadwork"
  | "mapChats"
  | "closures"
  | "animals"
  | "crashHistory"
  | "emergencyVehicles";

export type DataSource = "community" | "osm" | "liveTrafficNsw" | "schoolZones" | "route" | "speedLimits" | "routeTraffic" | "trackys" | "crashRecords";

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  community: "Reports from TrackLine drivers",
  osm: "OpenStreetMap",
  liveTrafficNsw: "Live Traffic NSW (Transport for NSW)",
  schoolZones: "Official NSW school zones (Transport for NSW)",
  route: "Your route's road data (Mapbox)",
  speedLimits: "Posted speed limits (OpenStreetMap, school zones)",
  routeTraffic: "Live traffic on your route (Google)",
  trackys: "Speeds of TrackLine drivers ahead",
  crashRecords: "Recorded crashes (Live Traffic NSW and confirmed driver reports)",
};

/** How a source is grouped on the detail screen: "Sources: official data · OSM · driver reports". */
export const SOURCE_GROUP: Record<DataSource, "official data" | "OSM" | "driver reports" | "route data"> = {
  community: "driver reports",
  trackys: "driver reports",
  osm: "OSM",
  liveTrafficNsw: "official data",
  schoolZones: "official data",
  speedLimits: "official data",
  crashRecords: "official data",
  route: "route data",
  routeTraffic: "route data",
};

export function sourcesLine(id: ReportItemId): string {
  const order = ["official data", "OSM", "route data", "driver reports"];
  const groups: string[] = [];
  for (const src of REPORT_ITEM_BY_ID[id].sources) {
    const g = SOURCE_GROUP[src];
    if (!groups.includes(g)) groups.push(g);
  }
  return `Sources: ${groups.sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(" · ")}`;
}

export type ReportSection = "speedCameras" | "laneCameras" | "behaviourCameras" | "roadFeatures" | "reports" | "hazards";

export const SECTION_TITLES: Record<ReportSection, string> = {
  speedCameras: "Speeding and intersections",
  laneCameras: "Lanes",
  behaviourCameras: "Driving behaviour",
  roadFeatures: "Road features",
  reports: "Reports",
  hazards: "Hazards",
};

/** Which composite icon to draw (components/settings/ReportItemIcon.tsx). */
export interface ItemIcon {
  /** Main glyph (MaterialCommunityIcons name). */
  glyph: string;
  /** Small badge glyph in the corner, when the item combines two things. */
  badge?: string;
  /** A second badge, for the red-light-and-speed camera. */
  badge2?: string;
  colour: string;
}

export interface ReportItem {
  id: ReportItemId;
  section: ReportSection;
  title: string;
  /** One grey line in the list: what it's for. */
  description: string;
  /** The detail screen's short explanation. */
  explanation: string;
  icon: ItemIcon;
  /** Which toggles this item has. */
  show: boolean;
  alert: boolean;
  /** Where its data comes from (never empty). */
  sources: DataSource[];
  /** Default for "Alert while driving" (very common features default off so alerts stay useful). */
  alertDefault?: boolean;
}

const CAM = "#5F6368";
const RED = "#D93025";
const AMBER = "#E08A00";
const BLUE = "#1A73E8";
// Traffic-signal green for the traffic-lights tile (not the theme's "success" green).
const GREEN = "#1E8E3E";
const PURPLE = "#7B3FE4";

export const REPORT_ITEMS: readonly ReportItem[] = [
  // ---- cameras: speeding and intersections
  { id: "speedCamera", section: "speedCameras", title: "Speed camera", description: "Fixed cameras that check your speed", explanation: "Shows fixed speed cameras mapped in OpenStreetMap, and warns you as you approach one.", icon: { glyph: "cctv", badge: "speedometer", colour: CAM }, show: true, alert: true, sources: ["osm", "community"] },
  { id: "redLightCamera", section: "speedCameras", title: "Red light camera", description: "Cameras at traffic lights", explanation: "Shows red light cameras (OpenStreetMap enforcement data), and warns you as you approach one.", icon: { glyph: "cctv", badge: "traffic-light", colour: CAM }, show: true, alert: true, sources: ["osm", "community"] },
  { id: "redLightSpeedCamera", section: "speedCameras", title: "Red light & speed camera", description: "Cameras checking both at an intersection", explanation: "Shows cameras that check both red lights and speed at an intersection (OpenStreetMap enforcement data).", icon: { glyph: "cctv", badge: "speedometer", badge2: "traffic-light", colour: CAM }, show: true, alert: true, sources: ["osm", "community"] },
  { id: "stopSignCamera", section: "speedCameras", title: "Stop sign camera", description: "Cameras at stop signs", explanation: "Stop sign cameras reported by TrackLine drivers; once 3 drivers confirm one (or it's approved) it stays on the map.", icon: { glyph: "cctv", badge: "octagon", colour: CAM }, show: true, alert: true, sources: ["community"] },
  { id: "mobilePoliceCamera", section: "speedCameras", title: "Mobile police camera", description: "Mobile cameras reported by drivers", explanation: "Shows mobile speed cameras reported by TrackLine drivers, and warns you as you approach one.", icon: { glyph: "cctv", colour: "#F5B400" }, show: true, alert: true, sources: ["community"] },
  // ---- cameras: lanes
  { id: "transitLaneCamera", section: "laneCameras", title: "Transit lane camera", description: "Cameras on transit (T2/T3) lanes", explanation: "Transit-lane cameras reported by TrackLine drivers; confirmed ones stay on the map.", icon: { glyph: "cctv", badge: "account-multiple", colour: CAM }, show: true, alert: true, sources: ["community"] },
  { id: "carpoolLaneCamera", section: "laneCameras", title: "Carpool lane camera", description: "Cameras on carpool lanes", explanation: "Carpool-lane cameras reported by TrackLine drivers; confirmed ones stay on the map.", icon: { glyph: "cctv", badge: "car-multiple", colour: CAM }, show: true, alert: true, sources: ["community"] },
  { id: "busLaneCamera", section: "laneCameras", title: "Bus lane camera", description: "Cameras on bus lanes", explanation: "Bus-lane cameras reported by TrackLine drivers; confirmed ones stay on the map.", icon: { glyph: "cctv", badge: "bus", colour: CAM }, show: true, alert: true, sources: ["community"] },
  // ---- cameras: driving behaviour
  { id: "mobilePhoneCamera", section: "behaviourCameras", title: "Mobile phone camera", description: "Cameras that detect phone use", explanation: "Shows mobile phone detection cameras mapped in OpenStreetMap, and warns you as you approach one.", icon: { glyph: "cctv", badge: "cellphone", colour: CAM }, show: true, alert: true, sources: ["osm", "community"] },
  { id: "noiseCamera", section: "behaviourCameras", title: "Noise camera", description: "Cameras that detect loud vehicles", explanation: "Noise cameras reported by TrackLine drivers; confirmed ones stay on the map.", icon: { glyph: "cctv", badge: "volume-high", colour: CAM }, show: true, alert: true, sources: ["community"] },
  { id: "safeDistanceCamera", section: "behaviourCameras", title: "Safe distance camera", description: "Cameras that check following distance", explanation: "Shows safe-distance (tailgating) cameras mapped in OpenStreetMap, and warns you as you approach one.", icon: { glyph: "cctv", badge: "arrow-expand-horizontal", colour: CAM }, show: true, alert: true, sources: ["osm", "community"] },
  { id: "seatBeltCamera", section: "behaviourCameras", title: "Seat belt camera", description: "Cameras that check seat belts", explanation: "Shows seat belt detection cameras mapped in OpenStreetMap, and warns you as you approach one.", icon: { glyph: "cctv", badge: "seatbelt", colour: CAM }, show: true, alert: true, sources: ["osm", "community"] },
  // ---- road features
  { id: "railwayCrossing", section: "roadFeatures", title: "Railway crossing", description: "Level crossings with a railway", explanation: "Shows railway level crossings (OpenStreetMap), and warns you before one.", icon: { glyph: "train", badge: "alert", colour: RED }, show: true, alert: true, sources: ["osm", "community"] },
  { id: "trafficLights", section: "roadFeatures", title: "Traffic lights", description: "Traffic signals, and lights drivers report broken", explanation: "Shows traffic signals (OpenStreetMap) and traffic lights TrackLine drivers report as broken.", icon: { glyph: "traffic-light", colour: GREEN }, show: true, alert: true, sources: ["osm", "community"], alertDefault: false },
  { id: "tollBooth", section: "roadFeatures", title: "Toll booth", description: "Toll booths and gantries", explanation: "Shows toll booths and toll gantries (OpenStreetMap), and warns you before one.", icon: { glyph: "boom-gate-up", colour: BLUE }, show: true, alert: true, sources: ["osm", "community"] },
  { id: "speedBump", section: "roadFeatures", title: "Speed bump", description: "Bumps, humps and cushions", explanation: "Shows speed bumps, humps and cushions (OpenStreetMap), and warns you before one.", icon: { glyph: "sine-wave", colour: AMBER }, show: true, alert: true, sources: ["osm", "community"], alertDefault: false },
  { id: "sharpCurve", section: "roadFeatures", title: "Sharp curve", description: "Signposted dangerous curves", explanation: "Shows curves mapped as hazardous in OpenStreetMap, and warns you before one.", icon: { glyph: "sign-direction", badge: "alert", colour: AMBER }, show: true, alert: true, sources: ["osm", "community"] },
  { id: "speedLimitChanges", section: "roadFeatures", title: "Speed limit changes", description: "When the limit changes on your road", explanation: "A sound and a spoken limit when the posted speed limit changes while you drive.", icon: { glyph: "speedometer-medium", colour: RED }, show: false, alert: true, sources: ["speedLimits", "community"] },
  { id: "complexIntersection", section: "roadFeatures", title: "Complex intersection", description: "Big intersections on your route", explanation: "On your route: a close-up view and a chime before turns at big intersections (five or more roads), and a label at the turn. Drivers can report them too.", icon: { glyph: "sign-direction-plus", colour: PURPLE }, show: true, alert: true, sources: ["route", "community"] },
  { id: "multiLaneMerge", section: "roadFeatures", title: "Multi-lane merge", description: "Lanes merging on your route", explanation: "On your route: a close-up view and a chime before lanes merge, and a label at the merge. Drivers can report them too.", icon: { glyph: "call-merge", colour: PURPLE }, show: true, alert: true, sources: ["route", "community"] },
  { id: "schoolZones", section: "roadFeatures", title: "School zones", description: "Official school zones and their hours", explanation: "Shows official NSW school zones, and announces the school-zone limit when you enter one during school hours.", icon: { glyph: "school", colour: AMBER }, show: true, alert: true, sources: ["schoolZones", "community"] },
  { id: "laneEnding", section: "roadFeatures", title: "Lane ending", description: "Where a lane ends", explanation: "Where a lane ends: from the lane counts along your route (Mapbox), and lane endings drivers report.", icon: { glyph: "road-variant", badge: "arrow-collapse-left", colour: AMBER }, show: true, alert: true, sources: ["route", "community"] },
  { id: "raisedCrossing", section: "roadFeatures", title: "Raised crossing", description: "Raised pedestrian crossings", explanation: "Shows raised pedestrian crossings (OpenStreetMap), and warns you before one.", icon: { glyph: "walk", badge: "sine-wave", colour: AMBER }, show: true, alert: true, sources: ["osm", "community"] },
  { id: "pedestrianCrossing", section: "roadFeatures", title: "Pedestrian crossing", description: "Marked and signalled crossings", explanation: "Shows pedestrian crossings (OpenStreetMap), and warns you before one.", icon: { glyph: "walk", colour: BLUE }, show: true, alert: true, sources: ["osm", "community"], alertDefault: false },
  { id: "shoulderEnding", section: "roadFeatures", title: "Shoulder ending", description: "Where the road shoulder ends", explanation: "Where the road shoulder ends, reported by TrackLine drivers; confirmed ones stay on the map.", icon: { glyph: "road", badge: "alert", colour: AMBER }, show: true, alert: true, sources: ["community"] },
  { id: "narrowBridge", section: "roadFeatures", title: "Narrow bridge", description: "Bridges narrower than the road", explanation: "Bridges narrower than the road, reported by TrackLine drivers; confirmed ones stay on the map.", icon: { glyph: "bridge", colour: AMBER }, show: true, alert: true, sources: ["community"] },
  // ---- other reports
  { id: "police", section: "reports", title: "Police", description: "Police reported by drivers", explanation: "Shows police reported by TrackLine drivers, and warns you as you approach.", icon: { glyph: "police-badge", colour: "#1A56DB" }, show: true, alert: true, sources: ["community"] },
  { id: "crash", section: "reports", title: "Crash", description: "Crashes from drivers and Live Traffic NSW", explanation: "Shows crashes reported by drivers and by Live Traffic NSW, and warns you as you approach.", icon: { glyph: "car-brake-alert", colour: RED }, show: true, alert: true, sources: ["liveTrafficNsw", "community"] },
  { id: "traffic", section: "reports", title: "Traffic", description: "Heavy traffic incidents", explanation: "Shows heavy-traffic incidents from Live Traffic NSW.", icon: { glyph: "car-multiple", colour: RED }, show: true, alert: false, sources: ["liveTrafficNsw", "community"] },
  { id: "suddenSlowdown", section: "reports", title: "Sudden slowdown", description: "A jam just ahead on your route", explanation: "A spoken warning when traffic suddenly stops just ahead: from live route traffic, TrackLine drivers crawling ahead, and drivers' reports.", icon: { glyph: "car-brake-low-pressure", colour: RED }, show: false, alert: true, sources: ["routeTraffic", "trackys", "community"] },
  { id: "emergencyVehicles", section: "reports", title: "Emergency vehicles", description: "Emergency vehicles reported by drivers", explanation: "Shows emergency vehicles reported by TrackLine drivers, and warns you as you approach.", icon: { glyph: "ambulance", colour: RED }, show: true, alert: true, sources: ["community"] },
  { id: "roadwork", section: "reports", title: "Roadwork", description: "Roadworks from Live Traffic NSW", explanation: "Shows roadworks from Live Traffic NSW, and warns you as you approach.", icon: { glyph: "cone", colour: AMBER }, show: true, alert: true, sources: ["liveTrafficNsw", "community"] },
  { id: "mapChats", section: "reports", title: "Map chats", description: "Messages left on the map", explanation: "Short messages drivers leave on the map (up to 7 words).", icon: { glyph: "chat", colour: BLUE }, show: true, alert: false, sources: ["community"] },
  { id: "closures", section: "reports", title: "Closures", description: "Road closures from Live Traffic NSW", explanation: "Shows road closures from Live Traffic NSW, and warns you as you approach.", icon: { glyph: "road-variant", badge: "close-circle", colour: RED }, show: true, alert: true, sources: ["liveTrafficNsw", "community"] },
  { id: "animals", section: "reports", title: "Animals", description: "Animals on or near the road", explanation: "Shows animals on the road reported by Live Traffic NSW, and warns you as you approach.", icon: { glyph: "paw", colour: AMBER }, show: true, alert: true, sources: ["liveTrafficNsw", "community"] },
  { id: "crashHistory", section: "reports", title: "Crash history", description: "Places with a history of crashes", explanation: "A warning near places with several recorded crashes: Live Traffic NSW crashes and driver crash reports others confirmed, kept for 3 years.", icon: { glyph: "history", badge: "car-brake-alert", colour: RED }, show: false, alert: true, sources: ["crashRecords"] },
  // ---- hazards
  { id: "carOnShoulder", section: "hazards", title: "Car on shoulder", description: "Broken-down vehicles", explanation: "Shows broken-down vehicles from Live Traffic NSW, and warns you as you approach.", icon: { glyph: "car-side", badge: "alert", colour: AMBER }, show: true, alert: true, sources: ["liveTrafficNsw", "community"] },
  { id: "otherHazards", section: "hazards", title: "Other hazards", description: "Hazards reported by drivers and Live Traffic NSW", explanation: "Warns you as you approach hazards reported by drivers or by Live Traffic NSW (fires, debris and more).", icon: { glyph: "alert", colour: AMBER }, show: false, alert: true, sources: ["liveTrafficNsw", "community"] },
  { id: "badWeather", section: "hazards", title: "Bad weather", description: "Flooding and weather hazards", explanation: "Warns you as you approach flooding and weather hazards from Live Traffic NSW.", icon: { glyph: "weather-pouring", colour: BLUE }, show: false, alert: true, sources: ["liveTrafficNsw", "community"] },
  { id: "blockedLane", section: "hazards", title: "Blocked lane", description: "Lanes closed or blocked", explanation: "Shows lane closures from Live Traffic NSW, and warns you as you approach.", icon: { glyph: "road-variant", badge: "minus-circle", colour: AMBER }, show: true, alert: true, sources: ["liveTrafficNsw", "community"] },
  { id: "trackyNeedsHelp", section: "hazards", title: "Tracky needs help", description: "Drivers asking for help", explanation: "A warning when a nearby TrackLine driver asks for help (broken down, out of fuel...).", icon: { glyph: "hand-back-right", colour: RED }, show: false, alert: true, sources: ["community"] },
];

export const REPORT_ITEM_BY_ID: Readonly<Record<ReportItemId, ReportItem>> = Object.fromEntries(REPORT_ITEMS.map((i) => [i.id, i])) as never;


// ---- reading and writing the toggles -------------------------------------------------------

export type ReportPref = { show?: boolean; alert?: boolean };
export type ReportPrefs = Partial<Record<ReportItemId, ReportPref>>;

/** Items whose toggles live in older settings keys (kept, so nothing a driver chose is lost). */
type Legacy = { show?: keyof AppSettings; alert?: keyof AppSettings };
const LEGACY: Partial<Record<ReportItemId, Legacy>> = {
  speedCamera: { show: "showSpeedCameras" },
  trafficLights: { show: "showTrafficLights" },
  schoolZones: { show: "schoolZonesShowOnMap", alert: "schoolZonesAlert" },
};

/** Is this item drawn on the map? Coming-soon items have nothing to draw. */
export function isShown(settings: Pick<AppSettings, "reportPrefs"> & Partial<AppSettings>, id: ReportItemId): boolean {
  const item = REPORT_ITEM_BY_ID[id];
  if (!item.show) return false;
  const legacy = LEGACY[id]?.show;
  if (legacy && typeof settings[legacy] === "boolean") return settings[legacy] as boolean;
  const explicit = settings.reportPrefs?.[id]?.show;
  if (explicit !== undefined) return explicit;
  return olderTypeListAllows(settings, id);
}

// The older per-type list (Live alerts' report types) is the default until this item is
// switched here: a type someone turned off there stays off.
function olderTypeListAllows(settings: Partial<AppSettings>, id: ReportItemId): boolean {
  const types = settings.visibleAlertTypes;
  if (!Array.isArray(types)) return true;
  const community = (Object.keys(COMMUNITY_ITEM) as AlertType[]).filter((t) => COMMUNITY_ITEM[t] === id);
  return !(community.length > 0 && community.every((t) => !types.includes(t)));
}

/**
 * Should a pin of this item be drawn? Items without a "Show on map" toggle (other hazards, bad
 * weather) are always drawn when there's data; the rest follow their toggle.
 */
export function drawnOnMap(settings: Pick<AppSettings, "reportPrefs"> & Partial<AppSettings>, id: ReportItemId): boolean {
  const item = REPORT_ITEM_BY_ID[id];
  return item.show ? isShown(settings, id) : olderTypeListAllows(settings, id);
}

/** Does this item alert while driving? */
export function alertsWhileDriving(settings: Pick<AppSettings, "reportPrefs"> & Partial<AppSettings>, id: ReportItemId): boolean {
  const item = REPORT_ITEM_BY_ID[id];
  if (!item.alert) return false;
  const legacy = LEGACY[id]?.alert;
  if (legacy && typeof settings[legacy] === "boolean") return settings[legacy] as boolean;
  return settings.reportPrefs?.[id]?.alert ?? item.alertDefault ?? true;
}

/** The settings patch for flipping one toggle. */
export function prefPatch(settings: Pick<AppSettings, "reportPrefs">, id: ReportItemId, which: "show" | "alert", value: boolean): Partial<AppSettings> {
  const legacy = LEGACY[id]?.[which];
  if (legacy) return { [legacy]: value } as Partial<AppSettings>;
  const prefs: ReportPrefs = { ...(settings.reportPrefs ?? {}) };
  prefs[id] = { ...(prefs[id] ?? {}), [which]: value };
  return { reportPrefs: prefs };
}

// ---- which item a piece of real data belongs to --------------------------------------------

export const COMMUNITY_ITEM: Record<AlertType, ReportItemId> = {
  police: "police",
  crash: "crash",
  hazard: "otherHazards",
  camera: "mobilePoliceCamera",
  traffic_light: "trafficLights",
  emergency_vehicle: "emergencyVehicles",
};

/** A Live Traffic NSW incident -> the list item it belongs to (by TfNSW's own kind/category). */
export function liveTrafficItem(incident: Pick<TrafficIncident, "kind" | "category" | "headline">): ReportItemId {
  const text = `${incident.category} ${incident.headline}`.toLowerCase();
  if (incident.kind === "roadwork") return "roadwork";
  if (incident.kind === "flood" || /\b(flood|fog|storm|snow|ice|wind|weather)\w*/.test(text)) return "badWeather";
  if (/\banimal|livestock|stock on road|kangaroo/.test(text)) return "animals";
  if (/\blane\b.*\b(clos|block)|\b(clos|block)\w*\b.*\blane/.test(text)) return "blockedLane";
  if (/\bclos(ed|ure)/.test(text)) return "closures";
  if (/\bcrash|collision|accident/.test(text)) return "crash";
  if (/\bbreakdown|broken down/.test(text)) return "carOnShoulder";
  if (/\btraffic\b|congestion/.test(text)) return "traffic";
  return "otherHazards";
}

/** Items in a section, in list order. */
export function itemsIn(section: ReportSection): ReportItem[] {
  return REPORT_ITEMS.filter((i) => i.section === section);
}

export const SECTION_ORDER: ReportSection[] = ["speedCameras", "laneCameras", "behaviourCameras", "roadFeatures", "reports", "hazards"];

// ---- OpenStreetMap-fed items ----------------------------------------------------------------

/** The OSM feature kinds (services/osmTrafficData.ts) each map to an item of the same name. */
export const OSM_ITEM_KINDS: readonly OsmFeatureKind[] = OSM_FEATURE_KINDS;

/** What to fetch from OpenStreetMap now: anything shown on the map or alerting while driving. */
export function osmFetchWanted(settings: Pick<AppSettings, "reportPrefs"> & Partial<AppSettings>): { trafficLights: boolean; speedCameras: boolean; features: OsmFeatureKind[] } {
  return {
    trafficLights: isShown(settings, "trafficLights") || alertsWhileDriving(settings, "trafficLights"),
    speedCameras: isShown(settings, "speedCamera") || alertsWhileDriving(settings, "speedCamera"),
    features: OSM_ITEM_KINDS.filter((k) => isShown(settings, k) || alertsWhileDriving(settings, k)),
  };
}

/** Is anything at all wanted from OpenStreetMap? */
export function anyOsmWanted(settings: Pick<AppSettings, "reportPrefs"> & Partial<AppSettings>): boolean {
  const w = osmFetchWanted(settings);
  return w.trafficLights || w.speedCameras || w.features.length > 0;
}

// ---- route-derived items ---------------------------------------------------------------------

/** A route step's manoeuvre kind (nav/manoeuvre.ts) -> the Reports item that controls it. */
export function routeItemFor(kind: string | undefined): ReportItemId | null {
  if (kind === "complex") return "complexIntersection";
  if (kind === "merge") return "multiLaneMerge";
  return null;
}

// ---- driver reports of any item -----------------------------------------------------------

/** Which item a driver report is: its own `item`, or (older reports) its base type's item. */
export function itemOfAlert(alert: { type: AlertType; item?: string | null }): ReportItemId {
  const item = alert.item as ReportItemId | undefined;
  return item && REPORT_ITEM_BY_ID[item] ? item : COMMUNITY_ITEM[alert.type];
}
