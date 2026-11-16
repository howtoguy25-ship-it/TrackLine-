// Which real things on the map can trigger "Alert while driving" right now: every OpenStreetMap
// feature, driver report and Live Traffic NSW incident whose Settings > Reports item has its
// alert switched on. Pure, so the tests can prove each toggle switches its alerts off and on.
import type { AppSettings } from "@/services/settings";
import type { AlertDoc } from "@/types/alert";
import type { TrafficIncident } from "@/services/trafficNswModel";
import { OSM_FEATURE_KINDS, type OsmTrafficData } from "@/services/osmTrafficData";
import { COMMUNITY_ITEM, alertsWhileDriving, liveTrafficItem } from "@/settings/reportCatalog";
import type { ApproachFeature } from "@/alerts/approachAlerts";

export interface FeatureSources {
  osm: OsmTrafficData | null;
  alerts: readonly Pick<AlertDoc, "id" | "type" | "lat" | "lng" | "createdBy">[];
  incidents: readonly Pick<TrafficIncident, "id" | "kind" | "category" | "headline" | "lat" | "lng">[];
  /** The driver's own reports never alert them. */
  ownUid?: string | null;
}

type Settings = Pick<AppSettings, "reportPrefs"> & Partial<AppSettings>;

export function collectApproachFeatures(settings: Settings, src: FeatureSources): ApproachFeature[] {
  const out: ApproachFeature[] = [];
  const osm = src.osm;
  if (osm) {
    if (alertsWhileDriving(settings, "trafficLights")) {
      for (const p of osm.trafficLights) out.push({ key: `osm:trafficLights:${p.id}`, item: "trafficLights", lat: p.lat, lng: p.lng });
    }
    if (alertsWhileDriving(settings, "speedCamera")) {
      for (const p of osm.speedCameras) out.push({ key: `osm:speedCamera:${p.id}`, item: "speedCamera", lat: p.lat, lng: p.lng });
    }
    for (const kind of OSM_FEATURE_KINDS) {
      if (!alertsWhileDriving(settings, kind)) continue;
      for (const p of osm.features[kind] ?? []) out.push({ key: `osm:${kind}:${p.id}`, item: kind, lat: p.lat, lng: p.lng });
    }
  }
  for (const a of src.alerts) {
    if (src.ownUid && a.createdBy === src.ownUid) continue;
    const item = COMMUNITY_ITEM[a.type];
    if (!item || !alertsWhileDriving(settings, item)) continue;
    out.push({ key: `alert:${a.id}`, item, lat: a.lat, lng: a.lng });
  }
  for (const i of src.incidents) {
    const item = liveTrafficItem(i);
    if (!alertsWhileDriving(settings, item)) continue;
    out.push({ key: `ltn:${i.id}`, item, lat: i.lat, lng: i.lng });
  }
  return out;
}
