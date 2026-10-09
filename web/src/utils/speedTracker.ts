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
  // The underlying detector's own class for this box ("car"/"truck"/"bus"/"motorcycle") --
  // passed straight through, untouched by the tracker itself, so callers can label without
  // re-deriving it.
  vehicleClass: string;
  speedKmh: number | null;
  // Same pinhole-model estimate used for speed above, exposed directly so callers (e.g. a
  // "closest vehicle" indicator) don't need to re-derive it from bbox width themselves.
  distanceM: number;
  state: "moving" | "parked";
  // Real, explicit request for an occupant count per vehicle -- see OCCUPANT_CONFIRM_FRAMES'
  // own comment for exactly what this is (a spatial correlation against this same model's
  // "person" COCO class, confirm-frame-smoothed) and its real accuracy caveat. null until a
  // vehicle has been tracked long enough to produce a first confirmed read. Never use this for
  // any enforcement/compliance decision without real-world validation first.
  occupantCount: number | null;
}

interface InternalTrack {
  id: number;
  bbox: [number, number, number, number];
  // Last time this track had an *actual* detection match -- not touched while a track is
  // being carried forward through its grace period below, so it doubles as both the speed
  // calculation's elapsed-time base and the "how long has this track been unseen" check.
  lastSeenMs: number;
  distanceM: number;
  speedKmh: number | null;
  center: [number, number];
  state: "moving" | "parked";
  // When the current run of below-threshold centroid movement started -- null while actually
  // moving. Requires a *sustained* 2.5s of near-zero displacement before calling a vehicle
  // parked, instead of one still frame (a red light, momentary occlusion) suppressing speed.
  lowMovementSinceMs: number | null;
  // Consecutive frames of above-threshold movement seen *while parked* -- requires a few in a
  // row before resuming live speed, so one noisy frame doesn't flicker a truly parked car
  // back to a fake speed reading.
  aboveThresholdStreak: number;
  // The most recent raw (unconfirmed) occupant-count read for this track -- -1 is a real
  // sentinel ("no raw read yet"), never a legitimate count. See updateOccupantEstimate.
  occupantCandidate: number;
  occupantCandidateStreak: number;
  occupantCount: number | null;
}

// A parked car's box still jitters a pixel or two frame-to-frame from detector noise alone --
// this is the displacement (as a fraction of frame width) below which movement doesn't count
// as "real" motion.
const NOISE_THRESHOLD_RATIO = 0.015;
const PARKED_AFTER_MS = 2500;
const RESUME_AFTER_FRAMES = 3;

// How long a track survives a missed detection before its identity is given up on. A
// partially-visible or edge-of-frame vehicle (exactly the hard case a phone camera sees a
// lot of) can easily fail to detect for a single frame even though it's still really there --
// without this grace period, that one missed frame used to immediately drop the track and
// start a brand new one next frame, resetting every bit of per-vehicle state (lock-on
// progress, cached plate read) for what's actually the same vehicle.
const TRACK_GRACE_MS = 600;
// How much a tracked box eases toward each new raw detection instead of snapping straight to
// it -- COCO-SSD's box coordinates jitter slightly frame to frame even for a vehicle that
// isn't really moving relative to the frame, which reads as the box not quite "attached" to
// the vehicle. This keeps the drawn box visually steady without meaningfully lagging behind
// real movement.
const BBOX_SMOOTHING = 0.55;
// Distance is a *nonlinear* transform of box width (estimateDistanceM), so smoothing the box
// alone doesn't equally smooth the distance derived from it -- this is its own separate EMA
// against the track's own previous smoothed distance, tamping down exactly the width-to-
// distance amplification that showed up as an occasional real (but wrong) multi-km/h swing
// even with the box itself reading visually steady.
const DISTANCE_SMOOTHING = 0.35;
// Second layer of protection: even a smoothed distance signal can still produce one genuinely
// implausible reading (a brief false rematch to a different nearby vehicle, one very bad
// frame). No real car changes speed anywhere near this fast -- 0-100 km/h in under 4 seconds
// is already supercar-tier acceleration -- so clamp the maximum speed change any single tick
// is allowed to report, relative to elapsed time, rather than ever displaying a physically
// impossible jump.
const MAX_ACCEL_KMH_PER_SEC = 25;
// How much each new speed reading pulls the running average -- weighted well toward history
// since a real speed change plays out over a second or more, not one 120ms detection tick, so
// there's no real cost to leaning harder on smoothing here.
const SPEED_SMOOTHING = 0.25;

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

function estimateDistanceM(boxWidthPx: number, imageWidthPx: number): number {
  const focalLengthPx = imageWidthPx * ASSUMED_FOCAL_LENGTH_FACTOR;
  return (ASSUMED_VEHICLE_WIDTH_M * focalLengthPx) / Math.max(boxWidthPx, 1);
}

// Real, explicit request: an occupant count per tracked vehicle. This correlates COCO-SSD's own
// "person" class detections (already loaded by this same model -- LiveVehicleDetection.tsx just
// discarded them before now) against each vehicle's own box, spatially -- no separate model, no
// extra inference cost. Stated plainly because accuracy claims here carry real weight: this
// model was trained and validated on ordinary COCO pedestrian photos, never on "a person visible
// through a windshield/side window from an external moving camera," which is a materially harder
// case (glass tint/glare/reflection, partial occlusion, small apparent size at normal driving
// distance). Treat every number this produces as a best-effort ESTIMATE, not a verified count --
// never a basis for any enforcement or compliance decision without real-world validation first.
//
// A person-box only counts toward a vehicle if its center falls inside this fraction of the
// vehicle box's own height, measured down from the top -- approximating "the cabin/glass area"
// rather than the bonnet/bumper/wheels, so a pedestrian merely standing or walking near a
// vehicle's lower half at ground level doesn't get counted as an occupant.
const OCCUPANT_CABIN_HEIGHT_FRACTION = 0.85;
// Same "sustained, not a single reading" principle as RESUME_AFTER_FRAMES above -- a person
// detection flickering in/out for one frame shouldn't flip the displayed count; only a run of
// identical raw reads this long does.
const OCCUPANT_CONFIRM_FRAMES = 3;
// A real sanity ceiling, not a tuned accuracy bound -- guards against a pathological frame
// producing an obviously-not-real count instead of something at least physically plausible for
// a normal passenger vehicle.
const OCCUPANT_COUNT_MAX = 8;

function countOccupantCandidates(
  vehicleBbox: [number, number, number, number],
  personBoxes: [number, number, number, number][]
): number {
  const [vx, vy, vw, vh] = vehicleBbox;
  const cabinBottom = vy + vh * OCCUPANT_CABIN_HEIGHT_FRACTION;
  let count = 0;
  for (const p of personBoxes) {
    const px = p[0] + p[2] / 2;
    const py = p[1] + p[3] / 2;
    if (px >= vx && px <= vx + vw && py >= vy && py <= cabinBottom) count++;
  }
  return Math.min(count, OCCUPANT_COUNT_MAX);
}

/** Shared confirm-frame smoothing for the occupant count, reused identically across the
 *  matched/new-track branches below. prevCandidate: -1 (the real "no prior raw read" sentinel)
 *  for a brand-new track. */
function updateOccupantEstimate(
  vehicleBbox: [number, number, number, number],
  personBoxes: [number, number, number, number][],
  prevCandidate: number,
  prevStreak: number,
  prevConfirmed: number | null
): { candidate: number; streak: number; confirmed: number | null } {
  const raw = countOccupantCandidates(vehicleBbox, personBoxes);
  const streak = raw === prevCandidate ? prevStreak + 1 : 1;
  const confirmed = streak >= OCCUPANT_CONFIRM_FRAMES ? raw : prevConfirmed;
  return { candidate: raw, streak, confirmed };
}

export function createSpeedTracker() {
  let tracks: InternalTrack[] = [];
  let nextId = 1;

  function update(
    detections: { bbox: [number, number, number, number]; score: number; vehicleClass: string }[],
    imageWidthPx: number,
    nowMs: number,
    // This tick's raw "person" class detections, in the same coordinate space as `detections`
    // above. Optional/defaults to empty so existing callers that don't pass it keep their
    // previous behavior exactly -- occupantCount just stays null for everyone.
    personBoxes: [number, number, number, number][] = []
  ): TrackedBox[] {
    const unmatched = new Set(tracks.map((t) => t.id));
    const result: TrackedBox[] = [];
    const nextTracks: InternalTrack[] = [];
    const matchedIds = new Set<number>();

    for (const det of detections) {
      const [cx, cy] = boxCenter(det.bbox);
      const maxDist = Math.max(det.bbox[2], det.bbox[3]) * 1.2;

      let best: InternalTrack | null = null;
      let bestDist = Infinity;
      for (const t of tracks) {
        if (!unmatched.has(t.id)) continue;
        const [tcx, tcy] = boxCenter(t.bbox);
        const d = Math.hypot(cx - tcx, cy - tcy);
        if (d < maxDist && d < bestDist) {
          best = t;
          bestDist = d;
        }
      }

      let speedKmh: number | null = null;

      if (best) {
        unmatched.delete(best.id);
        matchedIds.add(best.id);
        // Smooth the box FIRST, then measure distance off the smoothed width -- measuring off
        // the raw incoming detection's width (as this used to) fed every bit of COCO-SSD's
        // normal frame-to-frame box jitter straight into the distance-change calculation, which
        // is exactly what showed up as a parked, genuinely stationary vehicle reporting a real
        // (fake) closing/receding speed: a few pixels of box-width noise translates to a real
        // multi-km/h swing once divided by a ~120ms tick.
        const bbox = smoothBbox(best.bbox, det.bbox, BBOX_SMOOTHING);
        // Smoothed against the track's own previous smoothed distance, not just inherited from
        // the bbox smoothing above -- see DISTANCE_SMOOTHING's comment for why the nonlinear
        // width-to-distance transform needs its own separate easing.
        const rawDistanceM = estimateDistanceM(bbox[2], imageWidthPx);
        const distanceM = best.distanceM + (rawDistanceM - best.distanceM) * DISTANCE_SMOOTHING;

        const [cx, cy] = boxCenter(bbox);
        const dispRatio = Math.hypot(cx - best.center[0], cy - best.center[1]) / imageWidthPx;
        const movingNow = dispRatio >= NOISE_THRESHOLD_RATIO;

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

        const dtSec = (nowMs - best.lastSeenMs) / 1000;
        // Guards only against a near-zero elapsed time (which would spike the division below),
        // not against the detector's normal ~120ms cadence -- this used to be 0.15s, comfortably
        // *above* that cadence, which happened to work only because other per-frame work (the
        // classifier that used to run here) usually pushed real elapsed time past it anyway.
        // With that removed, passes run closer to the raw ~120ms throttle, and a threshold above
        // the normal cadence would have silently stopped speed from updating at all most frames.
        if (state === "moving" && dtSec > 0.05) {
          const closingMPerSec = (best.distanceM - distanceM) / dtSec;
          let rawKmh = closingMPerSec * 3.6;
          if (best.speedKmh !== null) {
            // Clamp to a physically plausible acceleration -- see MAX_ACCEL_KMH_PER_SEC.
            const maxDeltaKmh = MAX_ACCEL_KMH_PER_SEC * dtSec;
            rawKmh = Math.max(best.speedKmh - maxDeltaKmh, Math.min(best.speedKmh + maxDeltaKmh, rawKmh));
          }
          // Smooth against the previous reading so it doesn't jitter frame to frame.
          speedKmh = best.speedKmh === null ? rawKmh : best.speedKmh * (1 - SPEED_SMOOTHING) + rawKmh * SPEED_SMOOTHING;
        } else if (state === "moving") {
          speedKmh = best.speedKmh;
        } else {
          // Parked -- suppressed entirely rather than left to decay toward zero, so the UI
          // shows a clean "PARKED" state instead of a jittery near-zero number.
          speedKmh = null;
        }

        const {
          candidate: occupantCandidate,
          streak: occupantCandidateStreak,
          confirmed: occupantCount,
        } = updateOccupantEstimate(
          bbox,
          personBoxes,
          best.occupantCandidate,
          best.occupantCandidateStreak,
          best.occupantCount
        );
        nextTracks.push({
          id: best.id,
          bbox,
          lastSeenMs: nowMs,
          distanceM,
          speedKmh,
          center: [cx, cy],
          state,
          lowMovementSinceMs,
          aboveThresholdStreak,
          occupantCandidate,
          occupantCandidateStreak,
          occupantCount,
        });
        result.push({
          id: best.id,
          bbox,
          score: det.score,
          vehicleClass: det.vehicleClass,
          speedKmh,
          distanceM,
          state,
          occupantCount,
        });
      } else {
        const distanceM = estimateDistanceM(det.bbox[2], imageWidthPx);
        const id = nextId++;
        // First-ever raw read for this track -- no prior candidate/streak to compare against,
        // so this always starts its own fresh streak (see updateOccupantEstimate's -1
        // sentinel). Not confirmed yet either way, same "never fabricate on a brand-new track"
        // principle as speedKmh starting at null just below.
        const { candidate: occupantCandidate, streak: occupantCandidateStreak } = updateOccupantEstimate(
          det.bbox,
          personBoxes,
          -1,
          0,
          null
        );
        nextTracks.push({
          id,
          bbox: det.bbox,
          lastSeenMs: nowMs,
          distanceM,
          speedKmh: null,
          center: boxCenter(det.bbox),
          state: "moving",
          lowMovementSinceMs: null,
          aboveThresholdStreak: 0,
          occupantCandidate,
          occupantCandidateStreak,
          occupantCount: null,
        });
        result.push({
          id,
          bbox: det.bbox,
          score: det.score,
          vehicleClass: det.vehicleClass,
          speedKmh: null,
          distanceM,
          state: "moving",
          occupantCount: null,
        });
      }
    }

    // Tracks that weren't matched this frame are kept alive (not shown, since there's no
    // fresh detection to draw a box for) for a short grace period in case the miss was just
    // one bad frame, instead of immediately discarding their identity.
    for (const t of tracks) {
      if (!matchedIds.has(t.id) && nowMs - t.lastSeenMs < TRACK_GRACE_MS) {
        nextTracks.push(t);
      }
    }

    tracks = nextTracks;
    return result;
  }

  // Every id currently held onto internally, including ones mid-grace-period that didn't
  // produce a box in this frame's `update()` result. Callers that cache per-vehicle state
  // (plate OCR reads, lightbar samples, lock-on progress) need to prune against THIS, not
  // against `update()`'s own return value -- a track surviving a single missed detection
  // frame emits nothing in `result` for that frame, so pruning off `result` alone would wipe
  // that cached state on the very miss the grace period exists to ride out.
  function liveTrackIds(): Set<number> {
    return new Set(tracks.map((t) => t.id));
  }

  return { update, liveTrackIds };
}
