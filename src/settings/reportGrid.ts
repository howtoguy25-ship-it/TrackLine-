// The report grid (the "+" Report button): every item a driver can report, in categories, each
// with its own icon. A category with one item reports it straight away; the others open their
// item list. Speed limits and school zones open the road report sheet (RoadReportSheet).
// Base types and the server's rules come from the same policy.json the server enforces.
import POLICY from "../../firebase/functions/reports/policy.json";
import type { AlertType } from "@/types/alert";
import type { ReportItemId } from "@/settings/reportCatalog";

export type ReportCategoryId = "police" | "crash" | "traffic" | "camera" | "hazard" | "roadFeature" | "emergency" | "mapChat" | "help" | "roadSigns";

export interface ReportCategory {
  id: ReportCategoryId;
  title: string;
  /** Icon: the item whose icon stands for the category. */
  iconItem: ReportItemId;
  items: ReportItemId[];
  /** Opens the speed limit / school zone sheet instead of placing a pin. */
  roadSheet?: boolean;
}

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  { id: "police", title: "Police", iconItem: "police", items: ["police"] },
  { id: "crash", title: "Crash", iconItem: "crash", items: ["crash"] },
  { id: "traffic", title: "Traffic", iconItem: "traffic", items: ["traffic", "suddenSlowdown"] },
  {
    id: "camera",
    title: "Camera",
    iconItem: "speedCamera",
    items: ["speedCamera", "redLightCamera", "redLightSpeedCamera", "stopSignCamera", "mobilePoliceCamera", "transitLaneCamera", "carpoolLaneCamera", "busLaneCamera", "mobilePhoneCamera", "noiseCamera", "safeDistanceCamera", "seatBeltCamera"],
  },
  { id: "hazard", title: "Hazard", iconItem: "otherHazards", items: ["otherHazards", "pothole", "looseGravel", "tramTracks", "carOnShoulder", "blockedLane", "badWeather", "animals", "roadwork", "closures"] },
  {
    id: "roadFeature",
    title: "Road feature",
    iconItem: "railwayCrossing",
    items: ["railwayCrossing", "trafficLights", "tollBooth", "speedBump", "sharpCurve", "complexIntersection", "multiLaneMerge", "laneEnding", "raisedCrossing", "pedestrianCrossing", "shoulderEnding", "narrowBridge"],
  },
  { id: "emergency", title: "Emergency vehicle", iconItem: "emergencyVehicles", items: ["emergencyVehicles"] },
  { id: "mapChat", title: "Map chat", iconItem: "mapChats", items: ["mapChats"] },
  { id: "help", title: "I need help", iconItem: "trackyNeedsHelp", items: ["trackyNeedsHelp"] },
  { id: "roadSigns", title: "Speed limit / school zone", iconItem: "speedLimitChanges", items: ["speedLimitChanges", "schoolZones"], roadSheet: true },
];

type ItemPolicy = { type: AlertType; fixed?: boolean; needsComment?: boolean };
const ITEMS = POLICY.items as Record<string, ItemPolicy>;

/** The base type a report of this item is filed under (police, hazard, camera...). */
export function baseTypeOf(item: ReportItemId): AlertType | null {
  return ITEMS[item]?.type ?? null;
}

/** Fixed cameras and road features: kept for good once 3 drivers confirm (or an admin approves). */
export function isFixedItem(item: ReportItemId): boolean {
  return !!ITEMS[item]?.fixed;
}

export function needsComment(item: ReportItemId): boolean {
  return !!ITEMS[item]?.needsComment;
}

/** Shown in the grid under an item's tile. Some read better as what you saw. */
export const GRID_LABEL: Partial<Record<ReportItemId, string>> = {
  traffic: "Heavy traffic",
  suddenSlowdown: "Standstill",
  trafficLights: "Traffic light out",
  otherHazards: "Object on road",
  trackyNeedsHelp: "I need help",
  speedLimitChanges: "Speed limit",
};

/** Derived only (built from records, never reported directly). */
export const DERIVED_ONLY: readonly ReportItemId[] = ["crashHistory"];
