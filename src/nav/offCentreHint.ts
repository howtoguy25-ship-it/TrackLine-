// Fix pass 5 §4: the "not centred" hint while driving (Apple / Google feel, our design).
// Once you pan, zoom or rotate, the camera is FREE and:
//   * a "Re-centre" pill (arrow icon + word) fades in bottom-left, above the bottom bar;
//   * the compass gets a blue ring when the map no longer faces the way you set it
//     (heading-up: the road; north-up: north).
// Tapping either brings the default view back over 600 ms and the hint fades out. Otherwise the
// compass toggles heading-up <-> north-up with a short toast. Pure; tested in
// __tests__/fixPass5/navHint.test.ts.
import { shortestDelta } from "@/nav/headingFilter";
import type { CameraMode } from "@/map-v2/cameraController";

export const RECENTRE_MS = 600;
export const COMPASS_OFF_DEG = 10;
export const NAV_TOAST_MS = 1600;

/** FREE (panned), and the route overview (the Routes button): Re-centre is the way back. */
export function showRecentrePill(mode: CameraMode, navigating: boolean): boolean {
  return navigating && (mode === "FREE" || mode === "OVERVIEW");
}

/** Blue ring: FREE, and the map is turned more than 10° away from how you set it to face. */
export function compassHighlighted(o: { mode: CameraMode; mapBearing: number; northUp: boolean; roadBearing: number | null }): boolean {
  if (o.mode !== "FREE") return false;
  const wanted = o.northUp ? 0 : (o.roadBearing ?? o.mapBearing);
  return Math.abs(shortestDelta(o.mapBearing, wanted)) > COMPASS_OFF_DEG;
}

export type CompassAction = "recentre" | "northUp" | "headingUp";

/** With the ring on, the compass is the way back; otherwise it switches heading-up / north-up. */
export function compassTapAction(o: { highlighted: boolean; northUp: boolean }): CompassAction {
  if (o.highlighted) return "recentre";
  return o.northUp ? "headingUp" : "northUp";
}

export function compassToast(action: CompassAction): string | null {
  return action === "northUp" ? "North up" : action === "headingUp" ? "Heading up" : null;
}
