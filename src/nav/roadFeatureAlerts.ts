// Road features (speed bumps, crossings, railway crossings, school zones, sharp bends, cameras,
// traffic lights...) are alerts, not map clutter:
//   * no dots on the home map or the route preview at all
//   * while navigating, only features ON the route still ahead, within ROUTE_FEATURE_AHEAD_M, get
//     a small icon on the route -- at most MAX_ROUTE_FEATURE_ICONS, nearest first -- and only the
//     ones whose "Show on map" switch is on (it now means "show its icon on the route")
//   * the alert chip under the top bar ("Speed bump ahead · 200 m") counts down from the car's
//     real progress along the route and goes once it's passed; one chip at a time, nearest first
//   * the voice says it once at about VOICE_AT_M, if "Alert while driving" is on for it
// Pure; tested in __tests__/nav/roadFeatureAlerts.test.ts.
import { projectOnPolyline } from "@/alerts/approachAlerts";
import { REPORT_ITEM_BY_ID, type ReportItemId } from "@/settings/reportCatalog";
import { formatDistance, type DistanceUnit } from "@/utils/navFormat";

export const ROUTE_FEATURE_AHEAD_M = 1000;
export const MAX_ROUTE_FEATURE_ICONS = 3;
/** How far off the route line a feature can be and still be on it. */
export const ROUTE_FEATURE_CORRIDOR_M = 30;
export const VOICE_AT_M = 300;

export interface RouteFeature {
  key: string;
  item: ReportItemId;
  lat: number;
  lng: number;
}

export interface FeatureAhead extends RouteFeature {
  /** Metres from the car to the feature, along the route. */
  aheadM: number;
  /** Distance along the whole route (for live countdowns as the car moves). */
  alongM: number;
}

/** Features on the route ahead of `carAlongM`, within `maxAheadM`, nearest first. */
export function routeFeaturesAhead(
  features: readonly RouteFeature[],
  polyline: { latitude: number; longitude: number }[],
  carAlongM: number,
  maxAheadM = ROUTE_FEATURE_AHEAD_M
): FeatureAhead[] {
  const out: FeatureAhead[] = [];
  for (const f of features) {
    const p = projectOnPolyline(polyline, { latitude: f.lat, longitude: f.lng });
    if (!p || p.offM > ROUTE_FEATURE_CORRIDOR_M) continue;
    const aheadM = p.alongM - carAlongM;
    if (aheadM <= 0 || aheadM > maxAheadM) continue;
    out.push({ ...f, aheadM, alongM: p.alongM });
  }
  return out.sort((a, b) => a.aheadM - b.aheadM);
}

/** The icons drawn on the route: "Show on map" on, nearest first, at most three. */
export function routeFeatureIcons(ahead: readonly FeatureAhead[], shown: (item: ReportItemId) => boolean): FeatureAhead[] {
  return ahead.filter((f) => shown(f.item)).slice(0, MAX_ROUTE_FEATURE_ICONS);
}

/** "Speed bump ahead · 200 m", counting down from the car's live progress. */
export function featureChipText(item: ReportItemId, aheadM: number, unit: DistanceUnit): string {
  return `${REPORT_ITEM_BY_ID[item].title} ahead · ${formatDistance(Math.max(0, aheadM), unit)}`;
}

/** Live distance to a chip's feature; null once it has been passed (the chip goes). */
export function chipRemainingM(featureAlongM: number, carAlongM: number): number | null {
  const left = featureAlongM - carAlongM;
  return left > 0 ? left : null;
}

/** Say it once, the first time it's within VOICE_AT_M. */
export function shouldSpeakFeature(aheadM: number, alreadySpoken: boolean): boolean {
  return !alreadySpoken && aheadM <= VOICE_AT_M;
}
