// The route preview's camera: flat (pitch 0) and north-up, fitted to EVERY route plus the start
// and the destination, inside the space the top card and the bottom sheet actually leave (their
// measured sizes, + 24pt top/bottom and 32pt sides). Re-fitted whenever the routes, the mode, Avoid,
// the top card or the sheet's current height change. Pure, so the fit and the "is the selected
// route really visible" checks are tested directly (__tests__/nav/previewCamera.test.ts).
import type { LatLng } from "@/utils/polyline";

export const PREVIEW_PITCH = 0;
export const PREVIEW_HEADING = 0;
export const PREVIEW_FIT_MS = 600;
export const FIT_MARGIN = { top: 24, bottom: 24, side: 32 } as const;
/** The route sheet never covers more than this share of the screen, so the map stays visible. */
export const MAX_SHEET_FRACTION = 0.55;

export interface EdgePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Map padding while previewing: the measured UI + the fit margins. */
export function previewEdgePadding(topCardBottom: number, sheetHeight: number): EdgePadding {
  return {
    top: Math.round(topCardBottom + FIT_MARGIN.top),
    bottom: Math.round(sheetHeight + FIT_MARGIN.bottom),
    left: FIT_MARGIN.side,
    right: FIT_MARGIN.side,
  };
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
