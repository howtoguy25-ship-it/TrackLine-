// The driving camera, Waze-style: low 3D (pitch 45), heading-up, zoom by speed, with the arrow at
// about 70% of the screen height so the road ahead fills the view. One definition used by every
// place that puts the camera into the follow view (Go now, re-centre, after a manoeuvre,
// after placing a report), so they can't drift apart again. Pure; tested in
// __tests__/nav/navCamera.test.ts.
import { bearingDegrees } from "@/utils/geo";
import type { LatLng } from "@/utils/polyline";

export const NAV_FOLLOW_PITCH = 45;
/** Go now: the animation into the follow view. */
export const NAV_START_MS = 1200;
/** Where the arrow sits, as a share of the screen height from the top (fix pass 5 §4: ~72%). */
export const NAV_ARROW_FRACTION = 0.72;
export const NAV_FLAT_ZOOM = 17;

export interface NavPose {
  center: LatLng;
  heading: number;
  pitch: number;
  zoom: number;
}

// ---- Fix pass 5 §4: zoom by speed so ~300-500 m of road ahead is in view ----
/** Mapbox GL's vertical field of view (radians). */
const MAPBOX_FOV = 0.6435011087932844;
/** Road ahead to keep in view, by speed band (changes only when a band is crossed). */
export const AHEAD_BANDS: { maxKmh: number; metres: number }[] = [
  { maxKmh: 40, metres: 300 },
  { maxKmh: 80, metres: 400 },
  { maxKmh: Infinity, metres: 500 },
];
export function aheadTargetMetres(speedKmh: number | null | undefined): number {
  const v = speedKmh != null && Number.isFinite(speedKmh) ? speedKmh : 0;
  return (AHEAD_BANDS.find((b) => v <= b.maxKmh) ?? AHEAD_BANDS[AHEAD_BANDS.length - 1]).metres;
}

/**
 * Metres of road visible from the arrow to the top edge of the screen: the camera's geometry
 * (Mapbox FOV, `pitch`, the arrow at `arrowFraction` of the height) at a Google-scale `zoom`.
 */
export function metresAheadVisible(zoom: number, pitchDeg: number, screenHeight: number, latitude: number, arrowFraction = NAV_ARROW_FRACTION): number {
  const mapboxZoom = zoom - 1;
  const metresPerPx = (40075016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** mapboxZoom);
  const d = (0.5 * screenHeight) / Math.tan(MAPBOX_FOV / 2);
  const beta = Math.atan((arrowFraction * screenHeight) / d);
  const p = (pitchDeg * Math.PI) / 180;
  if (p + beta >= Math.PI / 2 - 0.01) return Infinity;
  const aheadPx = d * Math.cos(p) * Math.tan(p + beta) - d * Math.sin(p);
  return aheadPx * metresPerPx;
}

/** The driving zoom (Google scale, quarter steps) that shows the speed band's road ahead. */
export function navZoomForSpeed(speedKmh: number | null | undefined, screenHeight = 844, latitude = -33.9): number {
  const atZero = metresAheadVisible(0, NAV_FOLLOW_PITCH, screenHeight, latitude);
  const z = Math.log2(atZero / aheadTargetMetres(speedKmh));
  return Math.round(Math.max(14, Math.min(20, z)) * 4) / 4;
}

/** The follow view (or the flat one if the driver picked "Overhead"). */
export function navFollowPose(center: LatLng, heading: number, speedKmh: number | null | undefined, flat = false, screenHeight = 844): NavPose {
  return flat
    ? { center, heading, pitch: 0, zoom: NAV_FLAT_ZOOM }
    : { center, heading, pitch: NAV_FOLLOW_PITCH, zoom: navZoomForSpeed(speedKmh, screenHeight, center.latitude) };
}

/**
 * Top padding that puts the camera's centre (the arrow) at NAV_ARROW_FRACTION of the height.
 * `reservedBottom`: a panel over the bottom of the map (the live road view): the arrow then sits at
 * that fraction of the map left above it.
 */
export function navFollowPadding(windowHeight: number, reservedBottom = 0): { top: number; right: number; bottom: number; left: number } {
  // The centre of the padded area is (H - r + top) / 2; solve for NAV_ARROW_FRACTION * (H - r).
  const h = windowHeight - reservedBottom;
  return { top: Math.round(h * (2 * NAV_ARROW_FRACTION - 1)), right: 0, bottom: reservedBottom, left: 0 };
}

/** Raised buildings while driving: only when the driver turned 3D buildings on. */
export function navBuildingsRaised(show3DBuildings: boolean): boolean {
  return show3DBuildings;
}

/** The purple street callout shows only at the next manoeuvre, and not when it would sit on the arrow. */
export const CALLOUT_HIDE_WITHIN_M = 45;
export function showManoeuvreCallout(metersToManoeuvre: number | null): boolean {
  return metersToManoeuvre != null && metersToManoeuvre > CALLOUT_HIDE_WITHIN_M;
}

/**
 * Permanent fix §4: the bearing the drive starts facing -- the route segment you're on (the
 * nearest one to where you are), so the map faces the road before you've moved a metre. The GPS
 * course is meaningless while parked, and the compass points wherever the phone happens to.
 */
export function navStartBearing(polyline: LatLng[], at: LatLng | null): number | null {
  let best: { d: number; bearing: number } | null = null;
  const cosLat = Math.cos(((at?.latitude ?? polyline[0]?.latitude ?? 0) * Math.PI) / 180);
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    if (a.latitude === b.latitude && a.longitude === b.longitude) continue;
    const bearing = bearingDegrees(a.latitude, a.longitude, b.latitude, b.longitude);
    if (!at) return bearing;
    // Distance from `at` to segment ab, on a local flat projection (fine at street scale).
    const ax = a.longitude * cosLat, ay = a.latitude, bx = b.longitude * cosLat, by = b.latitude;
    const px = at.longitude * cosLat, py = at.latitude;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (!best || d < best.d) best = { d, bearing };
  }
  return best?.bearing ?? null;
}

/**
 * Which way the driving camera faces. North-up only when the driver asked for it (Settings > Keep
 * map north up, or North up in the view menu for this drive); otherwise the road: the matched
 * route segment's bearing when on the route, else the filtered heading.
 */
export function navCameraBearing(o: { keepNorthUp: boolean; navNorthUp: boolean; roadBearing: number | null; heading: number }): number {
  if (o.keepNorthUp || o.navNorthUp) return 0;
  return o.roadBearing ?? o.heading;
}
