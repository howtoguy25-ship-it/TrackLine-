// What kinds of thing the "ahead" alerts warn about, how important each is, and how each
// Settings > Reports item, driver report and Live Traffic NSW incident maps onto one.
// Our own wording throughout. Pure; tested in __tests__/nav/aheadAlerts.test.ts.
import { REPORT_ITEM_BY_ID, type ReportItemId } from "@/settings/reportCatalog";

export type AheadKind =
  | "closure"
  | "crash"
  | "standstill"
  | "police"
  | "hazard"
  | "brokenLight"
  | "object"
  | "emergency"
  | "carOnShoulder"
  | "weather"
  | "slowdown"
  | "camera"
  | "schoolZone"
  | "roadwork"
  | "heavyTraffic"
  | "hump"
  | "crossing"
  | "curve"
  | "toll"
  | "signal"
  | "roadFeature";

/** Lower comes first: closure/crash/standstill > police/hazard/... > cameras/school > roadwork/traffic > road features. */
export const KIND_TIER: Record<AheadKind, number> = {
  closure: 0,
  crash: 0,
  standstill: 0,
  police: 1,
  hazard: 1,
  brokenLight: 1,
  object: 1,
  emergency: 1,
  carOnShoulder: 1,
  weather: 1,
  slowdown: 1,
  camera: 2,
  schoolZone: 2,
  roadwork: 3,
  heavyTraffic: 3,
  hump: 4,
  crossing: 4,
  curve: 4,
  toll: 4,
  signal: 4,
  roadFeature: 4,
};

/** Critical: the longest warning, a reminder at ~150 m, the chime, and spoken even when "less chatty". */
export const CRITICAL_KINDS: ReadonlySet<AheadKind> = new Set(["closure", "crash", "standstill", "brokenLight", "object"]);
/** Minor road features: a shorter warning and a 6 s banner. */
export const MINOR_KINDS: ReadonlySet<AheadKind> = new Set(["hump", "crossing", "curve", "signal"]);

export const KIND_TITLE: Record<AheadKind, string> = {
  closure: "Road closed",
  crash: "Crash",
  standstill: "Standstill traffic",
  police: "Police",
  hazard: "Hazard",
  brokenLight: "Traffic light not working",
  object: "Object on road",
  emergency: "Emergency vehicle",
  carOnShoulder: "Car on shoulder",
  weather: "Bad weather",
  slowdown: "Sudden slowdown",
  camera: "Speed camera",
  schoolZone: "School zone",
  roadwork: "Roadwork",
  heavyTraffic: "Heavy traffic",
  hump: "Speed hump",
  crossing: "Crossing",
  curve: "Sharp curve",
  toll: "Toll point",
  signal: "Traffic lights",
  roadFeature: "Road feature",
};

/** The spoken line (one per alert, when its banner first appears). */
export function spokenLine(kind: AheadKind, title: string, delayMin: number | null): string {
  switch (kind) {
    case "heavyTraffic":
      return delayMin && delayMin >= 1 ? `Heavy traffic ahead, about ${numberWord(delayMin)} minute${delayMin === 1 ? "" : "s"}` : "Heavy traffic ahead";
    case "standstill":
      return "Traffic stopped ahead";
    case "crash":
    case "police":
    case "hazard":
    case "object":
    case "carOnShoulder":
      return `${title} reported ahead`;
    case "emergency":
      return "Emergency vehicle ahead, move aside safely";
    case "closure":
      return "Road closed ahead";
    default:
      return `${title} ahead`;
  }
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function numberWord(n: number): string {
  return WORDS[n] ?? String(n);
}

/** A Settings > Reports item as an ahead kind (null: not something to warn about on the road). */
export function kindOfItem(item: ReportItemId, fromDriverReport: boolean): AheadKind | null {
  const section = REPORT_ITEM_BY_ID[item]?.section;
  if (section === "speedCameras" || section === "laneCameras" || section === "behaviourCameras") return "camera";
  switch (item) {
    case "railwayCrossing":
    case "pedestrianCrossing":
    case "raisedCrossing":
      return "crossing";
    case "speedBump":
      return "hump";
    case "sharpCurve":
      return "curve";
    case "tollBooth":
      return "toll";
    case "trafficLights":
      // A driver reporting a traffic light means it's broken; a mapped one is just lights.
      return fromDriverReport ? "brokenLight" : "signal";
    case "schoolZones":
      return "schoolZone";
    case "police":
      return "police";
    case "crash":
      return "crash";
    case "traffic":
      return "heavyTraffic";
    case "suddenSlowdown":
      return "slowdown";
    case "emergencyVehicles":
      return "emergency";
    case "roadwork":
      return "roadwork";
    case "closures":
      return "closure";
    case "blockedLane":
      return "object";
    case "carOnShoulder":
      return "carOnShoulder";
    case "badWeather":
      return "weather";
    case "animals":
    case "otherHazards":
    case "pothole":
    case "looseGravel":
    case "tramTracks":
    case "trackyNeedsHelp":
    case "crashHistory":
      return "hazard";
    case "speedLimitChanges":
    case "mapChats":
      // Speed limit changes have their own sign + voice; chats aren't road alerts.
      return null;
    default:
      return "roadFeature";
  }
}

/** The banner title: the kind's own words, or the item's when it's more specific. */
export function titleFor(kind: AheadKind, item: ReportItemId | null): string {
  if (!item) return KIND_TITLE[kind];
  if (kind === "camera" || kind === "crossing" || kind === "roadFeature") return REPORT_ITEM_BY_ID[item]?.title ?? KIND_TITLE[kind];
  if (kind === "object" && item === "blockedLane") return "Lane blocked";
  if (kind === "hazard" && item === "animals") return "Animal on road";
  if (kind === "hazard" && item === "trackyNeedsHelp") return "Driver needs help";
  if (kind === "hazard" && item === "crashHistory") return "Crash-prone spot";
  if (kind === "hazard" && (item === "pothole" || item === "looseGravel" || item === "tramTracks")) return REPORT_ITEM_BY_ID[item].title;
  return KIND_TITLE[kind];
}
