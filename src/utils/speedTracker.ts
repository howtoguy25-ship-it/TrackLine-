// Rough monocular speed estimate: true calibrated speed needs radar/lidar or a
// calibrated stereo/known-geometry setup, neither of which a single phone camera has.
// This gives a physically real (not fabricated) estimate by:
//  1. Assuming an average vehicle width (~1.8m) since we don't know the real one.
//  2. Estimating the camera's focal length from a typical phone horizontal FOV (~68deg).
//  3. Using the pinhole camera model (distance = real_width * focal_px / box_width_px)
//     to get an approximate distance at each frame.
//  4. Dividing the distance change between frames by elapsed time for closing speed.
// Error sources: the width assumption, the FOV assumption, and that this only measures
// speed directly toward/away from the camera (not a car crossing at an angle) all mean
// this is a real but rough estimate, not a radar-grade reading.
const ASSUMED_VEHICLE_WIDTH_M = 1.8;
const ASSUMED_FOCAL_LENGTH_FACTOR = 0.75; // imageWidthPx * this ≈ focal length in px

export interface TrackedBox {
  id: number;
  bbox: [number, number, number, number];
  score: number;
  label: string;
  confidence?: number;
  speedKmh: number | null;
  // "absolute" -- a real estimate of the OTHER vehicle's own road speed (ego GPS speed
  // combined with the closing/receding rate below), the actual number this feature is meant
  // to show. "closing" -- ego speed wasn't available (no GPS fix, or the phone itself is
  // stationary), so this is only the closing/receding rate between the two vehicles, which is
  // NOT the other vehicle's real speed unless the camera itself happens to be still. Callers
  // must label these differently -- see VehicleDetectionScreen's speedLabel.
  speedKind: "absolute" | "closing" | null;
  state: "moving" | "parked";
  // True for a box re-emitted from a track's grace period below (no fresh detection matched
  // it THIS frame) rather than a real detection just in -- carries the last real bbox/score
  // forward unchanged so the on-screen lock doesn't blink off for a single missed frame (a
  // driver's hand shifting the phone slightly, brief motion blur, momentary occlusion). Purely
  // informational for callers that want it; the box itself renders identically either way, per
  // explicit request that this read as one continuous, strong lock, not a flicker.
  coasting: boolean;
}

interface InternalTrack {
  id: number;
  bbox: [number, number, number, number];
  score: number;
  label: string;
  confidence?: number;
  // Last time this track had an *actual* detection match -- not touched while a track is
  // being carried forward through its grace period below.
  lastSeenMs: number;
  // Smoothed (DISTANCE_SMOOTHING), not the raw per-frame estimate -- see its own comment below
  // for why smoothing this specifically (not just the bbox) was the real fix for wildly jumping
  // speed readings.
  distanceM: number;
  speedKmh: number | null;
  center: [number, number];
  state: "moving" | "parked";
  // When the current run of below-threshold centroid movement started -- null while actually
  // moving. Used to require a *sustained* 2.5s of near-zero displacement before calling a
  // vehicle parked, instead of one still frame (a red light, momentary occlusion) suppressing
  // its speed.
  lowMovementSinceMs: number | null;
  // Consecutive frames of above-threshold movement seen *while parked* -- requires a few in a
  // row before resuming live speed, so a single noisy frame (camera shake) doesn't flicker a
  // truly parked car back to a fake speed reading.
  aboveThresholdStreak: number;
  // Real, explicit request: a brand-new track must be independently re-detected on
  // CONFIRM_FRAMES_REQUIRED consecutive frames before it's ever handed to a caller to render --
  // see that constant's own comment for why this specifically targets one-off spurious
  // detections (a lucky match on a fence/foliage texture pattern that doesn't repeat) without
  // meaningfully delaying a real vehicle, which keeps getting re-detected every tick by
  // definition. Counts real matches only -- never incremented by a grace-period re-emission.
  confirmCount: number;
}

// A parked car's box still jitters a pixel or two frame-to-frame from detector noise alone --
// this is the displacement (as a fraction of frame width) below which movement doesn't count
// as "real" motion. Calibrated at 1x zoom -- the real, confirmed cause of parked cars showing a
// fake speed while zoomed in: the same physical hand tremor covers a proportionally larger
// fraction of a narrower (zoomed-in) field of view, so at 5x zoom ordinary handheld shake alone
// was enough to keep clearing this fixed threshold, which meant lowMovementSinceMs never
// accumulated the sustained PARKED_AFTER_MS needed to ever call the vehicle parked -- it just
// kept computing a "closing rate" out of pure jitter instead. See the zoomFactor multiply at
// each call site below: the threshold widens with zoom so the same real-world tremor doesn't
// register as more motion just because the frame is more zoomed in.
const NOISE_THRESHOLD_RATIO = 0.015;
const PARKED_AFTER_MS = 2500;
// Lowered from 3 -- per explicit request that a car pulling away from a stop picks its speed
// back up immediately, not after a noticeably longer pause than PARKED_AFTER_MS took to settle
// on "parked" in the first place. 2 consecutive above-threshold frames (at the ~300ms Frame
// Processor throttle, ~600ms) is still enough of a real, sustained streak to reject a single
// noisy frame -- see this constant's own use below -- just not a third one on top of that.
const RESUME_AFTER_FRAMES = 2;

// How long a track survives a missed detection before its identity is given up on -- a
// partially-visible or edge-of-frame vehicle can easily fail to detect for a single frame
// even though it's still really there. Without this grace period, that one missed frame
// dropped the track immediately and started a brand new one next frame, meaning a fresh (and
// possibly different) classification attempt for what's actually the same vehicle -- which is
// what showed up as the same ordinary car flip-flopping between "Police car" and "Vehicle".
// Raised from 600ms (2 missed Frame Processor ticks at the 300ms throttle) to 900ms (3 ticks)
// -- real, confirmed cause of the on-screen box vanishing the instant the phone moved even
// slightly: a miss here used to drop the track out of `update()`'s own result entirely (see
// the grace-period loop at the bottom of update() below), not just internally, so the box blinked
// off-screen and any in-progress plate OCR/lightbar sampling for that vehicle reset to zero
// (captureForPlateAndLightbar skips its whole cycle whenever there's no tracked box in frame).
// This alone doesn't fix that -- see the grace-period loop's own comment for the actual fix --
// but a slightly longer window gives handheld camera shake more real margin to resolve within.
const TRACK_GRACE_MS = 900;
// Real, explicit request (screenshot evidence: boxes locking onto static background -- fences,
// palm fronds, brick walls -- indefinitely): a brand-new track's very first detection is exactly
// as likely to be a one-off spurious high-confidence misread on a repeating texture as a real
// vehicle just entering frame -- there was previously nothing here distinguishing the two before
// rendering a box the driver has to look at. A real vehicle keeps getting independently
// re-detected on the very next tick, by definition (it's still there, still driving); a lucky
// false spike on a fence/foliage pattern usually doesn't repeat identically. Requiring 2
// consecutive REAL matches (not a grace-period carry-forward -- see confirmCount's own comment)
// before a track is ever included in `result` below filters out one-off spikes with essentially
// no added latency for a genuine vehicle (one extra ~200ms Frame Processor tick).
const CONFIRM_FRAMES_REQUIRED = 2;
// How far (relative to the larger of the incoming detection's and the candidate track's own
// box size) a detection's center may drift from a track's last known center and still count as
// the same vehicle. 1.2x (the previous, detection-size-only value) was tight enough that an
// ordinary handheld shake -- the phone itself moving a few centimeters, not the vehicle -- could
// shift a distant/small vehicle's on-screen position past it in a single ~300ms tick, spawning a
// brand new track (and resetting plate-OCR/lightbar progress) instead of continuing the real one
// that's still there. Widened, and now taking the larger of both boxes' own dimensions (not just
// the new detection's), so a track doesn't lose its match just because this tick's raw detection
// box happened to come back smaller/further away than usual.
const MATCH_DISTANCE_FACTOR = 1.8;
// How much a tracked box eases toward each new raw detection instead of snapping straight to
// it -- the underlying detector's box coordinates jitter slightly frame to frame even for a
// vehicle that isn't really moving relative to the frame, which read as the box not quite
// "attached" to the vehicle.
const BBOX_SMOOTHING = 0.4;
// The real, confirmed fix for speed readings jumping around (0, then 100, then 25 km/h on a
// vehicle that isn't doing anything of the sort): distance was being estimated from the box
// width of that frame's *raw* detection, not the smoothed box used for rendering -- and since
// speed is a derivative (distance change / a short ~0.7-1.1s time step), even a few pixels of
// ordinary detector width jitter got amplified into a large apparent speed swing every tick.
// Smoothing distance directly (its own EMA, not just inherited from bbox smoothing, since the
// width-to-distance transform is nonlinear) tames that at the source.
const DISTANCE_SMOOTHING = 0.35;
// Second layer of protection: even a smoothed distance signal can still produce one genuinely
// implausible reading (a brief false rematch to a different nearby vehicle, a single very bad
// frame). No real car changes speed anywhere near this fast -- 0-100 km/h in under 4 seconds is
// already supercar-tier acceleration -- so clamp the maximum speed change any single tick is
// allowed to report, relative to elapsed time, rather than ever displaying a physically
// impossible jump.
const MAX_ACCEL_KMH_PER_SEC = 25;

// Real, confirmed false-positive this directly fixes: a clearly parked/stationary vehicle
// reading a small nonzero "closing" speed (e.g. 14 km/h at 5x zoom) purely from box-width
// detector jitter, not any real motion. Scaled by zoom the same way NOISE_THRESHOLD_RATIO is,
// since the same pixel-level width jitter maps to a bigger apparent distance swing at higher
// zoom. See its own call site below for how it's applied.
const CLOSING_RATE_DEADZONE_KMH = 8;

// Below this ego speed, GPS's own noise floor makes combining it with the closing-rate signal
// less reliable than just showing the closing rate honestly on its own -- and at very low
// speed (e.g. stopped at lights) the "vehicle ahead, same direction of travel" assumption this
// combination relies on holds much less often (cross traffic, pedestrians, a car turning).
const EGO_SPEED_MIN_MPS = 1.5; // ~5.4 km/h

/** Real relative-velocity kinematics, not a guess: for a vehicle ahead of the camera traveling
 *  the same direction (the actual, overwhelmingly common case for a forward-facing phone
 *  mounted while driving -- this is not claimed to hold for a vehicle crossing at an angle or
 *  genuinely oncoming, which this app has no way to distinguish from vision alone), the target
 *  vehicle's own road speed = ego's GPS speed minus the closing rate between them (closing
 *  rate positive while approaching).
 *
 *  Auto-detects the "camera itself isn't moving" (formerly the manual "Place & Play" toggle)
 *  case instead of requiring it to be switched on by hand -- per explicit request, vehicle
 *  detection now always behaves this way automatically the moment it has a real (even if
 *  near-zero) GPS reading, rather than needing a separate mode. Whenever ego GPS speed is
 *  confidently known to be low (a phone that's mounted/propped/handheld and not being driven
 *  around), the closing/receding rate between the camera and the target vehicle genuinely IS
 *  that vehicle's own real road speed (same "traveling roughly along the camera's own sightline"
 *  caveat as the driving case above), not just a proxy for it -- so it's reported as a real
 *  "absolute" speed. Only falls back to the honestly-labeled, un-combined "closing" rate when
 *  ego speed isn't known AT ALL yet (no GPS fix), since that's the one case where whether the
 *  camera itself is moving is genuinely unknown, not just low. Never fabricates a number either
 *  way. */
function combineWithEgoSpeed(
  closingKmh: number | null,
  state: "moving" | "parked",
  egoSpeedMps: number | null | undefined
): { speedKmh: number | null; speedKind: "absolute" | "closing" | null } {
  if (state === "parked" || closingKmh === null) return { speedKmh: null, speedKind: null };
  if (egoSpeedMps != null && egoSpeedMps > EGO_SPEED_MIN_MPS) {
    const egoKmh = egoSpeedMps * 3.6;
    return { speedKmh: egoKmh - closingKmh, speedKind: "absolute" };
  }
  if (egoSpeedMps != null) {
    return { speedKmh: closingKmh, speedKind: "absolute" };
  }
  return { speedKmh: closingKmh, speedKind: "closing" };
}

function boxCenter(bbox: [number, number, number, number]): [number, number] {
  return [bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2];
}

function smoothBbox(
  prev: [number, number, number, number],
  next: [number, number, number, number],
  alpha: number
): [number, number, number, number] {
  return [
    prev[0] + (next[0] - prev[0]) * alpha,
    prev[1] + (next[1] - prev[1]) * alpha,
    prev[2] + (next[2] - prev[2]) * alpha,
    prev[3] + (next[3] - prev[3]) * alpha,
  ];
}

// A track's box shrinking sharply in a single ~300ms tick is almost never the real vehicle
// suddenly getting smaller -- it's the underlying detector clipping to a partial, low-confidence
// region on one bad frame (a window/door-width strip instead of the whole car, from a shadow,
// glare, or partial occlusion), which is exactly the "box doesn't match the vehicle, feels weak"
// complaint this fixes. A vehicle receding fast enough to genuinely justify a big width drop that
// quickly would need an implausible relative speed at typical dashcam distances. Growth is
// deliberately NOT clamped the same way -- a vehicle closing distance fast needs to be free to
// grow its box quickly (that's the collision-relevant case), and a detector correcting up from an
// initially-clipped box to the real vehicle size is exactly the "lock on properly" behavior
// wanted, not something to slow down.
const MAX_SHRINK_RATIO_PER_TICK = 0.2;

function clampShrink(
  prev: [number, number, number, number],
  next: [number, number, number, number]
): [number, number, number, number] {
  const minW = prev[2] * (1 - MAX_SHRINK_RATIO_PER_TICK);
  const minH = prev[3] * (1 - MAX_SHRINK_RATIO_PER_TICK);
  if (next[2] >= minW && next[3] >= minH) return next;
  const cx = next[0] + next[2] / 2;
  const cy = next[1] + next[3] / 2;
  const w = Math.max(next[2], minW);
  const h = Math.max(next[3], minH);
  return [cx - w / 2, cy - h / 2, w, h];
}

// A real vehicle framed from behind/front/side (the overwhelming common dashcam angle) is never
// actually taller than it is wide -- a portrait-oriented box is the detector clipping to a
// partial region (a door, a mirror, a window strip) rather than the whole vehicle, the exact
// "box doesn't fit the car, feels like a narrow tall rectangle instead of the real vehicle shape"
// complaint this fixes. Widening a too-narrow box back out to a plausible width (symmetric
// around its own center, height untouched) is a display-only correction -- it never feeds back
// into estimateDistanceM/speed, which read the raw detection's own width directly, so this can't
// corrupt the physics-based speed estimate the way inflating the tracked box's width naively
// would if distance were derived from it after the fact.
// Raised (1.15 -> 1.4) -- real, confirmed evidence (screenshot of a boat-on-trailer misclassified
// as "Heavy Vehicle") showed 1.15 clearing the floor but still reading as a tall, narrow box, not
// a real vehicle's actual proportions -- 1.15 is barely wider than square, not enough margin for
// a typical vehicle's real width:height ratio from behind/front (closer to 1.4-1.8:1 for most
// cars/SUVs at typical dashcam distance).
const MIN_BOX_ASPECT_RATIO = 1.4;

// Real, confirmed bug (screenshot evidence): this used to always fix a too-narrow-for-its-height
// box by WIDENING width to match that height. But the height is very often the axis the detector
// actually got wrong -- a box bleeding into background (a fence, a shed roof, open sky) above/
// below the real vehicle -- and widening based on an already-oversized height just made the box
// even bigger, not tighter. Confirmed exactly this on a real vehicle box spanning nearly the full
// frame height while barely wider than the car itself. Shrinks height down to match width
// instead: width is generally the more trustworthy axis for a side/rear vehicle view (a car's
// left/right edges are usually genuinely in-frame and contrasty against the road, while its top
// edge blurs into whatever's directly behind/above it). Stays symmetric around the box's own
// original vertical center, so this never drifts the box off the real vehicle -- display-only,
// same principle as before: box.bbox itself (fed to estimateDistanceM/speed) is never touched by
// a naive inflation.
function enforceMinAspectRatio(bbox: [number, number, number, number]): [number, number, number, number] {
  const [x, y, w, h] = bbox;
  const minW = h * MIN_BOX_ASPECT_RATIO;
  if (w >= minW) return bbox;
  const maxH = w / MIN_BOX_ASPECT_RATIO;
  const cy = y + h / 2;
  return [x, cy - maxH / 2, w, maxH];
}

// Zooming in narrows the real field of view, which is exactly equivalent (in this pinhole
// model) to a longer focal length -- 5x zoom means the lens is genuinely acting like a focal
// length 5x longer than at 1x, not the same one just cropped. Leaving this unscaled (the bug,
// before this fix) made estimateDistanceM assume the 1x FOV even when actually shooting at 5x,
// so a real vehicle's on-screen box width was being read against the wrong geometry entirely.
function estimateDistanceM(boxWidthPx: number, imageWidthPx: number, zoomFactor: number): number {
  const focalLengthPx = imageWidthPx * ASSUMED_FOCAL_LENGTH_FACTOR * Math.max(zoomFactor, 1);
  return (ASSUMED_VEHICLE_WIDTH_M * focalLengthPx) / Math.max(boxWidthPx, 1);
}

export function createSpeedTracker() {
  let tracks: InternalTrack[] = [];
  let nextId = 1;

  function update(
    detections: {
      bbox: [number, number, number, number];
      score: number;
      label: string;
      confidence?: number;
    }[],
    imageWidthPx: number,
    nowMs: number,
    // Real ego GPS speed (expo-location's coords.speed, m/s) -- optional, and only ever used
    // to turn the closing-rate signal into the target vehicle's actual road speed. Omit or
    // pass null/undefined and every box still gets a real (just differently-labeled) speed
    // reading -- see combineWithEgoSpeed.
    egoSpeedMps?: number | null,
    // The camera's actual current zoom factor (1 = normal/neutral, up to 3 = the app's real
    // 1x-3x zoom slider, fully continuous, not just fixed steps) --
    // see estimateDistanceM's, NOISE_THRESHOLD_RATIO's, and CLOSING_RATE_DEADZONE_KMH's own
    // comments for why the distance estimate, the parked-vehicle noise floor, AND the closing-
    // rate noise floor all need to know this. Defaults to 1 (normal zoom) so existing callers
    // that don't pass it keep their previous behavior exactly.
    zoomFactor = 1
  ): TrackedBox[] {
    const unmatched = new Set(tracks.map((t) => t.id));
    const result: TrackedBox[] = [];
    const nextTracks: InternalTrack[] = [];
    const matchedIds = new Set<number>();

    for (const det of detections) {
      const [cx, cy] = boxCenter(det.bbox);

      let best: InternalTrack | null = null;
      let bestDist = Infinity;
      for (const t of tracks) {
        if (!unmatched.has(t.id)) continue;
        const [tcx, tcy] = boxCenter(t.bbox);
        const d = Math.hypot(cx - tcx, cy - tcy);
        // See MATCH_DISTANCE_FACTOR's own comment -- the larger of either box's own size, not
        // just this tick's incoming detection, so a track doesn't lose its match just because
        // the raw detection happened to come back a different size than the track itself.
        const maxDist =
          Math.max(det.bbox[2], det.bbox[3], t.bbox[2], t.bbox[3]) * MATCH_DISTANCE_FACTOR;
        if (d < maxDist && d < bestDist) {
          best = t;
          bestDist = d;
        }
      }

      const rawDistanceM = estimateDistanceM(det.bbox[2], imageWidthPx, zoomFactor);
      let speedKmh: number | null = null;

      if (best) {
        unmatched.delete(best.id);
        matchedIds.add(best.id);

        const dispRatio = Math.hypot(cx - best.center[0], cy - best.center[1]) / imageWidthPx;
        const movingNow = dispRatio >= NOISE_THRESHOLD_RATIO * Math.max(zoomFactor, 1);

        let state = best.state;
        let lowMovementSinceMs = best.lowMovementSinceMs;
        let aboveThresholdStreak = best.aboveThresholdStreak;

        if (state === "moving") {
          if (movingNow) {
            lowMovementSinceMs = null;
          } else {
            if (lowMovementSinceMs === null) lowMovementSinceMs = nowMs;
            if (nowMs - lowMovementSinceMs >= PARKED_AFTER_MS) state = "parked";
          }
          aboveThresholdStreak = 0;
        } else {
          aboveThresholdStreak = movingNow ? aboveThresholdStreak + 1 : 0;
          if (aboveThresholdStreak >= RESUME_AFTER_FRAMES) {
            state = "moving";
            lowMovementSinceMs = null;
            aboveThresholdStreak = 0;
          }
        }

        // Smoothed against the track's own previous smoothed distance, not the raw estimate --
        // see DISTANCE_SMOOTHING's comment above for why this (not just bbox smoothing) is what
        // actually stops speed from swinging wildly frame to frame.
        const distanceM = best.distanceM + (rawDistanceM - best.distanceM) * DISTANCE_SMOOTHING;

        const dtSec = (nowMs - best.lastSeenMs) / 1000;
        if (state === "moving" && dtSec > 0.15) {
          const closingMPerSec = (best.distanceM - distanceM) / dtSec;
          let rawKmh = closingMPerSec * 3.6;
          // Real, confirmed false-positive: a genuinely stationary vehicle (parked, or just not
          // yet held steady long enough to trip the centroid-based PARKED_AFTER_MS state above)
          // still showed a small but nonzero "closing" speed purely from box-width detector
          // jitter -- worse at high zoom, where estimateDistanceM's own zoom-scaled focal length
          // means the same few pixels of width noise maps to a proportionally bigger swing in
          // estimated distance. Snapping small readings to exactly 0 here (before they ever reach
          // the smoothing/acceleration-clamp below) stops that jitter from ever settling into a
          // stable-looking but fake nonzero number -- while a real vehicle pulling away still
          // clears this floor within a tick or two and picks up its speed immediately, same as
          // MAX_ACCEL_KMH_PER_SEC already allows for the upper end.
          if (Math.abs(rawKmh) < CLOSING_RATE_DEADZONE_KMH * Math.max(zoomFactor, 1)) rawKmh = 0;
          if (best.speedKmh !== null) {
            // Clamp to a physically plausible acceleration -- see MAX_ACCEL_KMH_PER_SEC.
            const maxDeltaKmh = MAX_ACCEL_KMH_PER_SEC * dtSec;
            rawKmh = Math.max(best.speedKmh - maxDeltaKmh, Math.min(best.speedKmh + maxDeltaKmh, rawKmh));
          }
          speedKmh = best.speedKmh === null ? rawKmh : best.speedKmh * 0.7 + rawKmh * 0.3;
        } else if (state === "moving") {
          speedKmh = best.speedKmh;
        } else {
          // Parked -- speed is suppressed entirely rather than left to decay toward zero, so
          // the UI shows a clean "PARKED" state instead of a jittery near-zero number.
          speedKmh = null;
        }

        const bbox = enforceMinAspectRatio(clampShrink(best.bbox, smoothBbox(best.bbox, det.bbox, BBOX_SMOOTHING)));
        // Capped, not left to grow unbounded -- only ever compared against CONFIRM_FRAMES_REQUIRED,
        // so there's no reason for this to keep climbing for the lifetime of a long-tracked
        // vehicle.
        const confirmCount = Math.min(best.confirmCount + 1, CONFIRM_FRAMES_REQUIRED);
        // `speedKmh` above (fed back into the track for next frame's smoothing) always stays
        // the closing/receding rate -- that's the real underlying signal being smoothed frame
        // to frame. The OTHER vehicle's actual road speed (what a driver actually wants to
        // know) is a separate, one-shot combination with the ego vehicle's own GPS speed,
        // computed fresh here for `result` only -- see combineWithEgoSpeed's own comment.
        const { speedKmh: outputSpeedKmh, speedKind } = combineWithEgoSpeed(speedKmh, state, egoSpeedMps);
        nextTracks.push({
          id: best.id,
          bbox,
          score: det.score,
          label: det.label,
          confidence: det.confidence,
          lastSeenMs: nowMs,
          distanceM,
          speedKmh,
          center: [cx, cy],
          state,
          lowMovementSinceMs,
          aboveThresholdStreak,
          confirmCount,
        });
        // See CONFIRM_FRAMES_REQUIRED's own comment -- a track that hasn't yet been
        // independently re-detected enough times isn't handed to the caller to render at all,
        // even though it's already being matched/tracked internally above.
        if (confirmCount >= CONFIRM_FRAMES_REQUIRED) {
          result.push({
            id: best.id,
            bbox,
            score: det.score,
            label: det.label,
            confidence: det.confidence,
            speedKmh: outputSpeedKmh,
            speedKind,
            state,
            coasting: false,
          });
        }
      } else {
        const id = nextId++;
        // Same aspect-ratio floor as the matched-track path -- a brand new track's very first
        // detection can just as easily come back as a narrow partial clip as any later tick,
        // and starting the track off already corrected means every subsequent smoothBbox() call
        // eases from a realistic shape instead of a narrow one.
        const bbox = enforceMinAspectRatio(det.bbox);
        // Never pushed to `result` here -- see CONFIRM_FRAMES_REQUIRED's own comment. A brand
        // new track's very first detection is tracked internally from this tick on (so it CAN be
        // matched and confirmed next tick) but isn't rendered until it clears that bar.
        nextTracks.push({
          id,
          bbox,
          score: det.score,
          label: det.label,
          confidence: det.confidence,
          lastSeenMs: nowMs,
          distanceM: rawDistanceM,
          speedKmh: null,
          center: [cx, cy],
          state: "moving",
          lowMovementSinceMs: null,
          aboveThresholdStreak: 0,
          confirmCount: 1,
        });
        // Deliberately no result.push here -- see CONFIRM_FRAMES_REQUIRED's own comment. This
        // track needs at least one more real match before it's ever handed to a caller to render.
      }
    }

    // Tracks that weren't matched this frame are kept alive for a short grace period in case
    // the miss was just one bad frame (a partially-visible/edge-of-frame vehicle, or -- the
    // real, confirmed cause this specifically fixes -- the phone itself moving a little, which
    // can push a real detection's score or position just far enough that this tick's raw
    // detections don't include/match it at all). Previously these were kept alive internally
    // (for matching purposes) but never re-added to `result`, so the on-screen box -- and, since
    // captureForPlateAndLightbar skips its whole cycle whenever there's no tracked box in frame,
    // any in-progress plate OCR/lightbar sampling too -- blinked off for the entire grace period
    // even though the vehicle never actually left view. Re-emitting the track's own last known
    // bbox/score/label here (coasting: true) keeps the on-screen lock solid through a brief miss
    // instead of flickering, exactly the "strong, immediate, tolerates a little phone movement"
    // behavior this was built for -- it only ever holds the LAST REAL detection steady for up to
    // TRACK_GRACE_MS, never fabricates a new one.
    for (const t of tracks) {
      if (matchedIds.has(t.id)) continue;
      if (nowMs - t.lastSeenMs >= TRACK_GRACE_MS) continue;
      nextTracks.push(t);
      // Same confirmation gate as the matched-track path above -- a track that was never
      // confirmed before it started missing detections (its one and only real match could
      // easily have been the same kind of one-off spurious spike CONFIRM_FRAMES_REQUIRED exists
      // to filter) shouldn't get a free pass into `result` just by surviving its own grace period.
      if (t.confirmCount < CONFIRM_FRAMES_REQUIRED) continue;
      const { speedKmh: outputSpeedKmh, speedKind } = combineWithEgoSpeed(t.speedKmh, t.state, egoSpeedMps);
      result.push({
        id: t.id,
        bbox: t.bbox,
        score: t.score,
        label: t.label,
        confidence: t.confidence,
        speedKmh: outputSpeedKmh,
        speedKind,
        state: t.state,
        coasting: true,
      });
    }

    tracks = nextTracks;
    return result;
  }

  // Every id currently held onto internally, including ones mid-grace-period that didn't
  // produce a box in this frame's `update()` result. Callers caching per-vehicle state (plate
  // OCR reads) need to prune against THIS, not against `update()`'s own return value -- a
  // track surviving a single missed detection frame emits nothing in `result` for that frame,
  // so pruning off `result` alone would wipe that cached state on the very miss the grace
  // period exists to ride out.
  function liveTrackIds(): Set<number> {
    return new Set(tracks.map((t) => t.id));
  }

  return { update, liveTrackIds };
}
