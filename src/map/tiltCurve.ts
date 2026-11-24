// Map look 2: how far the home map leans at each zoom, and the small controller that applies it
// while you pinch. Close in it leans gently (street level), zooming out it leans further (the
// most perspective around neighbourhood level, with the distance fading into the haze), then it
// eases back to flat, top-down, for the city / region view. One smooth curve, no steps.
// Zoom is on the app's (Google) scale. Pure; tested in __tests__/mapLook2/tiltCurve.test.ts.

/** [zoom, tilt degrees] -- the curve passes through these, eased in between. */
export const TILT_KEYS: readonly (readonly [number, number])[] = [
  // Fix pass 7 §3: 45° at the home view (zoom 16), a little more lean further out, flat by 10.5.
  [10.5, 0],
  [12, 28],
  [13.5, 50],
  [14.5, 55],
  [16, 45],
  [17, 42],
  [19, 40],
];

const smooth = (t: number) => t * t * (3 - 2 * t);

export function tiltForZoom(zoom: number): number {
  const k = TILT_KEYS;
  if (!Number.isFinite(zoom) || zoom <= k[0][0]) return k[0][1];
  if (zoom >= k[k.length - 1][0]) return k[k.length - 1][1];
  for (let i = 1; i < k.length; i++) {
    const [z1, p1] = k[i];
    const [z0, p0] = k[i - 1];
    if (zoom <= z1) return p0 + (p1 - p0) * smooth((zoom - z0) / (z1 - z0));
  }
  return k[k.length - 1][1];
}

/** Below this much difference the map is left alone (no endless micro-adjustments). */
export const TILT_DEADBAND = 1.5;
/** At most one live adjustment this often while pinching. */
export const TILT_MIN_INTERVAL_MS = 60;
/** The map this far off the curve, not by our doing, while the zoom holds still = tilted by hand. */
export const MANUAL_TILT_DEG = 8;

/**
 * Follows the curve while the driver pinches, and stops for good (until reset) the moment they
 * tilt the map themselves with two fingers -- the app never fights a hand.
 */
export class AutoTilt {
  private lastZoom: number | null = null;
  private lastPitch: number | null = null;
  private lastSetPitch: number | null = null;
  private lastSetAt = -Infinity;
  private manual = false;

  reset(): void {
    this.manual = false;
    this.lastSetPitch = null;
    this.lastSetAt = -Infinity;
  }

  get manualTilt(): boolean {
    return this.manual;
  }

  /** A camera frame. Returns the tilt to set now, or null to leave it. */
  frame(o: { zoom: number; pitch: number; gesture: boolean; timeMs: number }): number | null {
    const prevZoom = this.lastZoom;
    const prevPitch = this.lastPitch;
    this.lastZoom = o.zoom;
    this.lastPitch = o.pitch;
    const target = tiltForZoom(o.zoom);
    if (o.gesture && prevZoom != null && prevPitch != null) {
      const zoomStill = Math.abs(o.zoom - prevZoom) < 0.05;
      const notOurs = this.lastSetPitch == null || Math.abs(o.pitch - this.lastSetPitch) > 3;
      if (zoomStill && notOurs && Math.abs(o.pitch - target) > MANUAL_TILT_DEG && Math.abs(o.pitch - prevPitch) > 0.2) this.manual = true;
    }
    if (this.manual) return null;
    if (Math.abs(target - o.pitch) < TILT_DEADBAND) return null;
    if (o.gesture && o.timeMs - this.lastSetAt < TILT_MIN_INTERVAL_MS) return null;
    this.lastSetPitch = target;
    this.lastSetAt = o.timeMs;
    return target;
  }
}

/** How long the map takes to settle onto the curve once it comes to rest. */
export const TILT_SETTLE_MS = 450;
