// Which pins Settings > Reports lets onto the map, after merging sources. Pure: MapScreen draws
// whatever these return, the approach alerts use the same merge, and the tests check every
// "Show on map" switch against them.
//
// The same thing from several sources is shown once, best source first:
//   official (Live Traffic NSW)  >  confirmed driver report  >  OpenStreetMap  >  unconfirmed report
// e.g. a driver's report of roadwork Live Traffic NSW already lists is dropped; a mapped OSM speed
// bump that drivers confirmed is drawn as their report (with its confirmations), not twice.
import type { AppSettings } from "@/services/settings";
import type { AlertDoc } from "@/types/alert";
import type { TrafficIncident } from "@/services/trafficNswModel";
import { OSM_FEATURE_KINDS, type OsmFeatureKind, type OsmTrafficData } from "@/services/osmTrafficData";
import { drawnOnMap, isShown, itemOfAlert, liveTrafficItem, type ReportItemId } from "@/settings/reportCatalog";

type Settings = Pick<AppSettings, "reportPrefs"> & Partial<AppSettings>;

/** Same thing, same place: within this of each other. */
export const SAME_PLACE_M = { official: 100, mapped: 40 };

export interface FeaturePin {
  id: string;
  kind: OsmFeatureKind;
  lat: number;
  lng: number;
  /** MapIcons name: "feature:<itemId>". */
  icon: string;
}

type AlertLike = Pick<AlertDoc, "type" | "lat" | "lng"> & { item?: string; confirmCount?: number; permanent?: boolean };
type IncidentLike = Pick<TrafficIncident, "kind" | "category" | "headline" | "lat" | "lng">;

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const confirmed = (a: AlertLike) => !!a.permanent || (a.confirmCount ?? 0) >= 1;

/** Driver reports after the merge: none that an official incident already covers, none
 *  unconfirmed where OpenStreetMap already maps the same thing. */
export function mergedReports<T extends AlertLike>(alerts: readonly T[], others: { incidents?: readonly IncidentLike[]; osm?: OsmTrafficData | null }): T[] {
  return alerts.filter((a) => {
    const item = itemOfAlert(a);
    if ((others.incidents ?? []).some((i) => liveTrafficItem(i) === item && metres(i, a) <= SAME_PLACE_M.official)) return false;
    if (!confirmed(a) && (OSM_FEATURE_KINDS as readonly string[]).includes(item)) {
      const mapped = others.osm?.features[item as OsmFeatureKind] ?? [];
      if (mapped.some((p) => metres(p, a) <= SAME_PLACE_M.mapped)) return false;
    }
    return true;
  });
}

/** OpenStreetMap points after the merge: none where a confirmed driver report sits. */
export function mergedOsmPoints(kind: ReportItemId, points: readonly { id: number; lat: number; lng: number }[], alerts: readonly AlertLike[]) {
  const reports = alerts.filter((a) => confirmed(a) && itemOfAlert(a) === kind);
  if (reports.length === 0) return points;
  return points.filter((p) => !reports.some((a) => metres(a, p) <= SAME_PLACE_M.mapped));
}

/** OpenStreetMap road-feature and camera pins (other than traffic lights / speed cameras). */
export function osmFeaturePins(settings: Settings, osm: OsmTrafficData | null, alerts: readonly AlertLike[] = []): FeaturePin[] {
  if (!osm) return [];
  const pins: FeaturePin[] = [];
  for (const kind of OSM_FEATURE_KINDS) {
    if (!isShown(settings, kind)) continue;
    for (const p of mergedOsmPoints(kind, osm.features[kind] ?? [], alerts)) pins.push({ id: `feature:${kind}:${p.id}`, kind, lat: p.lat, lng: p.lng, icon: `feature:${kind}` });
  }
  return pins;
}

export const showsTrafficLightPins = (settings: Settings) => isShown(settings, "trafficLights");
export const showsSpeedCameraPins = (settings: Settings) => isShown(settings, "speedCamera");

/** Driver reports drawn on the map (switch on, and not covered by a better source). */
export function visibleCommunityAlerts<T extends AlertLike>(settings: Settings, alerts: readonly T[], others: { incidents?: readonly IncidentLike[]; osm?: OsmTrafficData | null } = {}): T[] {
  return mergedReports(alerts, others).filter((a) => drawnOnMap(settings, itemOfAlert(a)));
}

/** Live Traffic NSW incidents drawn on the map. */
export function visibleIncidents<T extends IncidentLike>(settings: Settings, incidents: readonly T[]): T[] {
  if (settings.showLiveTraffic === false) return [];
  return incidents.filter((i) => drawnOnMap(settings, liveTrafficItem(i)));
}

/** The pin icon for a driver report: its type's pin, or its own item's icon when it's a specific item. */
export function reportPinIcon(alert: AlertLike): string {
  const item = itemOfAlert(alert);
  return alert.item && item !== DEFAULT_ITEM_ICON[alert.type] ? `feature:${item}` : `alert:${alert.type}`;
}
const DEFAULT_ITEM_ICON: Record<AlertDoc["type"], ReportItemId> = {
  police: "police",
  crash: "crash",
  hazard: "otherHazards",
  camera: "mobilePoliceCamera",
  traffic_light: "trafficLights",
  emergency_vehicle: "emergencyVehicles",
};
