// The driving camera, Waze-style: low 3D (pitch 45), heading-up, zoom by speed, with the arrow at
// about 70% of the screen height so the road ahead fills the view. One definition used by every
// place that puts the camera into the follow view (Go now, re-centre, after a manoeuvre,
// after placing a report), so they can't drift apart again. Pure; tested in
// __tests__/nav/navCamera.test.ts.
import { speedZoomFor } from "@/map/speedZoom";
import { bearingDegrees } from "@/utils/geo";
import type { LatLng } from "@/utils/polyline";

export const NAV_FOLLOW_PITCH = 45;
/** Go now: the animation into the follow view. */
export const NAV_START_MS = 1200;
/** Where the arrow sits, as a share of the screen height from the top. */
export const NAV_ARROW_FRACTION = 0.7;
export const NAV_FLAT_ZOOM = 17;

export interface NavPose {
  center: LatLng;
  heading: number;
  pitch: number;
  zoom: number;
}

/** The follow view (or the flat one if the driver picked "Overhead"). */
export function navFollowPose(center: LatLng, heading: number, speedKmh: number | null | undefined, flat = false): NavPose {
  return flat ? { center, heading, pitch: 0, zoom: NAV_FLAT_ZOOM } : { center, heading, pitch: NAV_FOLLOW_PITCH, zoom: speedZoomFor(speedKmh) };
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
