// The small rules behind the home map's layout and behaviour (UI pass 2, section 1): where the
// camera puts the driver, when the floating buttons fade, how big an alert pin is, when the
// street name is worth looking up again. All plain arithmetic with no imports, so every rule is
// checked by scripts/test-ui-logic.ts. Whether the result LOOKS right is a phone test.

// ---------------------------------------------------------------------------------------------
// Floating buttons and the sheet

/** Gap between the top of the "Where to?" sheet and the buttons that ride on it. */
export const FLOATING_GAP = 12;
/** How far past half height the sheet travels while the buttons fade out. */
const FADE_DISTANCE = 48;

/**
 * Opacity of the map's floating buttons for a given sheet height: fully visible up to the half
 * snap point, fading out over the next 48pt, and gone above that -- so they never sit on top of
 * a sheet the driver is reading.
 */
export function floatingButtonsOpacity(sheetVisibleHeight: number, halfHeight: number): number {
  "worklet";
  if (sheetVisibleHeight <= halfHeight) return 1;
  const past = sheetVisibleHeight - halfHeight;
  if (past >= FADE_DISTANCE) return 0;
  return 1 - past / FADE_DISTANCE;
}

/** Whether the buttons should still accept touches (an invisible button must not be tappable). */
export function floatingButtonsInteractive(sheetVisibleHeight: number, halfHeight: number): boolean {
  return floatingButtonsOpacity(sheetVisibleHeight, halfHeight) > 0.5;
}

// ---------------------------------------------------------------------------------------------
// Where the driver sits on screen

/** The driver's arrow sits this far down the screen on the home map: above the sheet, with
 *  more of the road ahead in view than behind. */
export const HOME_ARROW_SCREEN_FRACTION = 0.62;

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Map padding for the idle home map. The map centres its camera target in whatever area is left
 * after padding, so:
 *   - bottom = everything covering the map's lower edge (the sheet at its peek height, plus the
 *     ad banner under it), which also keeps the Google logo clear of the sheet;
 *   - top    = whatever then puts that centre at 62% of the screen height.
 * If the sheet is so tall that 62% would fall behind it, the arrow goes to the middle of the
 * uncovered map instead -- visible beats exact.
 */
export function homeMapPadding(mapHeight: number, coveredBottom: number, screenHeight = mapHeight, targetY?: number): MapPadding {
  // `mapHeight` is the map view's own height; `screenHeight` is the whole screen's, which is
  // taller when something (the ad banner) is laid out beneath the map. The 62% is of the screen.
  const bottom = Math.max(0, Math.min(coveredBottom, mapHeight * 0.6));
  const target = targetY ?? screenHeight * HOME_ARROW_SCREEN_FRACTION;
  // centreY = top + (mapHeight - top - bottom) / 2  =>  top = 2*centreY - mapHeight + bottom
  const top = Math.max(0, 2 * target - mapHeight + bottom);
  // Never pad away the whole map.
  const maxTop = Math.max(0, mapHeight - bottom - 120);
  return { top: Math.min(top, maxTop), right: 0, bottom, left: 0 };
}

// ---------------------------------------------------------------------------------------------
// The street-name pill's place on screen

/** The pill rides the sheet on the Report button's baseline; 44 pt (a full tap target) so the
 *  arrow above it can sit at ~72% of the screen (Waze-match: arrow at ~72%, pill under it). */
export const STREET_PILL_HEIGHT = 44;
/** The arrow's centre sits this far above the pill's top edge, so the pill overlaps the bottom
 *  of the accuracy circle slightly. */
export const ARROW_ABOVE_PILL = 22;
/**
 * The "Where to?" sheet's peek, in points: the grabber (25) + the 48 pt search field + 8. Fixed,
 * not a fraction of the screen, so the arrow lands at ~72% on every phone (71% on 390x844, 74%
 * on 430x932, 69% on 375x667) with the street pill under it. Home / Work / New show one swipe up.
 */
export const WHERE_TO_PEEK_PT = 81;

// Peek / half / full, as fractions of the space between the status bar and whatever is under
// the sheet. Exported because the map lays itself out around the sheet from these same numbers.
export const WHERE_TO_SNAP_FRACTIONS: [number, number, number] = [0.24, 0.55, 0.92];

/**
 * The fractions the sheet really uses: the peek is a fixed WHERE_TO_PEEK_PT (search field only,
 * so the arrow sits at ~72%); half and full stay fractions. Same inputs as threeSnapHeights.
 */
export function whereToSnapFractions(screenHeight: number, topInset: number, bottomInset: number): [number, number, number] {
  const max = Math.max(1, screenHeight - topInset - bottomInset);
  return [Math.min(WHERE_TO_SNAP_FRACTIONS[0], WHERE_TO_PEEK_PT / max), WHERE_TO_SNAP_FRACTIONS[1], WHERE_TO_SNAP_FRACTIONS[2]];
}


/** The pill's top edge (px from the top of the map) for a sheet showing `sheetVisible` px. */
export function streetPillTopY(mapHeight: number, sheetVisible: number, scale = 1): number {
  return mapHeight - sheetVisible - FLOATING_GAP - STREET_PILL_HEIGHT * scale;
}

/** Where the home map puts the driver's arrow: directly above the pill. */
export function homeArrowTargetY(mapHeight: number, sheetPeek: number, scale = 1): number {
  return streetPillTopY(mapHeight, sheetPeek, scale) - ARROW_ABOVE_PILL * scale;
}

/** The pill never reaches the report button: screen width - (report button width + 16) x 2.
 *  (On big phones the buttons sit further in than 16pt; the real side margin is used then.) */
export function streetPillMaxWidth(screenWidth: number, reportButtonWidth: number, sideMargin = 16): number {
  return Math.max(0, screenWidth - (reportButtonWidth + Math.max(16, sideMargin)) * 2);
}

/** Pill text: 22pt, shrinking to 16pt for a long name before it's cut with "...". */
export const STREET_PILL_FONT = { size: 22, min: 16 };

/** Where the arrow actually ends up (px from the top) for a given padding -- the pill sits under it. */
export function arrowScreenY(mapHeight: number, padding: MapPadding): number {
  return padding.top + (mapHeight - padding.top - padding.bottom) / 2;
}

/** The zoom the home map opens and re-centres at. */
export const HOME_FOLLOW_ZOOM = 17;

// ---------------------------------------------------------------------------------------------
// Zoom and alert pins

/** Approximate map zoom level from the latitude span on screen. */
export function zoomFromLatitudeDelta(latitudeDelta: number): number {
  if (!Number.isFinite(latitudeDelta) || latitudeDelta <= 0) return HOME_FOLLOW_ZOOM;
  return Math.log2(360 / latitudeDelta);
}

export const ALERT_PIN_MIN = 22;
export const ALERT_PIN_MAX = 34;
/** Below this zoom, reports are grouped into a count instead of drawn one by one. */
export const ALERT_CLUSTER_BELOW_ZOOM = 12;
const PIN_MIN_ZOOM = 12;
const PIN_MAX_ZOOM = 17;
const ON_ROUTE_BONUS = 4;

/**
 * Diameter of a report pin: 22pt when zoomed out, 34pt close up, in 4pt steps -- steps, because
 * each pin is rasterised once per size and a smoothly changing size would redraw every pin on
 * every frame of a pinch. A report on the route being driven is one step larger.
 */
export function alertPinSize(zoom: number, onRoute = false): number {
  const t = Math.max(0, Math.min(1, (zoom - PIN_MIN_ZOOM) / (PIN_MAX_ZOOM - PIN_MIN_ZOOM)));
  const raw = ALERT_PIN_MIN + t * (ALERT_PIN_MAX - ALERT_PIN_MIN);
  const stepped = ALERT_PIN_MIN + Math.round((raw - ALERT_PIN_MIN) / 4) * 4;
  return stepped + (onRoute ? ON_ROUTE_BONUS : 0);
}

export function shouldClusterAlerts(zoom: number): boolean {
  return zoom < ALERT_CLUSTER_BELOW_ZOOM;
}

// ---------------------------------------------------------------------------------------------
// Distances

const EARTH_RADIUS_M = 6_371_000;
export function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Smallest angle between two compass headings, 0-180. */
export function headingDelta(a: number, b: number): number {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return diff;
}

export const REPORTS_AROUND_RADIUS_M = 10_000;

/** How many active reports are within 10km -- the real number the info pill shows. */
export function countReportsAround(
  reports: { lat: number; lng: number }[],
  center: { latitude: number; longitude: number },
  radiusMeters = REPORTS_AROUND_RADIUS_M
): number {
  let count = 0;
  for (const report of reports) {
    if (metersBetween(center.latitude, center.longitude, report.lat, report.lng) <= radiusMeters) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------------------------
// The street-name pill

// Small on purpose: two different roads can be a few metres apart (a side street beside the main
// road, a slip lane). The lookup re-picks from the roads already fetched around the driver
// (services/osmTrafficData.ts), so a look every ~8 m costs no network until they leave that area.
export const STREET_LOOKUP_MIN_MOVE_M = 8;
export const STREET_LOOKUP_MIN_TURN_DEG = 20;
/** The pill swaps to "N reports around you" after this long without moving. */
export const STATIONARY_AFTER_MS = 10_000;

export interface StreetFix {
  latitude: number;
  longitude: number;
  heading: number;
}

/**
 * Decides when to look up the road under the driver again (the street name and its speed limit
 * come from the one lookup). The pill and the sign re-read this every second; a new lookup
 * happens after moving more than STREET_LOOKUP_MIN_MOVE_M or turning more than
 * STREET_LOOKUP_MIN_TURN_DEG while moving, never while one is in flight.
 *
 * Root cause of the speed sign keeping one road's limit on a different road close by: this used
 * to copy the current answer into every new 25 m grid square the driver passed through without a
 * lookup, and answer any later visit to that square from that copy. Two roads in one square and
 * direction (a main road and its service road) shared one remembered answer. Now only a real
 * lookup sets the answer, and it is never re-used for a different position.
 */
export class RoadLookupTracker<T> {
  private lastLookup: StreetFix | null = null;
  private inFlight = false;
  private current: T | null = null;
  lookupsStarted = 0;

  /** What's known about the road right now (null = nothing; hide the pill). */
  get value(): T | null {
    return this.current;
  }

  /**
   * Call on every tick. Returns true when the caller should start a lookup for this fix -- and
   * must then call `resolve` (or `fail`) with the outcome.
   */
  update(fix: StreetFix): boolean {
    if (this.inFlight) return false;
    if (this.lastLookup) {
      const moved = metersBetween(this.lastLookup.latitude, this.lastLookup.longitude, fix.latitude, fix.longitude);
      const turned = headingDelta(this.lastLookup.heading, fix.heading);
      // The turn test only counts once the driver has actually gone somewhere: a phone's
      // heading jitters while it sits still, and that must not trigger lookups.
      const turnedWhileMoving = turned > STREET_LOOKUP_MIN_TURN_DEG && moved > 3;
      if (moved <= STREET_LOOKUP_MIN_MOVE_M && !turnedWhileMoving) return false;
    }
    this.lastLookup = fix;
    this.inFlight = true;
    this.lookupsStarted++;
    return true;
  }

  resolve(_fix: StreetFix, name: T | null): void {
    this.inFlight = false;
    this.current = name;
  }

  /** A lookup that errored: try again at the next move. */
  fail(): void {
    this.inFlight = false;
    this.lastLookup = null;
  }

  reset(): void {
    this.lastLookup = null;
    this.inFlight = false;
    this.current = null;
  }
}

/**
 * The road the driver is on during navigation, taken from the route itself: the street the
 * previous step turned onto. Null on the first step (nothing has been turned onto yet) or when
 * Google's instruction named no street -- the looked-up name is used then.
 */
export function roadFromRouteSteps(
  steps: { targetStreetName?: string }[],
  activeStepIndex: number
): string | null {
  if (activeStepIndex <= 0) return null;
  const name = steps[activeStepIndex - 1]?.targetStreetName?.trim();
  return name ? name : null;
}

/** The tracker with just a name in it -- what the unit checks exercise. */
export class StreetNameTracker extends RoadLookupTracker<string> {
  get name(): string | null {
    return this.value;
  }
}

// ---- Permanent fix §5: where every home-map control sits (one definition, overlap-tested) ----
//   top-left      Menu, Compass under it
//   top-right     Audio player (optional), Sound under it
//   bottom-right  Report on the sheet's top edge; Re-centre ABOVE it (12pt gap), only in FREE
//   bottom-centre the street pill on Report's baseline, never wider than the gap between them
// HomeMapControls renders exactly these frames; __tests__/map/controlsLayout.test.ts checks no two
// intersect on 320 / 375 / 390 / 430 pt phones in every state.
export interface HomeFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type HomeControl = "menu" | "compass" | "audioPlayer" | "sound" | "report" | "recenter" | "streetPill";

export function homeControlSizes(scale: number) {
  return { round: 56 * scale, recenter: 56 * scale, side: 16 * scale, gap: 8 * scale, column: FLOATING_GAP * scale };
}

/** Bottom offset (from the screen bottom) of Re-centre: one Report and a 12pt gap above the sheet edge. */
export function recenterBottom(sheetEdgeBottom: number, scale: number): number {
  const s = homeControlSizes(scale);
  return sheetEdgeBottom + s.round + s.column;
}

export function homeControlFrames(o: {
  width: number;
  height: number;
  topInset: number;
  scale: number;
  /** How much of the sheet is showing + what sits under it. */
  sheetVisibleHeight: number;
  bottomInset: number;
  showCompass: boolean;
  showAudioPlayer: boolean;
  showSound: boolean;
  showRecenter: boolean;
  showStreetPill: boolean;
}): Partial<Record<HomeControl, HomeFrame>> {
  const s = homeControlSizes(o.scale);
  const top = o.topInset + 8 * o.scale;
  const f: Partial<Record<HomeControl, HomeFrame>> = {};
  f.menu = { x: s.side, y: top, width: s.round, height: s.round };
  if (o.showCompass) f.compass = { x: s.side, y: top + s.round + s.gap, width: s.round, height: s.round };
  let y = top;
  const right = o.width - s.side - s.round;
  if (o.showAudioPlayer) {
    f.audioPlayer = { x: right, y, width: s.round, height: s.round };
    y += s.round + s.gap;
  }
  if (o.showSound) f.sound = { x: right, y, width: s.round, height: s.round };
  const edge = o.sheetVisibleHeight + o.bottomInset + FLOATING_GAP;
  f.report = { x: right, y: o.height - edge - s.round, width: s.round, height: s.round };
  if (o.showRecenter) f.recenter = { x: o.width - s.side - s.recenter, y: o.height - recenterBottom(edge, o.scale) - s.recenter, width: s.recenter, height: s.recenter };
  if (o.showStreetPill) {
    const w = Math.min(streetPillMaxWidth(o.width, s.round, s.side), 260 * o.scale);
    f.streetPill = { x: (o.width - w) / 2, y: o.height - edge - STREET_PILL_HEIGHT * o.scale, width: w, height: STREET_PILL_HEIGHT * o.scale };
  }
  return f;
}
