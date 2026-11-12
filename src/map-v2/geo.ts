// Pure helpers for the Mapbox map: turning the app's {latitude, longitude} shapes into GeoJSON,
// camera maths (zoom <-> region size, bounds), and radius-in-metres circles. No React Native
// imports -- unit-tested in __tests__/mapV2.test.ts.

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

export type Position = [number, number];

export function toPosition(p: LatLng): Position {
  return [p.longitude, p.latitude];
}

export function fromPosition(p: readonly number[]): LatLng {
  return { latitude: p[1], longitude: p[0] };
}

export interface LineFeature {
  type: "Feature";
  id?: string;
  properties: Record<string, unknown>;
  geometry: { type: "LineString"; coordinates: Position[] };
}

export interface PointFeature {
  type: "Feature";
  id?: string;
  properties: Record<string, unknown>;
  geometry: { type: "Point"; coordinates: Position };
}

export interface FeatureCollection<F> {
  type: "FeatureCollection";
  features: F[];
}

export function lineFeature(id: string, coords: LatLng[], properties: Record<string, unknown> = {}): LineFeature {
  return { type: "Feature", id, properties: { id, ...properties }, geometry: { type: "LineString", coordinates: coords.map(toPosition) } };
}

export function pointFeature(id: string, at: LatLng, properties: Record<string, unknown> = {}): PointFeature {
  return { type: "Feature", id, properties: { id, ...properties }, geometry: { type: "Point", coordinates: toPosition(at) } };
}

export function collection<F>(features: F[]): FeatureCollection<F> {
  return { type: "FeatureCollection", features };
}

/** A LineString needs two points; Mapbox rejects a shorter one. */
export function isDrawableLine(coords: readonly LatLng[]): boolean {
  return coords.length >= 2;
}

// ---------------------------------------------------------------------------------------------
// Camera maths (Web Mercator, 512px Mapbox tiles)

const TILE = 512;

/** Zoom level that shows `latitudeDelta` degrees across a map `heightPx` tall. */
export function zoomForLatitudeDelta(latitudeDelta: number, heightPx = 800): number {
  const delta = Math.max(1e-6, Math.min(170, latitudeDelta));
  return Math.max(0, Math.min(22, Math.log2((360 * heightPx) / (TILE * delta))));
}

/** The inverse of zoomForLatitudeDelta. */
export function latitudeDeltaForZoom(zoom: number, heightPx = 800): number {
  return (360 * heightPx) / (TILE * 2 ** zoom);
}

/** A region (centre + span) from a camera's visible bounds. */
export function regionFromBounds(ne: readonly number[], sw: readonly number[]): Region {
  const north = ne[1];
  const south = sw[1];
  let east = ne[0];
  const west = sw[0];
  if (east < west) east += 360; // crosses the antimeridian
  let longitude = (east + west) / 2;
  if (longitude > 180) longitude -= 360;
  return {
    latitude: (north + south) / 2,
    longitude,
    latitudeDelta: Math.abs(north - south),
    longitudeDelta: Math.abs(east - west),
  };
}

/** The [ne, sw] corners of a region. */
export function boundsOfRegion(region: Region): { ne: Position; sw: Position } {
  return {
    ne: [region.longitude + region.longitudeDelta / 2, region.latitude + region.latitudeDelta / 2],
    sw: [region.longitude - region.longitudeDelta / 2, region.latitude - region.latitudeDelta / 2],
  };
}

/** The [ne, sw] corners around a set of points, or null for none. */
export function boundsOfPoints(points: readonly LatLng[]): { ne: Position; sw: Position } | null {
  if (points.length === 0) return null;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const p of points) {
    north = Math.max(north, p.latitude);
    south = Math.min(south, p.latitude);
    east = Math.max(east, p.longitude);
    west = Math.min(west, p.longitude);
  }
  return { ne: [east, north], sw: [west, south] };
}

/** Metres covered by one screen point at a zoom and latitude. */
export function metersPerPoint(zoom: number, latitude: number): number {
  return (40_075_016.686 * Math.cos((latitude * Math.PI) / 180)) / (TILE * 2 ** zoom);
}

/**
 * A `circle-radius` expression that keeps a circle `meters` across on the ground at every zoom
 * (Mapbox circle radii are in screen points). Exponential base 2 between z0 and z22 is exact.
 */
export function metersRadiusExpression(meters: number, latitude: number): unknown[] {
  return ["interpolate", ["exponential", 2], ["zoom"], 0, meters / metersPerPoint(0, latitude), 22, meters / metersPerPoint(22, latitude)];
}

// ---------------------------------------------------------------------------------------------
// Route geometry

function metersBetween(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLng = (b.longitude - a.longitude) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a to b, 0-360. */
export function bearingBetween(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const y = Math.sin((b.longitude - a.longitude) * toRad) * Math.cos(b.latitude * toRad);
  const x =
    Math.cos(a.latitude * toRad) * Math.sin(b.latitude * toRad) -
    Math.sin(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.cos((b.longitude - a.longitude) * toRad);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Splits a route at the point nearest the car: the part already driven (drawn faded) and the
 * part still ahead.
 */
export function splitRouteAt(route: readonly LatLng[], at: LatLng | null): { travelled: LatLng[]; ahead: LatLng[] } {
  if (!at || route.length < 2) return { travelled: [], ahead: route.slice() };
  let best = 0;
  let bestDist = Infinity;
  route.forEach((p, i) => {
    const d = metersBetween(p, at);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return { travelled: [...route.slice(0, best + 1), at], ahead: [at, ...route.slice(best + 1)] };
}

/**
 * The little arrow drawn on the route at a turn: the stretch of route from `before` metres ahead
 * of the turn point to `after` metres past it (both measured along the route).
 */
export function turnArrowAt(route: readonly LatLng[], turn: LatLng, before = 30, after = 25): LatLng[] {
  if (route.length < 2) return [];
  let ti = 0;
  let td = Infinity;
  route.forEach((p, i) => {
    const d = metersBetween(p, turn);
    if (d < td) {
      td = d;
      ti = i;
    }
  });
  const out: LatLng[] = [route[ti]];
  let walked = 0;
  for (let i = ti; i > 0 && walked < before; i--) {
    walked += metersBetween(route[i], route[i - 1]);
    out.unshift(route[i - 1]);
  }
  walked = 0;
  for (let i = ti; i < route.length - 1 && walked < after; i++) {
    walked += metersBetween(route[i], route[i + 1]);
    out.push(route[i + 1]);
  }
  return out.length >= 2 ? out : [];
}

// ---------------------------------------------------------------------------------------------
// Camera state

export interface CameraLike {
  center: LatLng;
  heading: number;
  pitch: number;
  zoom: number;
}

/**
 * The app's camera code was tuned on Google's zoom levels (256px tiles). Mapbox tiles are 512px,
 * so the same ground scale is one Mapbox zoom level lower. The map handle converts at the edge,
 * so every tuned value (follow zoom 17, chase-cam 18.5, ...) keeps looking the same.
 */
export const MAPBOX_ZOOM_OFFSET = -1;
export function mapboxZoomFromGoogle(zoom: number): number {
  return Math.max(0, Math.min(22, zoom + MAPBOX_ZOOM_OFFSET));
}
export function googleZoomFromMapbox(zoom: number): number {
  return zoom - MAPBOX_ZOOM_OFFSET;
}

/** What the old map's animateCamera() call asked for (Google zoom), as a Mapbox camera stop. */
export function cameraStopFrom(
  camera: Partial<CameraLike>,
  durationMs: number | undefined
): { centerCoordinate?: Position; heading?: number; pitch?: number; zoomLevel?: number; animationDuration: number; animationMode: "easeTo" | "none" } {
  const duration = durationMs ?? 500;
  return {
    ...(camera.center ? { centerCoordinate: toPosition(camera.center) } : {}),
    ...(camera.heading != null ? { heading: ((camera.heading % 360) + 360) % 360 } : {}),
    ...(camera.pitch != null ? { pitch: Math.max(0, Math.min(85, camera.pitch)) } : {}),
    ...(camera.zoom != null ? { zoomLevel: mapboxZoomFromGoogle(camera.zoom) } : {}),
    animationDuration: duration,
    animationMode: duration > 0 ? "easeTo" : "none",
  };
}
