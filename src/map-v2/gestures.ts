// Tells the driver's own map gestures apart from the app's camera moves -- the basis of the
// "Re-centre" state: a drag, pinch or twist takes the map out of follow mode; the app's own
// animateCamera calls never do. Fed by TrackLineMap from Mapbox's camera events. Pure; tested in
// __tests__/mapV2.test.ts.

export class GestureTracker {
  private active = false;
  private sinceIdle = false;

  /**
   * Every camera change. `isUserInteraction` is Mapbox's own flag for a touch-driven change
   * (including the fling after a swipe). Returns true exactly once when a gesture starts.
   */
  cameraChanged(isUserInteraction: boolean): boolean {
    const started = isUserInteraction && !this.active;
    this.active = isUserInteraction;
    if (isUserInteraction) this.sinceIdle = true;
    return started;
  }

  /** The map came to rest. Returns whether a gesture moved it since it last rested. */
  idle(): boolean {
    const wasGesture = this.sinceIdle;
    this.sinceIdle = false;
    return wasGesture;
  }
}
