// Where every floating control sits while driving, in one place, so they can't overlap again:
//   bottom-left:  speed limit sign (56, on top) → 12 gap → speedometer (84), above the bottom bar
//   bottom-right: Report (56), and Re-centre (52) above it only after panning, above the bar
//   top-right:    Sound (52), under the top instruction bar
// The re-centre button used to sit bottom-LEFT above the bar, exactly where the speedometer is.
// Pure, tested on 320 / 375 / 390 / 430 pt widths (__tests__/nav/navControlsLayout.test.ts).

export const CONTROL_GAP = 12;
export const SIDE_MARGIN = 16;
export const SPEED_SIGN_SIZE = 56;
export const SPEEDOMETER_SIZE = 84;
export const REPORT_SIZE = 56;
export const RECENTER_SIZE = 52;
export const SOUND_SIZE = 52;

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NavLayoutInput {
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  /** The bottom ETA bar's measured height (without the safe area). */
  bottomBarHeight: number;
  /** The top instruction bar's measured height (without the safe area). */
  topBarHeight: number;
  showSpeedLimit: boolean;
  showRecenter: boolean;
}

export type NavControl = "speedLimit" | "speedometer" | "report" | "recenter" | "sound" | "bottomBar" | "topBar";

/** Distance from the screen bottom to the bottom edge of the lowest floating controls. */
export function controlsBottom(safeBottom: number, bottomBarHeight: number): number {
  return safeBottom + bottomBarHeight + CONTROL_GAP;
}

export function navControlFrames(i: NavLayoutInput): Partial<Record<NavControl, Frame>> {
  const base = i.height - controlsBottom(i.safeBottom, i.bottomBarHeight);
  const out: Partial<Record<NavControl, Frame>> = {};
  out.bottomBar = { x: 0, y: i.height - i.safeBottom - i.bottomBarHeight, width: i.width, height: i.bottomBarHeight + i.safeBottom };
  out.topBar = { x: 0, y: 0, width: i.width, height: i.safeTop + i.topBarHeight };
  out.speedometer = { x: SIDE_MARGIN, y: base - SPEEDOMETER_SIZE, width: SPEEDOMETER_SIZE, height: SPEEDOMETER_SIZE };
  if (i.showSpeedLimit) {
    out.speedLimit = {
      x: SIDE_MARGIN + (SPEEDOMETER_SIZE - SPEED_SIGN_SIZE) / 2,
      y: base - SPEEDOMETER_SIZE - CONTROL_GAP - SPEED_SIGN_SIZE,
      width: SPEED_SIGN_SIZE,
      height: SPEED_SIGN_SIZE,
    };
  }
  out.report = { x: i.width - SIDE_MARGIN - REPORT_SIZE, y: base - REPORT_SIZE, width: REPORT_SIZE, height: REPORT_SIZE };
  if (i.showRecenter) {
    out.recenter = {
      x: i.width - SIDE_MARGIN - REPORT_SIZE + (REPORT_SIZE - RECENTER_SIZE) / 2,
      y: base - REPORT_SIZE - CONTROL_GAP - RECENTER_SIZE,
      width: RECENTER_SIZE,
      height: RECENTER_SIZE,
    };
  }
  // MapScreen's top-right column: 12 below the safe area + the top bar + 12.
  out.sound = { x: i.width - SIDE_MARGIN - SOUND_SIZE, y: i.safeTop + i.topBarHeight + CONTROL_GAP * 2, width: SOUND_SIZE, height: SOUND_SIZE };
  return out;
}

export function intersects(a: Frame, b: Frame): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Every pair of controls that overlap (should always be empty). */
export function overlaps(frames: Partial<Record<NavControl, Frame>>): string[] {
  const entries = Object.entries(frames) as [NavControl, Frame][];
  const bad: string[] = [];
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      if (intersects(entries[a][1], entries[b][1])) bad.push(`${entries[a][0]} × ${entries[b][0]}`);
    }
  }
  return bad;
}

/** Re-centre's offset above the bottom bar's top edge, for NavBottomBar (sits over Report). */
export const RECENTER_ABOVE_BAR = CONTROL_GAP + REPORT_SIZE + CONTROL_GAP;
