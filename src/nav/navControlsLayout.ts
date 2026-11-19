// Where every floating control sits while driving, in one place, so they can't overlap again:
//   top-left:     Compass (52), under the top instruction bar
//   top-right:    Audio player (52), Sound (52), Voice command (52), a column under the bar
//   bottom-left:  speed limit sign (56, on top) → 12 gap → speedometer (84), above the bottom bar
//   bottom-right: Report (56), and Re-centre (52) above it only after panning, above the bar
//   centre:       the street chip just above the bar, and the info banner ("Hazard reported
//                 ahead · 800 m") above that, between the two bottom columns
// The re-centre button used to sit bottom-LEFT above the bar, exactly where the speedometer is.
// Pure, tested on 320 / 375 / 390 / 430 pt widths (__tests__/nav/navControls.test.tsx).

export const CONTROL_GAP = 12;
export const SIDE_MARGIN = 16;
export const SPEED_SIGN_SIZE = 56;
export const SPEEDOMETER_SIZE = 84;
export const REPORT_SIZE = 56;
export const RECENTER_SIZE = 52;
export const SOUND_SIZE = 52;
export const COMPASS_SIZE = 52;
export const STREET_CHIP_HEIGHT = 28;
export const INFO_BANNER_HEIGHT = 44;

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
  showCompass?: boolean;
  showAudioPlayer?: boolean;
  showSound?: boolean;
  showVoice?: boolean;
  showStreetChip?: boolean;
  showInfoBanner?: boolean;
}

export type NavControl =
  | "speedLimit"
  | "speedometer"
  | "report"
  | "recenter"
  | "compass"
  | "audioPlayer"
  | "sound"
  | "voice"
  | "streetChip"
  | "infoBanner"
  | "bottomBar"
  | "topBar";

/** Distance from the screen bottom to the bottom edge of the lowest floating controls. */
export function controlsBottom(safeBottom: number, bottomBarHeight: number): number {
  return safeBottom + bottomBarHeight + CONTROL_GAP;
}

/** The space between the bottom-left and bottom-right columns (street chip, info banner). */
export function centreLane(width: number): { left: number; right: number } {
  const left = SIDE_MARGIN + SPEEDOMETER_SIZE + CONTROL_GAP;
  const right = width - SIDE_MARGIN - REPORT_SIZE - CONTROL_GAP;
  return { left, right };
}

/** Top of the top-right / top-left columns: 12 below the safe area + the top bar + 12. */
export function topColumnTop(safeTop: number, topBarHeight: number): number {
  return safeTop + topBarHeight + CONTROL_GAP * 2;
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
  const top = topColumnTop(i.safeTop, i.topBarHeight);
  if (i.showCompass !== false) out.compass = { x: SIDE_MARGIN, y: top, width: COMPASS_SIZE, height: COMPASS_SIZE };
  // Top-right column, top to bottom: audio player, sound, voice command (each only when shown).
  // On a short phone they don't all fit above the space Re-centre needs (kept free even before
  // it shows, so nothing jumps), so the rest continue down the left column under the compass.
  const rightLimit = base - REPORT_SIZE - CONTROL_GAP - RECENTER_SIZE - CONTROL_GAP;
  const leftLimit = base - SPEEDOMETER_SIZE - CONTROL_GAP - (i.showSpeedLimit ? SPEED_SIGN_SIZE + CONTROL_GAP : 0);
  let yRight = top;
  let yLeft = out.compass ? top + COMPASS_SIZE + CONTROL_GAP : top;
  const right = i.width - SIDE_MARGIN - SOUND_SIZE;
  for (const key of ["audioPlayer", "sound", "voice"] as const) {
    const shown = key === "audioPlayer" ? i.showAudioPlayer : key === "sound" ? i.showSound !== false : i.showVoice;
    if (!shown) continue;
    if (yRight + SOUND_SIZE <= rightLimit) {
      out[key] = { x: right, y: yRight, width: SOUND_SIZE, height: SOUND_SIZE };
      yRight += SOUND_SIZE + CONTROL_GAP;
    } else if (yLeft + SOUND_SIZE <= leftLimit) {
      out[key] = { x: SIDE_MARGIN, y: yLeft, width: SOUND_SIZE, height: SOUND_SIZE };
      yLeft += SOUND_SIZE + CONTROL_GAP;
    }
    // Neither fits (not possible on any phone we support; checked in the tests): left out.
  }
  const lane = centreLane(i.width);
  const chipBottom = base;
  if (i.showStreetChip) out.streetChip = { x: lane.left, y: chipBottom - STREET_CHIP_HEIGHT, width: lane.right - lane.left, height: STREET_CHIP_HEIGHT };
  if (i.showInfoBanner) {
    const bannerBottom = i.showStreetChip ? chipBottom - STREET_CHIP_HEIGHT - CONTROL_GAP : chipBottom;
    out.infoBanner = { x: lane.left, y: bannerBottom - INFO_BANNER_HEIGHT, width: lane.right - lane.left, height: INFO_BANNER_HEIGHT };
  }
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

/** Pairs closer than the 12pt gap (touching controls count as crowded too). */
export function crowded(frames: Partial<Record<NavControl, Frame>>, gap = CONTROL_GAP): string[] {
  const grow = (f: Frame): Frame => ({ x: f.x - gap / 2 + 0.5, y: f.y - gap / 2 + 0.5, width: f.width + gap - 1, height: f.height + gap - 1 });
  const entries = (Object.entries(frames) as [NavControl, Frame][]).filter(([k]) => k !== "bottomBar" && k !== "topBar");
  const bad: string[] = [];
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      if (intersects(grow(entries[a][1]), grow(entries[b][1]))) bad.push(`${entries[a][0]} × ${entries[b][0]}`);
    }
  }
  return bad;
}

/** Re-centre's offset above the bottom bar's top edge, for NavBottomBar (sits over Report). */
export const RECENTER_ABOVE_BAR = CONTROL_GAP + REPORT_SIZE + CONTROL_GAP;
