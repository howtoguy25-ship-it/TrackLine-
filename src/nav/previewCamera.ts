// The route preview's camera: flat (pitch 0) and north-up, fitted to EVERY route plus the start
// and the destination, inside the space the top card and the bottom sheet actually leave (their
// measured sizes, + 24pt top/bottom and 32pt sides). Re-fitted whenever the routes, the mode, Avoid,
// the top card or the sheet's current height change. Pure, so the fit and the "is the selected
// route really visible" checks are tested directly (__tests__/nav/previewCamera.test.ts).
import type { LatLng } from "@/utils/polyline";

export const PREVIEW_PITCH = 0;
export const PREVIEW_HEADING = 0;
export const PREVIEW_FIT_MS = 600;
/**
 * Room around the fitted routes: the flag stands ~50 pt above its point (top), the start dot is
 * 40 pt across (sides / bottom), so neither is ever clipped by the edge, the card or the sheet.
 */
export const FIT_MARGIN = { top: 56, bottom: 28, side: 40 } as const;
/** Only when the card and sheet leave less than this (a 4-inch phone, sheet fully up) is the fit area kept at this height; otherwise it is exactly the space left, so nothing is under the sheet. */
export const MIN_FIT_HEIGHT = 100;
/** The route sheet never covers more than this share of the screen, so the map stays visible. */
export const MAX_SHEET_FRACTION = 0.55;

export interface EdgePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Map padding while previewing: the measured UI + the fit margins. */
export function previewEdgePadding(topCardBottom: number, sheetHeight: number, viewportHeight?: number): EdgePadding {
  const top = Math.round(topCardBottom + FIT_MARGIN.top);
  let bottom = Math.round(sheetHeight + FIT_MARGIN.bottom);
  // Fix pass 6: a pulled-up sheet used to leave the map almost no height, and Mapbox then zoomed
  // right in on the middle of the route. The fit area never shrinks below MIN_FIT_HEIGHT.
  if (viewportHeight != null) bottom = Math.max(0, Math.min(bottom, Math.round(viewportHeight - top - MIN_FIT_HEIGHT)));
  return { top, bottom, left: FIT_MARGIN.side, right: FIT_MARGIN.side };
}

/**
 * The preview camera, worked out here instead of by the map's own bounds fit: the centre of the
 * points (Web Mercator) placed in the middle of the free area, and the zoom (Google scale, as the
 * app's camera calls use) at which every point fits inside it -- the same maths projectFitted and
 * the tests check. Flat and north-up.
 */
export function previewFitCamera(
  points: LatLng[],
  viewport: { width: number; height: number },
  padding: EdgePadding
): { center: LatLng; zoom: number; heading: number; pitch: number } | null {
  const fit = boundsOf(points);
  if (!fit) return null;
  const innerW = Math.max(40, viewport.width - padding.left - padding.right);
  const innerH = Math.max(40, viewport.height - padding.top - padding.bottom);
  const spanX = Math.max(1e-9, ((fit.east - fit.west) * Math.PI) / 180);
  const spanY = Math.max(1e-9, mercY(fit.north) - mercY(fit.south));
  const scale = Math.min(innerW / spanX, innerH / spanY); // screen points per radian
  // Mapbox: a 512 pt world at zoom 0, so points per radian = 512 * 2^z / (2 pi). Google = Mapbox + 1.
  const mapboxZoom = Math.log2((scale * 2 * Math.PI) / 512);
  const zoom = Math.max(3, Math.min(18, mapboxZoom + 1));
  const midY = (mercY(fit.north) + mercY(fit.south)) / 2;
  const latitude = ((2 * Math.atan(Math.exp(midY)) - Math.PI / 2) * 180) / Math.PI;
  return { center: { latitude, longitude: (fit.east + fit.west) / 2 }, zoom, heading: PREVIEW_HEADING, pitch: PREVIEW_PITCH };
}

/** Everything the preview must show: every point of every route, the start and the destination. */
export function previewFitCoordinates(routes: LatLng[][], start: LatLng | null, destination: LatLng | null): LatLng[] {
  const out: LatLng[] = [];
  for (const line of routes) for (const p of line) out.push(p);
  if (start) out.push(start);
  if (destination) out.push(destination);
  return out;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export function boundsOf(points: LatLng[]): Bounds | null {
  if (!points.length) return null;
  let north = -90, south = 90, east = -180, west = 180;
  for (const p of points) {
    north = Math.max(north, p.latitude);
    south = Math.min(south, p.latitude);
    east = Math.max(east, p.longitude);
    west = Math.min(west, p.longitude);
  }
  return { north, south, east, west };
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/**
 * Where points land on screen once `fit` bounds are fitted (north-up, flat) into a viewport with
 * the given padding: the same maths the map does (Web Mercator, uniform scale, centred in the
 * padded area). Used to check that what must be visible really is.
 */
export function projectFitted(points: LatLng[], fit: Bounds, viewport: { width: number; height: number }, padding: EdgePadding): { x: number; y: number }[] {
  const innerW = viewport.width - padding.left - padding.right;
  const innerH = viewport.height - padding.top - padding.bottom;
  const spanX = Math.max(1e-9, ((fit.east - fit.west) * Math.PI) / 180);
  const spanY = Math.max(1e-9, mercY(fit.north) - mercY(fit.south));
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const cx = padding.left + innerW / 2;
  const cy = padding.top + innerH / 2;
  const midX = (((fit.east + fit.west) / 2) * Math.PI) / 180;
  const midY = (mercY(fit.north) + mercY(fit.south)) / 2;
  return points.map((p) => ({ x: cx + ((p.longitude * Math.PI) / 180 - midX) * scale, y: cy - (mercY(p.latitude) - midY) * scale }));
}

/** True when every point is inside the area the UI leaves free. */
export function allVisible(screen: { x: number; y: number }[], viewport: { width: number; height: number }, padding: EdgePadding, slackPx = 1): boolean {
  return screen.every(
    (s) => s.x >= padding.left - slackPx && s.x <= viewport.width - padding.right + slackPx && s.y >= padding.top - slackPx && s.y <= viewport.height - padding.bottom + slackPx
  );
}

/** Time bubbles are about this big on screen (pointer at the bottom centre). */
export const BUBBLE_SIZE = { width: 84, height: 40 } as const;

/**
 * A bubble's real size: "12 min" is 84 wide, "1 h 12 min" wider; the selected one with its "Best"
 * line is 60 tall (RouteTimeBubble: 6 + 21 + 18 + 6 padding/lines + an 8pt pointer).
 */
export function bubbleSize(timeText: string, tagged: boolean): { width: number; height: number } {
  return { width: Math.max(BUBBLE_SIZE.width, Math.round(24 + 10 * timeText.length)), height: tagged ? 60 : BUBBLE_SIZE.height };
}

/** Whether any two bubbles (pointer at each screen point) overlap. */
export function bubblesOverlap(anchors: { x: number; y: number }[], size = BUBBLE_SIZE): boolean {
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const a = anchors[i];
      const b = anchors[j];
      if (Math.abs(a.x - b.x) < size.width && Math.abs(a.y - b.y) < size.height) return true;
    }
  }
  return false;
}

// ---- Fix pass 5 §1: one rule for what the preview fits, in every mode ----
/** At most this many routes are drawn (the selected one always is, even if it's further down). */
export const MAX_DRAWN_ROUTES = 3;

/** The routes the preview draws: the first MAX_DRAWN_ROUTES, plus the selected one. */
export function drawnRouteIndices(count: number, selected: number, max = MAX_DRAWN_ROUTES): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (i < max || i === selected) out.push(i);
  return out;
}

/**
 * Every line the preview fits: exactly the drawn routes -- never one route on its own and never
 * just the user. Root cause of routes off-screen: bike / walk / transit fitted the first 3 of
 * their routes while the selected one could be 4th, and selecting a route fitted only that route.
 */
export function previewFitLines<R>(routes: readonly R[], selected: number, line: (r: R) => LatLng[]): LatLng[][] {
  return drawnRouteIndices(routes.length, selected).map((i) => line(routes[i]));
}
