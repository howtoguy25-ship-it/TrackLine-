import { useEffect, useRef, useState, useCallback } from "react";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import { createSpeedTracker } from "@/utils/speedTracker";
import { sampleLightbarActivity, pruneLightbarTracks } from "@/utils/lightbarDetector";
import { locatePlate, isFrontOrRearFacing } from "@/utils/plateLocator";
import { warmUpPlateOcr, readPlateText } from "@/services/plateOcr";
import { normalizeAngleDeg, formatDistance } from "@/utils/navFormat";
import { NavActionsRow } from "@/components/NavActionsRow";
import "./LiveVehicleDetection.css";

// COCO-SSD (the pretrained model this runs) only knows generic COCO classes -- "car" / "truck"
// / "bus" / "motorcycle" -- and that's exactly what gets shown: "Vehicle" for a car/motorcycle,
// "Heavy Vehicle" for a truck/bus. This app previously ran a second, custom-trained classifier
// behind it to guess ambulance/firetruck/police-car specifically, but repeated real-world
// testing (including on ordinary cars and even stylized/CGI vehicles it had never seen) kept
// producing confidently-wrong "Police car" results even after tightening its confidence bar
// twice -- a ~500-image training set just isn't enough to make that fine a call reliably. Fixed
// honestly by not making that claim at all rather than continuing to tune a guess that kept
// being wrong: the generic vehicle-type label below is what COCO-SSD is actually good at.
const VEHICLE_CLASSES = new Set(["car", "truck", "bus", "motorcycle"]);
const HEAVY_VEHICLE_CLASSES = new Set(["truck", "bus"]);

// Cap detection passes instead of running one every single animation frame -- COCO-SSD
// inference (plus the per-box classifier and lightbar sampling riding on top of it) is heavy
// enough that running it unthrottled pegs the CPU/GPU the whole time this view is open, which
// is what actually reads as "lag" (jank, heat, battery drain) even though each individual
// frame renders fine. ~8 detections/sec is still smooth for bounding boxes that track a moving
// vehicle from a phone/laptop camera.
const MIN_DETECT_INTERVAL_MS = 120;
// While actively navigating, the map underneath is also doing real work (GPS tracking,
// directions/ETA recompute, voice guidance, the guide-ribbon canvas draw) and this view's own
// COCO-SSD inference is already the heaviest thing running -- a slightly slower cadence here
// (same ~1.6x ease mobile applies for the same reason) trades a bit of detection smoothness for
// headroom during exactly the condition most likely to make the tab stutter.
const MIN_DETECT_INTERVAL_MS_NAVIGATING = 200;

// Consecutive detection passes (not wall-clock time, since passes are already throttled
// above) a vehicle needs to be matched to the same track id before it's shown as "locked
// on" -- avoids the lock indicator flickering onto a box that only appeared for a frame
// or two. ~6 passes at the 120ms throttle above is roughly 700ms of stable tracking.
const LOCK_FRAMES_THRESHOLD = 6;

// A plate read that fails isn't necessarily an unreadable plate -- it might just be a bad
// frame (motion blur, glare, mid-jitter crop). Retries a confidently-located but not-yet-read
// plate at this cadence (not every detection pass -- OCR is too expensive and there's only one
// shared Tesseract worker for every vehicle in frame to share) up to a capped number of tries,
// so a genuinely legible plate on a vehicle that's around for more than a moment gets several
// real chances instead of one.
const PLATE_RETRY_INTERVAL_MS = 900;
const MAX_PLATE_ATTEMPTS = 8;

// Self-hosted, same-origin copy of the exact model coco-ssd's own load({base:
// "lite_mobilenet_v2"}) would otherwise fetch from storage.googleapis.com -- real parity with
// mobile's own "bundle the model, don't depend on a network fetch every open" fix (see
// src/services/vehicleDetection.ts's loadModelSkippingWarmup). Served straight out of
// web/public/models the same way the (currently-unused) vehicle-classifier model already was --
// same origin as the rest of the site, so it rides the same CDN/caching Render already gives
// every other asset, with no separate third-party domain in the loading path at all. Falls back
// to Google's own hosted copy if the local one ever fails to load (a bad deploy, a path typo)
// rather than hard-failing when the network fallback would still work fine.
const LOCAL_MODEL_URL = "/models/ssdlite_mobilenet_v2/model.json";

// A slow/stalled connection (whichever copy ends up being fetched) can still leave the view
// stuck on "Loading detection model…" forever with no way out but Close. Same idea for
// getUserMedia, which can hang indefinitely on some browsers/devices (e.g. a permission prompt
// that never resolves). Both are raced against a generous-but-bounded timeout so a stall
// surfaces the existing error+Retry UI instead of looking frozen.
const MODEL_LOAD_TIMEOUT_MS = 20000;
const CAMERA_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

type FacingMode = "environment" | "user";

// Live nav info passed in only while navigation is active, so this view can show where to
// go without the driver needing to exit back to the map. The guide line is a schematic
// compass-bearing indicator (GPS bearing-to-next-turn vs. direction of travel), not true
// ground-projected AR — it's a real, physically-derived direction, just not photorealistic.
export interface DetectionNavContext {
  instructionText: string;
  distanceToManeuverM: number | null;
  etaText: string;
  arrivalClockText: string;
  distanceRemainingText: string;
  bearingToManeuverDeg: number | null;
  travelHeadingDeg: number;
  hideTrace: boolean;
  hasStop: boolean;
  onAddStop: () => void;
  onShareEta: () => void;
  onReportAlert: () => void;
}

interface Props {
  onClose: () => void;
  navContext?: DetectionNavContext | null;
}

// Quadratic bezier point + tangent, used to build a tapering ribbon instead of a single
// stroked line -- this is what actually reads as a flat strip lying on the ground receding
// into the distance (wide near the viewer, narrowing toward a vanishing point) rather than a
// line floating in space. Still a schematic GPS-bearing indicator, not true SLAM/ARKit ground
// tracking (this view has no depth/plane data to project onto) -- see the DetectionNavContext
// comment above -- but shaped to actually look like a road-level guide instead of an arrow.
function bezierPoint(p0: number, p1: number, p2: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function bezierTangent(p0: number, p1: number, p2: number, t: number): number {
  return 2 * (1 - t) * (p1 - p0) + 2 * t * (p2 - p1);
}

function drawGuideRibbon(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  relativeAngleDeg: number,
  nowMs: number
) {
  const startX = canvasWidth / 2;
  const startY = canvasHeight;
  const clamped = Math.max(-90, Math.min(90, relativeAngleDeg));
  const t = clamped / 90; // -1..1
  const endX = canvasWidth / 2 + t * canvasWidth * 0.38;
  const endY = canvasHeight * 0.4;
  const controlX = canvasWidth / 2 + t * canvasWidth * 0.15;
  const controlY = canvasHeight * 0.75;

  const SEGMENTS = 24;
  const BASE_WIDTH = canvasWidth * 0.09;
  const TIP_WIDTH = canvasWidth * 0.012;
  const points: { x: number; y: number; nx: number; ny: number; width: number }[] = [];

  for (let i = 0; i <= SEGMENTS; i++) {
    const p = i / SEGMENTS;
    const x = bezierPoint(startX, controlX, endX, p);
    const y = bezierPoint(startY, controlY, endY, p);
    const dx = bezierTangent(startX, controlX, endX, p);
    const dy = bezierTangent(startY, controlY, endY, p);
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular unit normal to the direction of travel along the curve.
    const nx = -dy / len;
    const ny = dx / len;
    // Ease-out taper reads more like true perspective foreshortening than a linear narrow.
    const width = BASE_WIDTH + (TIP_WIDTH - BASE_WIDTH) * Math.sqrt(p);
    points.push({ x, y, nx, ny, width });
  }

  ctx.save();

  // The flat strip itself: a filled, tapering polygon (left edge out, right edge back),
  // not a stroked line -- this is what actually sells "lying on the ground" over "arrow".
  const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
  gradient.addColorStop(0, "rgba(37, 99, 235, 0.85)");
  gradient.addColorStop(1, "rgba(96, 165, 250, 0.35)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  points.forEach((pt, i) => {
    const lx = pt.x + pt.nx * (pt.width / 2);
    const ly = pt.y + pt.ny * (pt.width / 2);
    if (i === 0) ctx.moveTo(lx, ly);
    else ctx.lineTo(lx, ly);
  });
  for (let i = points.length - 1; i >= 0; i--) {
    const pt = points[i];
    const rx = pt.x - pt.nx * (pt.width / 2);
    const ry = pt.y - pt.ny * (pt.width / 2);
    ctx.lineTo(rx, ry);
  }
  ctx.closePath();
  ctx.fill();

  // Center-line lane ticks flowing toward the destination, animated by wall-clock time --
  // reinforces the "flat road surface" read instead of a floating tube.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = Math.max(2, canvasWidth * 0.006);
  ctx.lineCap = "round";
  ctx.setLineDash([canvasWidth * 0.02, canvasWidth * 0.035]);
  ctx.lineDashOffset = -((nowMs / 26) % (canvasWidth * 0.055));
  ctx.beginPath();
  points.forEach((pt, i) => {
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // A real destination marker (pin), not just an arrowhead -- the strip visibly connects to
  // a point, matching a turn/waypoint marker instead of trailing off into empty space.
  const pulse = 1 + 0.12 * Math.sin(nowMs / 260);
  ctx.fillStyle = "#1D4ED8";
  ctx.beginPath();
  ctx.arc(endX, endY, 13 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(endX, endY, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Four corner brackets drawn just inside a tracked box's own corners, independent of the
// box's own outline color -- reads as a distinct "locked on" state for whichever vehicles
// have earned it (see LOCK_FRAMES_THRESHOLD) without touching the vehicle-type box color
// itself. Purely a function of that one box's own coordinates, so drawing it for several
// vehicles at once never overlaps or interferes with any other vehicle's box.
function drawLockBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const len = Math.min(w, h) * 0.22;
  ctx.strokeStyle = "#4ADE80";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + w, y + h - len);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - len, y + h);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + len, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

// COCO-SSD's own overlap suppression only merges two boxes of the same class when they overlap
// by IOU (intersection over the UNION of both boxes), and a real failure mode this app kept
// hitting is a second, much larger phantom box that almost entirely contains a tight, correct
// one for the same physical vehicle -- their IOU stays well under the usual threshold (the
// union is dominated by the big box's extra area) even though a person looking at it instantly
// sees "that's the same car, twice." This catches that specific case by containment instead:
// if a much bigger box almost entirely covers a smaller one, the smaller, tighter box is far
// more likely to be the genuine detection (a real detection hugs its object; an anomalously
// oversized one swallowing a normal-sized box is the classic spurious-detection shape), so the
// bigger one is dropped regardless of which one scored higher. This is a real heuristic, not a
// guarantee -- a legitimately huge vehicle with an unrelated spurious box detected deep inside
// it would be misjudged the same way, but that hasn't been the failure mode actually observed.
const DUPLICATE_CONTAINMENT_THRESHOLD = 0.85;
const DUPLICATE_SIZE_RATIO_THRESHOLD = 1.6;

function boxArea(b: [number, number, number, number]): number {
  return b[2] * b[3];
}

function intersectionArea(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return ix * iy;
}

function dedupeOversizedDuplicates<T extends { bbox: [number, number, number, number] }>(detections: T[]): T[] {
  const drop = new Set<number>();
  for (let i = 0; i < detections.length; i++) {
    const areaI = boxArea(detections[i].bbox);
    for (let j = 0; j < detections.length; j++) {
      if (i === j || drop.has(i)) continue;
      const areaJ = boxArea(detections[j].bbox);
      if (areaI <= areaJ * DUPLICATE_SIZE_RATIO_THRESHOLD) continue;
      const containment = intersectionArea(detections[i].bbox, detections[j].bbox) / areaJ;
      if (containment >= DUPLICATE_CONTAINMENT_THRESHOLD) drop.add(i);
    }
  }
  return detections.filter((_, idx) => !drop.has(idx));
}

export function LiveVehicleDetection({ onClose, navContext }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDetectMsRef = useRef(0);
  const modelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const speedTrackerRef = useRef(createSpeedTracker());
  // One-attempt-per-track caching for OCR'd plate text --
  // real text recognition is far too slow to run every frame (100ms-1s+ per attempt), so
  // each tracked vehicle only ever gets one read attempt, cached (or cached as "unreadable"
  // via null) for the rest of its time in frame.
  // Only ever holds a CONFIRMED real read (a track id with no entry just hasn't been read
  // yet, or hasn't succeeded yet) -- unlike a single-attempt cache, a failed read is not
  // stored here, so a vehicle whose plate is genuinely legible but caught a bad frame (motion
  // blur, glare, a partial view) gets more chances instead of being permanently given up on
  // after one unlucky attempt.
  const plateTextRef = useRef(new Map<number, string>());
  const platesReadingRef = useRef(new Set<number>());
  // Retry bookkeeping for the above: how many attempts a track has had, and when the last one
  // was, so retries are spaced out (OCR is expensive, and there's only one shared Tesseract
  // worker -- see plateOcr.ts -- so hammering it every single frame would just queue up and
  // starve every vehicle's reads, not speed any of them up) and eventually give up on a
  // vehicle that's had a fair number of genuine tries and still hasn't produced a confident
  // read, rather than retrying forever.
  const plateAttemptsRef = useRef(new Map<number, number>());
  const plateLastAttemptMsRef = useRef(new Map<number, number>());
  // Consecutive-detection-pass counter per track id, backing the "locked on" indicator --
  // see LOCK_FRAMES_THRESHOLD above.
  const lockFramesRef = useRef(new Map<number, number>());
  // Read inside the detect loop's closure without re-subscribing the effect on every nav tick.
  const navContextRef = useRef(navContext);
  navContextRef.current = navContext;

  const [status, setStatus] = useState<"loading-model" | "requesting-camera" | "running" | "error">(
    "loading-model"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Back camera by default (better for spotting vehicles out the windshield); front camera
  // is the fallback on laptops/desktops that don't have a rear-facing one at all.
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  // The long how-this-works explainer only needs to be read once -- remembered permanently
  // (like the night-mode prompt in App.tsx) instead of blocking the camera view with the same
  // paragraph every single time AI Detection is opened.
  const [infoDismissed, setInfoDismissed] = useState(
    () => localStorage.getItem("trackline.aiDetectionInfoDismissed") === "1"
  );
  const dismissInfo = () => {
    setInfoDismissed(true);
    localStorage.setItem("trackline.aiDetectionInfoDismissed", "1");
  };

  // Bumping this re-runs the load effect below from scratch (model load + camera request) --
  // the actual escape hatch for a stalled load, since Close is the only other option once
  // status is "error".
  const [retryCount, setRetryCount] = useState(0);
  const retryLoad = useCallback(() => {
    setErrorMessage(null);
    setStatus("loading-model");
    setRetryCount((n) => n + 1);
  }, []);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        const cameraCount = devices.filter((d) => d.kind === "videoinput").length;
        setCanSwitchCamera(cameraCount > 1);
      })
      .catch(() => setCanSwitchCamera(false));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        if (!modelRef.current) {
          await tf.ready();
          try {
            modelRef.current = await withTimeout(
              cocoSsd.load({ base: "lite_mobilenet_v2", modelUrl: LOCAL_MODEL_URL }),
              MODEL_LOAD_TIMEOUT_MS,
              "Detection model load"
            );
          } catch (localErr) {
            console.warn("[detection] local model load failed, falling back to Google's CDN", localErr);
            modelRef.current = await withTimeout(
              cocoSsd.load({ base: "lite_mobilenet_v2" }),
              MODEL_LOAD_TIMEOUT_MS,
              "Detection model load"
            );
          }
          if (cancelled) return;
          warmUpPlateOcr();
        }

        setStatus("requesting-camera");
        streamRef.current?.getTracks().forEach((t) => t.stop());
        // Without an explicit resolution request, browsers are free to default to something
        // modest (640x480 on plenty of devices) -- fine for the vehicle boxes themselves, but
        // measured (via a real Tesseract OCR test against synthetic plate crops at varying
        // sizes) to be the actual reason a clearly-visible plate wasn't reading: OCR read a
        // 260x90-native plate crop correctly at 96% confidence, but dropped to 0% once the
        // native crop fell under roughly 40-55px wide -- and upscaling a too-small crop
        // afterward (see plateOcr.ts) can't recover detail that was never captured. `ideal`
        // (not `min`/`exact`) still falls back gracefully on cameras that can't do this.
        const stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({
            video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          }),
          CAMERA_TIMEOUT_MS,
          "Camera access"
        );
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        setStatus("running");
        detectLoop();
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Camera or model failed to start.";
        setErrorMessage(`${message} -- tap Retry to try again.`);
        setStatus("error");
      }
    }

    function detectLoop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const model = modelRef.current;
      if (!video || !canvas || !model || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(detectLoop);
        return;
      }

      const nowMs = performance.now();
      const minInterval = navContextRef.current ? MIN_DETECT_INTERVAL_MS_NAVIGATING : MIN_DETECT_INTERVAL_MS;
      if (nowMs - lastDetectMsRef.current < minInterval) {
        rafRef.current = requestAnimationFrame(detectLoop);
        return;
      }
      lastDetectMsRef.current = nowMs;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Raised from the library default of 20 -- that cap is shared across every COCO class
      // detected in frame (not just vehicles), so a busy/"smushed" multi-car scene can starve
      // out slots that would otherwise be a real vehicle box. minScore is intentionally left
      // at the library default: COCO-SSD's own NMS step reuses that same number as both the
      // confidence bar AND the overlap-tolerance between boxes, so raising it to merge tightly
      // packed cars less aggressively would also filter out real detections -- not a knob that
      // can be tuned to only help, so it's left alone rather than traded against itself.
      model.detect(video, 30).then((predictions) => {
        const rawVehicleDetections = predictions
          .filter((p) => VEHICLE_CLASSES.has(p.class))
          .map((p) => ({ bbox: p.bbox as [number, number, number, number], score: p.score, vehicleClass: p.class }));
        // Real, explicit request for an occupant-count estimate per vehicle -- see
        // speedTracker.ts's OCCUPANT_CABIN_HEIGHT_FRACTION for the full accuracy caveat (a
        // best-effort estimate, never a certified count). COCO-SSD already detects "person" as
        // one of its 80 standard classes; this model call already ran it, so keeping these
        // costs nothing extra -- they were simply discarded before now. Held to a higher score
        // bar than vehicles: a wrong "person" read directly inflates a count someone might
        // actually rely on, a costlier mistake than a slightly-late vehicle box.
        const PERSON_MIN_SCORE = 0.5;
        const personBoxes = predictions
          .filter((p) => p.class === "person" && p.score >= PERSON_MIN_SCORE)
          .map((p) => p.bbox as [number, number, number, number]);
        // Collapses a spurious oversized duplicate box down to just the tight, correct one for
        // the same vehicle BEFORE tracking ever sees it -- de-duping after the fact would mean
        // the phantom box had already spun up its own track id, its own lock-on progress, and
        // its own (likely-doomed, since its crop is wrong) plate attempts.
        const vehicleDetections = dedupeOversizedDuplicates(rawVehicleDetections);
        const tracked = speedTrackerRef.current.update(vehicleDetections, canvas.width, performance.now(), personBoxes);
        // Includes ids still alive in a grace period even if they produced no box this frame
        // -- see liveTrackIds() in speedTracker.ts for why pruning off `tracked` itself would
        // wipe per-vehicle cached state (plate reads, lock-on progress) on a single missed frame.
        const liveTrackIds = speedTrackerRef.current.liveTrackIds();
        pruneLightbarTracks(liveTrackIds);
        for (const id of plateTextRef.current.keys()) {
          if (!liveTrackIds.has(id)) plateTextRef.current.delete(id);
        }
        for (const id of plateAttemptsRef.current.keys()) {
          if (!liveTrackIds.has(id)) {
            plateAttemptsRef.current.delete(id);
            plateLastAttemptMsRef.current.delete(id);
          }
        }
        for (const id of lockFramesRef.current.keys()) {
          if (!liveTrackIds.has(id)) lockFramesRef.current.delete(id);
        }

        // Nearest vehicle = largest apparent width = smallest pinhole-model distance estimate
        // (see speedTracker.ts). Computed once per pass rather than per-box below so every
        // box's "am I the closest" check is just an id comparison, not a fresh scan.
        let closestId: number | null = null;
        let closestDistanceM = Infinity;
        for (const box of tracked) {
          if (box.distanceM < closestDistanceM) {
            closestDistanceM = box.distanceM;
            closestId = box.id;
          }
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const nav = navContextRef.current;
        if (nav && !nav.hideTrace && nav.bearingToManeuverDeg !== null) {
          const relativeAngle = normalizeAngleDeg(nav.bearingToManeuverDeg - nav.travelHeadingDeg);
          drawGuideRibbon(ctx, canvas.width, canvas.height, relativeAngle, performance.now());
        }

        for (const box of tracked) {
          const [x, y, w, h] = box.bbox;

          // Every vehicle in frame accrues its own lock count independently off its own track
          // id, so several cars lock on (or lose lock, if one drops out and its id is pruned
          // above) at the same time without any of them affecting each other.
          const lockFrames = (lockFramesRef.current.get(box.id) ?? 0) + 1;
          lockFramesRef.current.set(box.id, lockFrames);
          const isClosest = box.id === closestId && tracked.length > 1;

          // A vehicle seen face-on (front/rear) is a good enough view to trust the plate
          // estimate, the speed model, and the lock-on indicator -- all three assume you're
          // looking at the vehicle's actual width, which isn't true side-on (see
          // isFrontOrRearFacing in plateLocator.ts). A vehicle caught side-on (like two trucks
          // passing each other across the frame) just gets its plain box and type instead of
          // guessing at any of those three off an angle the math doesn't support.
          const goodView = isFrontOrRearFacing(box.bbox);
          const isLocked = goodView && lockFrames >= LOCK_FRAMES_THRESHOLD;

          // Real-time pixel heuristic for an actively strobing red/blue light (see
          // lightbarDetector.ts) -- independent evidence, not a classification guess, so it
          // isn't gated by vehicle type or viewing angle the way the speed/plate/lock
          // treatment above is.
          const lightsActive = sampleLightbarActivity(video, box.id, box.bbox, performance.now());
          const boxColor = lightsActive ? "#7C3AED" : "#F59E0B";

          ctx.strokeStyle = boxColor;
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, w, h);
          if (isLocked) drawLockBrackets(ctx, x, y, w, h);

          const vehicleTypeLabel = HEAVY_VEHICLE_CLASSES.has(box.vehicleClass) ? "Heavy Vehicle" : "Vehicle";
          const prefix = (isClosest ? "🎯 Closest · " : "") + (isLocked ? "🔒 " : "");
          // Real, explicit request for a live distance readout per vehicle, "radar style" --
          // the same smoothed pinhole-model estimate speedTracker.ts already computes for the
          // speed math (see its own DISTANCE_SMOOTHING/distanceM comments for the accuracy
          // caveat), just surfaced on screen now instead of only being used internally to find
          // the closest vehicle.
          const label = lightsActive
            ? `${prefix}Unmarked police? (lights active)`
            : `${prefix}${vehicleTypeLabel} ${Math.round(box.score * 100)}% · ${formatDistance(box.distanceM)}`;
          ctx.font = "16px system-ui, sans-serif";
          const textWidth = ctx.measureText(label).width;
          ctx.fillStyle = boxColor;
          ctx.fillRect(x, Math.max(0, y - 22), textWidth + 10, 22);
          // The violet "unmarked" box is darker than the amber one, so it needs light text
          // instead of the usual dark text to stay readable.
          ctx.fillStyle = lightsActive ? "#ffffff" : "#111827";
          ctx.fillText(label, x + 5, Math.max(16, y - 6));

          // Speed/parked state anchored top-right, just outside the box edge, separate from
          // the type/lock label at top-left -- "Steady" once locked doesn't say anything the
          // lock brackets don't already, so it's dropped once locked.
          const speedLabel =
            !goodView
              ? null
              : box.state === "parked"
                ? "PARKED"
                : box.speedKmh === null
                  ? null
                  : Math.abs(box.speedKmh) < 3
                    ? (isLocked ? null : "steady")
                    : `${box.speedKmh > 0 ? "▲" : "▼"} ${Math.round(Math.abs(box.speedKmh))} km/h`;
          if (speedLabel) {
            ctx.font = "bold 13px system-ui, sans-serif";
            const speedWidth = ctx.measureText(speedLabel).width;
            ctx.fillStyle = box.state === "parked" ? "#4B5563" : "#111827";
            ctx.fillRect(x + w - speedWidth - 10, Math.max(0, y - 22), speedWidth + 10, 22);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(speedLabel, x + w - speedWidth - 5, Math.max(16, y - 6));
          }

          // Real, explicit request for an occupant-count estimate per vehicle. "(est.)" stays
          // in the text itself, always -- see speedTracker.ts's OCCUPANT_CABIN_HEIGHT_FRACTION
          // comment for exactly why this is a best-effort spatial correlation, never a
          // certified count, and must never be presented as one. null (box.occupantCount, from
          // the tracker) draws nothing at all, same "never fabricate a number" rule as
          // speedLabel above. Anchored bottom-right of the box, a plain muted grey/small size
          // so it doesn't visually compete with the real safety-relevant speed readout.
          if (box.occupantCount !== null) {
            const occupantLabel = `${box.occupantCount} occupant${box.occupantCount === 1 ? "" : "s"} (est.)`;
            ctx.font = "11px system-ui, sans-serif";
            const occupantWidth = ctx.measureText(occupantLabel).width;
            ctx.fillStyle = "rgba(17, 24, 39, 0.75)";
            ctx.fillRect(x + w - occupantWidth - 10, y + h + 2, occupantWidth + 10, 18);
            ctx.fillStyle = "#D1D5DB";
            ctx.fillText(occupantLabel, x + w - occupantWidth - 5, y + h + 15);
          }

          // Real, live-computed plate-region estimate (see plateLocator.ts) -- NOT plate
          // reading/OCR, just where the plate likely is, and it already returns null for a
          // side-on view (isFrontOrRearFacing) so nothing gets attempted at a bad angle.
          const plate = goodView ? locatePlate(video, box.bbox) : null;
          if (plate) {
            // Retries a confidently-located plate that hasn't been read yet, spaced out (not
            // every detection pass) and capped, instead of giving up forever after one unlucky
            // frame -- see PLATE_RETRY_INTERVAL_MS/MAX_PLATE_ATTEMPTS above for why. Stops the
            // moment a real read succeeds (plateTextRef gets an entry) or the attempt cap is
            // reached.
            const alreadyRead = plateTextRef.current.has(box.id);
            const attempts = plateAttemptsRef.current.get(box.id) ?? 0;
            const lastAttemptMs = plateLastAttemptMsRef.current.get(box.id) ?? 0;
            // The very first attempt fires immediately once a plate is confidently located --
            // only the SECOND and later retries wait out the interval. (Comparing against
            // performance.now() directly for attempt 0 would happen to work anyway, since
            // performance.now() is already well past PLATE_RETRY_INTERVAL_MS by the time the
            // model/camera have finished loading -- but that's an accident of timing, not
            // something this should quietly depend on.)
            const readyToRetry =
              attempts < MAX_PLATE_ATTEMPTS &&
              (attempts === 0 || performance.now() - lastAttemptMs >= PLATE_RETRY_INTERVAL_MS);
            if (!alreadyRead && readyToRetry && !platesReadingRef.current.has(box.id)) {
              platesReadingRef.current.add(box.id);
              plateAttemptsRef.current.set(box.id, attempts + 1);
              plateLastAttemptMsRef.current.set(box.id, performance.now());
              const cropCanvas = document.createElement("canvas");
              // Upscale the (tiny) plate crop before OCR -- Tesseract reads small text far
              // more reliably when it isn't asked to work from a handful of source pixels.
              const scale = Math.max(1, 120 / plate.w);
              cropCanvas.width = Math.round(plate.w * scale);
              cropCanvas.height = Math.round(plate.h * scale);
              const cropCtx = cropCanvas.getContext("2d");
              if (cropCtx) {
                cropCtx.drawImage(video, plate.x, plate.y, plate.w, plate.h, 0, 0, cropCanvas.width, cropCanvas.height);
                readPlateText(cropCanvas)
                  .then((text) => {
                    if (text) plateTextRef.current.set(box.id, text);
                  })
                  .finally(() => platesReadingRef.current.delete(box.id));
              } else {
                platesReadingRef.current.delete(box.id);
              }
            }

            // The plate box and its reading only ever get drawn once OCR actually confirms
            // real text -- while an attempt is in progress, or if it never gets a confident
            // read, nothing is drawn at all. Previously the box appeared the instant the
            // locator merely found a plate-shaped region, whether or not anything was ever
            // actually read from it, which looked like a detection when it was really just a
            // location guess with nothing behind it.
            const plateText = plateTextRef.current.get(box.id);
            if (plateText) {
              ctx.strokeStyle = "#22D3EE";
              ctx.lineWidth = 2;
              ctx.strokeRect(plate.x, plate.y, plate.w, plate.h);

              ctx.font = "bold 13px monospace";
              const plateTextWidth = ctx.measureText(plateText).width;
              const labelW = plateTextWidth + 8;
              const labelH = 18;
              // Beside the plate box (to its right), vertically centered on it -- falls back
              // to the left side instead if there isn't room to the right, so the reading
              // never gets clipped off the edge of the canvas for a plate near the frame edge.
              const fitsRight = plate.x + plate.w + 4 + labelW <= canvas.width;
              const labelX = fitsRight ? plate.x + plate.w + 4 : Math.max(0, plate.x - 4 - labelW);
              const labelY = Math.max(0, Math.min(canvas.height - labelH, plate.y + plate.h / 2 - labelH / 2));
              ctx.fillStyle = "#22D3EE";
              ctx.fillRect(labelX, labelY, labelW, labelH);
              ctx.fillStyle = "#111827";
              ctx.fillText(plateText, labelX + 4, labelY + 13);
            }
          }
        }
        rafRef.current = requestAnimationFrame(detectLoop);
      });
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [facingMode, retryCount]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const switchCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  }, []);

  return (
    <div className="detection-overlay">
      <div className="detection-video-wrap">
        <video ref={videoRef} className="detection-video" playsInline muted />
        <canvas ref={canvasRef} className="detection-canvas" />
      </div>

      <div className="detection-banner">
        {status === "loading-model" && "Loading detection model…"}
        {status === "requesting-camera" && "Requesting camera access…"}
        {status === "running" && navContext && (
          <>
            <strong>
              {navContext.distanceToManeuverM !== null
                ? `In ${formatDistance(navContext.distanceToManeuverM)}, `
                : ""}
              {navContext.instructionText}
            </strong>
            {navContext.hideTrace && " — route guide line hidden"}
          </>
        )}
        {status === "running" && !navContext && !infoDismissed && (
          <>
            {`Detecting vehicles (${facingMode === "environment" ? "back" : "front"} camera) — every car/motorcycle is boxed "Vehicle" and every truck/bus "Heavy Vehicle" (amber box, shown with detection confidence %). This app doesn't guess at "police car" or similar — real-world testing showed that kind of fine-grained guess being confidently wrong too often to trust, so it isn't claimed at all. A separate light-flash detector flags any vehicle with an actively strobing red/blue light as "Unmarked police?" (violet box) regardless of vehicle type — it only catches lights that are actually on, not antennas or other hardware, and is real-time evidence rather than a guess. Speed (a rough estimate, not radar-accurate) and the plate estimate only show for a vehicle seen face-on (front or rear) — side-on, the box just shows type and confidence, since neither the speed model nor a plate is reliable from that angle. A small cyan box only appears once a real on-device text read of a plate actually succeeds (shown beside the box) — never just a location guess with nothing behind it. It keeps retrying a legible-looking plate for a little while rather than giving up after one bad frame, then stops once it succeeds or after enough genuine tries — never stored or sent anywhere. It's a genuine but general-purpose OCR engine, not one built for plates specifically, so treat any reading as a rough attempt, not a confirmed plate number. Each vehicle tracked steadily for under a second (and seen face-on) gets green corner brackets (🔒) showing it's locked on, independently of every other vehicle in frame, and the nearest one is marked 🎯 Closest.`}
            <button className="detection-banner-dismiss" onClick={dismissInfo}>
              Got it, don't show this again
            </button>
          </>
        )}
        {status === "error" && (errorMessage ?? "Something went wrong starting the camera.")}
      </div>

      {navContext && status === "running" ? (
        <div className="detection-bottom-panel">
          <div className="detection-nav-stats-row">
            <div>
              <div className="detection-nav-stat-value">{navContext.arrivalClockText}</div>
              <div className="detection-nav-stat-label">arrival</div>
            </div>
            <div>
              <div className="detection-nav-stat-value">{navContext.etaText}</div>
              <div className="detection-nav-stat-label">ETA</div>
            </div>
            <div>
              <div className="detection-nav-stat-value">{navContext.distanceRemainingText}</div>
              <div className="detection-nav-stat-label">remaining</div>
            </div>
          </div>
          <NavActionsRow
            hasStop={navContext.hasStop}
            onAddStop={navContext.onAddStop}
            onShareEta={navContext.onShareEta}
            onReportAlert={navContext.onReportAlert}
          />
          <div className="detection-bottom-panel-buttons">
            {canSwitchCamera && (
              <button onClick={switchCamera} aria-label="Switch camera">
                🔄 Switch
              </button>
            )}
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      ) : (
        <>
          {status === "error" && (
            <button className="detection-retry" onClick={retryLoad}>
              🔄 Retry
            </button>
          )}
          {canSwitchCamera && (
            <button className="detection-switch" onClick={switchCamera} aria-label="Switch camera">
              🔄 Switch camera
            </button>
          )}
          <button className="detection-close" onClick={onClose}>
            Close
          </button>
        </>
      )}
    </div>
  );
}
