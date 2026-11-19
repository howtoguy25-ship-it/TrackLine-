// Ending a drive. Every way a drive ends -- Stop in the ETA sheet, long-press on the bottom bar
// (after a short confirm), the voice command "stop navigation", the X on the top bar, and arriving
// (after the "You've arrived" card) -- calls ONE function, MapScreen's exitNavigation(reason), so
// they can't drift apart again. What it must reset is listed here and checked against MapScreen's
// source in __tests__/nav/endDrive.test.ts:
//   * every navigation sheet, search, routes view, alert card, prompt and toast closes (unmounts)
//   * the route, its callouts, bubbles, alternatives and the destination flag leave the map
//   * voice guidance, the approach/lane machine and the manoeuvre zoom stop
//   * the camera eases (1.2 s) back to the LIVE location in the home follow view: pitch 45,
//     home zoom 17, heading-up (or north-up if that's what the home compass is set to); with no
//     fix at that moment it stays put and snaps to the first fix that arrives
//   * the trip's destination goes into Recents; a planned drive's preview state clears
// Pure; the camera and the arrival card timing are tested directly.
import { HOME_FOLLOW_ZOOM } from "@/map/homeMapLogic";
import type { LatLng } from "@/utils/polyline";

export type EndReason = "stop" | "longPress" | "voice" | "exit" | "arrived";

export const HOME_RESET_MS = 1200;
export const HOME_PITCH = 45;
/** The "You've arrived" card stays this long unless tapped. */
export const ARRIVAL_CARD_MS = 5000;

export interface HomePose {
  center: LatLng;
  heading: number;
  pitch: number;
  zoom: number;
}

/** Where the camera goes after a drive; null when there's no live fix yet (wait for one). */
export function homeCameraAfterDrive(live: LatLng | null, headingDeg: number, northUp: boolean): HomePose | null {
  if (!live) return null;
  return { center: live, heading: northUp ? 0 : headingDeg, pitch: HOME_PITCH, zoom: HOME_FOLLOW_ZOOM };
}

/**
 * The state setters / sheet refs exitNavigation must clear -- one for every overlay that can be up
 * while driving. The test reads MapScreen's exitNavigation body and fails if any is missing, so a
 * new driving overlay can't be added without being reset at the end of a drive.
 */
export const NAV_OVERLAY_RESETS = [
  "navOptionsSheetRef.current?.close()",
  "reportSheetRef.current?.close()",
  "soundSheetRef.current?.close()",
  "directionsSheetRef.current?.close()",
  "toolsSheetRef.current?.close()",
  "setSearchAlongOpen(false)",
  "setNavAlternatives(null)",
  "setNavAvoidOpen(false)",
  "setAddingStopDuringNav(false)",
  "setStopPreviewRoute(null)",
  "setStopPreviewPlace(null)",
  "setOverviewMode(false)",
  "setTrafficSuggestionRoute(null)",
  "setFasterRouteBanner(null)",
  "setManoeuvreChip(null)",
  "setAlertCard(null)",
  "setRerouting(false)",
  "setNavNorthUp(false)",
  "setArrival(null)",
  "setRoute(null)",
  "setDestinationLatLng(null)",
  "setStopLocation(null)",
  "setAcceptedSuggestionOriginalRoute(null)",
  "setPlanDriveFor(null)",
  "stopNavSpeech()",
] as const;

export interface ArrivalInfo {
  name: string;
  arrivedAtMs: number;
  location: LatLng | null;
  address: string | null;
}
