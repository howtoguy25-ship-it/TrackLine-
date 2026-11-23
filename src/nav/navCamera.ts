// The driving camera, Waze-style: low 3D (pitch 45), heading-up, zoom by speed, with the arrow at
// about 70% of the screen height so the road ahead fills the view. One definition used by every
// place that puts the camera into the follow view (Go now, re-centre, after a manoeuvre,
// after placing a report), so they can't drift apart again. Pure; tested in
// __tests__/nav/navCamera.test.ts.
import { speedZoomFor } from "@/map/speedZoom";
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
