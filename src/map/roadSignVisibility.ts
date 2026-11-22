// Which traffic lights and cameras the map draws OFF a drive (home map and route preview), as
// our own road-sign icons (components/art/RoadSignArt.tsx):
//   * cameras (speed, red light, phone, seat belt, safe distance...) from zoom CAMERA_MIN_ZOOM --
//     like a driving app, you can see where they are before you set off
//   * traffic lights only from TRAFFIC_LIGHT_MIN_ZOOM (street level), where there's room for them
//   * only inside the view, nearest the centre first, at most MAX_SIGNS_PER_KIND of each
//   * every other road feature (bumps, crossings, bends...) stays an alert only (nav/roadFeatureAlerts.ts)
//   * while navigating nothing here: the route-ahead icons and the alert chip take over
// Each item's own Settings > Reports "Show on map" switch still decides. Pure; tested in
// __tests__/map/roadSignVisibility.test.ts.
import { REPORT_ITEM_BY_ID, type ReportItemId } from "@/settings/reportCatalog";

export const CAMERA_MIN_ZOOM = 12;
export const TRAFFIC_LIGHT_MIN_ZOOM = 15;
export const MAX_SIGNS_PER_KIND = 40;

export interface SignPoint {
  key: string;
  item: ReportItemId;
  lat: number;
  lng: number;
}

export interface MapView {
  latitude: number;
  longitude: number;
  /** The latitude span on screen. */
  latitudeDelta: number;
  zoom: number;
}

export type SignKind = "camera" | "trafficLight" | "other";

export function signKind(item: ReportItemId): SignKind {
  if (item === "trafficLights") return "trafficLight";
  const section = REPORT_ITEM_BY_ID[item]?.section;
  return section === "speedCameras" || section === "laneCameras" || section === "behaviourCameras" ? "camera" : "other";
}

/** The map image each sign is drawn with (map-v2/layers/MapIcons.tsx). */
export function signIcon(item: ReportItemId): string {
  if (item === "trafficLights") return "traffic-light";
  if (item === "speedCamera") return "speed-camera";
  return `feature:${item}`;
}

function inView(p: SignPoint, v: MapView): boolean {
  const halfLat = v.latitudeDelta * 0.6;
  // A portrait phone shows less longitude than latitude; this is a generous bound either way.
  const halfLng = halfLat / Math.max(0.2, Math.cos((v.latitude * Math.PI) / 180));
  return Math.abs(p.lat - v.latitude) <= halfLat && Math.abs(p.lng - v.longitude) <= halfLng;
}

export function homeRoadSigns(
  points: readonly SignPoint[],
  view: MapView | null,
  opts: { navigating: boolean; shown: (item: ReportItemId) => boolean }
): SignPoint[] {
  if (opts.navigating || !view) return [];
  const byKind: Record<"camera" | "trafficLight", { p: SignPoint; d: number }[]> = { camera: [], trafficLight: [] };
  const cosLat = Math.cos((view.latitude * Math.PI) / 180);
  for (const p of points) {
    const kind = signKind(p.item);
    if (kind === "other") continue;
    if (view.zoom < (kind === "camera" ? CAMERA_MIN_ZOOM : TRAFFIC_LIGHT_MIN_ZOOM)) continue;
    if (!opts.shown(p.item) || !inView(p, view)) continue;
    const d = (p.lat - view.latitude) ** 2 + ((p.lng - view.longitude) * cosLat) ** 2;
    byKind[kind].push({ p, d });
  }
  const pick = (list: { p: SignPoint; d: number }[]) => list.sort((a, b) => a.d - b.d).slice(0, MAX_SIGNS_PER_KIND).map((x) => x.p);
  return [...pick(byKind.camera), ...pick(byKind.trafficLight)];
}
