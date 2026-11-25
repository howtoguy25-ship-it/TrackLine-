// THE camera owner (permanent fix §2-4). Every camera move in the app goes through here, tagged
// with where it comes from; the state decides whether it's allowed. Root cause of "the map fights
// my zoom": ~40 separate places moved the camera, each checking (or forgetting) its own flag --
// e.g. the home 3D effect re-zoomed to 18.5 on every GPS fix, ignoring a pinch. Now:
//   FOLLOW        home map follows you
//   FREE          you moved the map -- NOTHING moves it automatically (no follow, fit, timer)
//   ROUTE_PREVIEW the route choice: fitted to all routes, never follows your position
//   OVERVIEW      the whole route while driving
//   NAV_FOLLOW    driving: facing the road ahead
// Any gesture -> FREE. Only Recentre (or starting / ending navigation, entering preview) leaves
// FREE. eslint.config.js forbids animateCamera / fitToCoordinates / animateToRegion / setCamera
// outside this file and TrackLineMap. Pure core; tested in __tests__/map/cameraController.test.ts.
import type { CameraLike, LatLng, Region } from "@/map-v2/geo";

export type CameraMode = "FOLLOW" | "FREE" | "ROUTE_PREVIEW" | "OVERVIEW" | "NAV_FOLLOW";

/**
 * follow      the home map keeping you in view (FOLLOW only)
 * navFollow   chase camera, speed zoom, turn close-ups (NAV_FOLLOW only)
 * previewFit  fitting the routes in preview (ROUTE_PREVIEW only)
 * overview    the whole-route view while driving (OVERVIEW only)
 * focus       you asked to look at something (a pin, a place, a search result): always allowed, and
 *             the camera then stays FREE where you looked
 * autoFocus   the app showing what you just opened (nearby results): only from FOLLOW (then FREE),
 *             never once you've moved the map yourself
 * recentre    the Recentre button: back to FOLLOW / NAV_FOLLOW
 * transition  starting / ending navigation or preview: the caller sets the state first
 */
export type MoveSource = "follow" | "navFollow" | "previewFit" | "overview" | "focus" | "autoFocus" | "recentre" | "transition";

export function allowed(mode: CameraMode, source: MoveSource): boolean {
  switch (source) {
    case "follow":
    case "autoFocus":
      return mode === "FOLLOW";
    case "navFollow":
      return mode === "NAV_FOLLOW";
    case "previewFit":
      return mode === "ROUTE_PREVIEW";
    case "overview":
      return mode === "OVERVIEW";
    default:
      return true;
  }
}

/** Navigation: optional auto-recentre after 15 s of no touch, only while moving over 10 km/h. */
export const AUTO_RECENTRE_IDLE_MS = 15_000;
export const AUTO_RECENTRE_MIN_KMH = 10;

export function shouldAutoRecentre(o: { mode: CameraMode; navigating: boolean; settingOn: boolean; speedKmh: number | null; idleMs: number }): boolean {
  return o.mode === "FREE" && o.navigating && o.settingOn && (o.speedKmh ?? 0) > AUTO_RECENTRE_MIN_KMH && o.idleMs >= AUTO_RECENTRE_IDLE_MS;
}

export interface CameraTarget {
  animateCamera(camera: Partial<CameraLike>, options?: { duration?: number }): void;
  animateToRegion(region: Region, duration?: number): void;
  fitToCoordinates(coords: LatLng[], options?: { edgePadding?: Partial<{ top: number; right: number; bottom: number; left: number }>; animated?: boolean }): void;
}

export class CameraController {
  private mode: CameraMode = "FOLLOW";
  private navigating = false;
  private lastTouchMs = 0;
  private gestureCount = 0;
  private listeners = new Set<(m: CameraMode) => void>();
  /** `target`: the map's ref (read at move time, so it's fine before the map mounts). */
  constructor(private readonly target: { readonly current: CameraTarget | null }) {}

  get state(): CameraMode {
    return this.mode;
  }

  get isNavigating(): boolean {
    return this.navigating;
  }

  onChange(l: (m: CameraMode) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private set(m: CameraMode, nowMs = Date.now()) {
    if (m === this.mode) return;
    // Entering FREE counts as a touch for the idle clock (a gesture, or a button that showed
    // you something): the navigation auto-recentre waits 15 s from here.
    if (m === "FREE") this.lastTouchMs = Math.max(this.lastTouchMs, nowMs);
    this.mode = m;
    this.listeners.forEach((l) => l(m));
  }

  /** Explicit transitions (start/end navigation, enter/leave preview, overview on/off). */
  setMode(m: CameraMode, navigating = this.navigating): void {
    this.navigating = navigating;
    this.set(m);
  }

  /** Any user gesture on the map: pinch, pan, rotate, tilt, double-tap. */
  gesture(nowMs = Date.now()): void {
    this.lastTouchMs = nowMs;
    this.gestureCount += 1;
    this.set("FREE", nowMs);
  }

  /** How many gestures so far: lets a temporary view (the alert card) tell if you moved the map. */
  get gestures(): number {
    return this.gestureCount;
  }

  /** Time since the map was last touched (for the navigation auto-recentre). */
  idleMs(nowMs = Date.now()): number {
    return nowMs - this.lastTouchMs;
  }

  /** The Recentre button: back to following (driving or not). */
  recentre(): CameraMode {
    this.set(this.navigating ? "NAV_FOLLOW" : "FOLLOW");
    return this.mode;
  }

  private gate(source: MoveSource): CameraTarget | null {
    if (!allowed(this.mode, source)) return null;
    if ((source === "focus" || source === "autoFocus") && (this.mode === "FOLLOW" || this.mode === "NAV_FOLLOW")) this.set("FREE");
    return this.target.current;
  }

  /** Moves the camera if `source` is allowed now. Returns whether it moved. */
  move(source: MoveSource, camera: Partial<CameraLike>, options?: { duration?: number }): boolean {
    const t = this.gate(source);
    if (!t) return false;
    t.animateCamera(camera, options);
    return true;
  }

  fit(source: MoveSource, coords: LatLng[], options?: Parameters<CameraTarget["fitToCoordinates"]>[1]): boolean {
    const t = this.gate(source);
    if (!t || coords.length === 0) return false;
    t.fitToCoordinates(coords, options);
    return true;
  }

  region(source: MoveSource, region: Region, duration?: number): boolean {
    const t = this.gate(source);
    if (!t) return false;
    t.animateToRegion(region, duration);
    return true;
  }
}
