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
export function homeMapPadding(mapHeight: number, coveredBottom: number, screenHeight = mapHeight): MapPadding {
  // `mapHeight` is the map view's own height; `screenHeight` is the whole screen's, which is
  // taller when something (the ad banner) is laid out beneath the map. The 62% is of the screen.
  const bottom = Math.max(0, Math.min(coveredBottom, mapHeight * 0.6));
  const target = screenHeight * HOME_ARROW_SCREEN_FRACTION;
  // centreY = top + (mapHeight - top - bottom) / 2  =>  top = 2*centreY - mapHeight + bottom
  const top = Math.max(0, 2 * target - mapHeight + bottom);
  // Never pad away the whole map.
  const maxTop = Math.max(0, mapHeight - bottom - 120);
  return { top: Math.min(top, maxTop), right: 0, bottom, left: 0 };
}

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

export const STREET_LOOKUP_MIN_MOVE_M = 25;
export const STREET_LOOKUP_MIN_TURN_DEG = 30;
/** The pill swaps to "N reports around you" after this long without moving. */
export const STATIONARY_AFTER_MS = 10_000;

export interface StreetFix {
  latitude: number;
  longitude: number;
  heading: number;
}

/**
 * Decides when the road under the driver is worth a network lookup, and remembers answers.
 * (T is whatever a lookup returns -- the app stores the street name and its speed limit
 * together, since both come from the one request.)
 *
 * The pill re-reads this every second, but a lookup only happens when the driver has moved more
 * than 25m or turned more than 30 degrees since the LAST lookup -- and not even then if that
 * stretch of road has been named before. Everything in between is answered from memory, so the
 * pill stays live without a request per second.
 */
export class RoadLookupTracker<T> {
  private lastLookup: StreetFix | null = null;
  private inFlight = false;
  private cache = new Map<string, T | null>();
  private cacheOrder: string[] = [];
  private current: T | null = null;
  lookupsStarted = 0;

  constructor(private readonly maxCacheEntries = 400) {}

  /**
   * A road segment's cache key: a ~25m grid cell plus which of eight compass directions is being
   * travelled. Direction matters -- at a junction, the same spot is a different road depending
   * on which way you're going.
   */
  static segmentKey(fix: StreetFix): string {
    const latCell = Math.round(fix.latitude / 0.00022);
    const lngCell = Math.round((fix.longitude * Math.cos((fix.latitude * Math.PI) / 180)) / 0.00022);
    const octant = Math.round((((fix.heading % 360) + 360) % 360) / 45) % 8;
    return `${latCell}:${lngCell}:${octant}`;
  }

  /** What's known about the road right now (null = nothing; hide the pill). */
  get value(): T | null {
    return this.current;
  }

  /**
   * Call on every tick. Returns true when the caller should start a lookup for this fix -- and
   * must then call `resolve` (or `fail`) with the outcome.
   */
  update(fix: StreetFix): boolean {
    const key = RoadLookupTracker.segmentKey(fix);
    if (this.cache.has(key)) {
      // Known stretch of road: answer from memory, no request.
      this.current = this.cache.get(key) ?? null;
      return false;
    }
    if (this.inFlight) return false;
    if (this.lastLookup) {
      const moved = metersBetween(this.lastLookup.latitude, this.lastLookup.longitude, fix.latitude, fix.longitude);
      const turned = headingDelta(this.lastLookup.heading, fix.heading);
      // The turn test only counts once the driver has actually gone somewhere: a phone's
      // heading jitters while it sits still, and that must not trigger lookups.
      const turnedWhileMoving = turned > STREET_LOOKUP_MIN_TURN_DEG && moved > 5;
      if (moved <= STREET_LOOKUP_MIN_MOVE_M && !turnedWhileMoving) {
        // Still within 25m of the last answer and heading the same way: this is the same road.
        // Remembering that here is what makes driving a known street again cost nothing --
        // otherwise only the exact spots that were looked up would ever be in memory.
        this.remember(key, this.current);
        return false;
      }
    }
    this.lastLookup = fix;
    this.inFlight = true;
    this.lookupsStarted++;
    return true;
  }

  private remember(key: string, name: T | null): void {
    if (!this.cache.has(key)) {
      this.cacheOrder.push(key);
      if (this.cacheOrder.length > this.maxCacheEntries) {
        const oldest = this.cacheOrder.shift();
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    this.cache.set(key, name);
  }

  resolve(fix: StreetFix, name: T | null): void {
    this.inFlight = false;
    this.remember(RoadLookupTracker.segmentKey(fix), name);
    this.current = name;
  }

  /** A lookup that errored: nothing is cached, so the same stretch can be tried again later. */
  fail(): void {
    this.inFlight = false;
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
