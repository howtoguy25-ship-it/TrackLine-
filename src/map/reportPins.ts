// Which pins Settings > Reports lets onto the map. Pure: MapScreen draws whatever these return,
// and the tests check every "Show on map" switch against them.
import type { AppSettings } from "@/services/settings";
import type { AlertDoc } from "@/types/alert";
import type { TrafficIncident } from "@/services/trafficNswModel";
import { OSM_FEATURE_KINDS, type OsmFeatureKind, type OsmTrafficData } from "@/services/osmTrafficData";
import { COMMUNITY_ITEM, drawnOnMap, isShown, liveTrafficItem } from "@/settings/reportCatalog";

type Settings = Pick<AppSettings, "reportPrefs"> & Partial<AppSettings>;

export interface FeaturePin {
  id: string;
  kind: OsmFeatureKind;
  lat: number;
  lng: number;
  /** MapIcons name: "feature:<itemId>". */
  icon: string;
}

/** OpenStreetMap road-feature and camera pins (other than traffic lights / speed cameras). */
export function osmFeaturePins(settings: Settings, osm: OsmTrafficData | null): FeaturePin[] {
  if (!osm) return [];
  const pins: FeaturePin[] = [];
  for (const kind of OSM_FEATURE_KINDS) {
    if (!isShown(settings, kind)) continue;
    for (const p of osm.features[kind] ?? []) pins.push({ id: `feature:${kind}:${p.id}`, kind, lat: p.lat, lng: p.lng, icon: `feature:${kind}` });
  }
  return pins;
}

export const showsTrafficLightPins = (settings: Settings) => isShown(settings, "trafficLights");
export const showsSpeedCameraPins = (settings: Settings) => isShown(settings, "speedCamera");

/** Driver reports drawn on the map. */
export function visibleCommunityAlerts<T extends Pick<AlertDoc, "type">>(settings: Settings, alerts: readonly T[]): T[] {
  return alerts.filter((a) => drawnOnMap(settings, COMMUNITY_ITEM[a.type]));
}

/** Live Traffic NSW incidents drawn on the map. */
export function visibleIncidents<T extends Pick<TrafficIncident, "kind" | "category" | "headline">>(settings: Settings, incidents: readonly T[]): T[] {
  if (settings.showLiveTraffic === false) return [];
  return incidents.filter((i) => drawnOnMap(settings, liveTrafficItem(i)));
}
