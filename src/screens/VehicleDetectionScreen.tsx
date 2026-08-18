import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, LayoutChangeEvent, useWindowDimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
  type PhotoFile,
} from "react-native-vision-camera";
import { useResizePlugin } from "vision-camera-resize-plugin";
import { useSharedValue, useRunOnJS } from "react-native-worklets-core";
import type { BoxedHybridObject } from "react-native-nitro-modules";
import type { TensorflowModel } from "react-native-fast-tflite";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File } from "expo-file-system";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { decodePhotoForDetection } from "@/services/vehicleDetection";
import { loadBoxedTFLiteModel, TFLITE_INPUT_SIZE } from "@/services/tfliteVehicleModel";
import { sampleLightbarActivity, pruneLightbarTracks } from "@/utils/lightbarDetector";
import { createSpeedTracker, type TrackedBox } from "@/utils/speedTracker";
import { locatePlateRegion, type PlateRegion } from "@/utils/plateLocator";
import { readPlateText } from "@/services/plateOcr";
import { useLocation } from "@/context/LocationContext";
import { upsertDetectedVehicle } from "@/services/vehicleHistory";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { Sentry } from "@/services/sentry";

// PHASE 2 (see the diagnostic protocol this followed): primary vehicle detection now runs
// through a real Frame Processor calling a native TFLite model (react-native-fast-tflite)
// synchronously via runSync() on the camera's own worklet thread (react-native-worklets-core),
// not the JS thread -- confirmed via Phase 1's Sentry perf instrumentation that the previous
// tfjs-on-JS-thread capture/decode/infer cycle (still used below only for plate OCR/lightbar
// crops, at a much slower cadence) was the real, architectural cause of the recurring freeze,
// not any of the resolution/timing values that had been tuned around it before. Only detection
// results (box coordinates, label, score) cross back to JS -- never raw frames.
// Lowered from 0.35 -- real, confirmed complaint: a vehicle only partly in frame (cropped by
// the dash/window pillar, or genuinely half-blocked by another car) scores meaningfully lower
// than the same vehicle fully visible, and 0.35 was missing it outright on the very first
// detection (before TRACK_GRACE_MS in speedTracker.ts even gets a chance to help -- that grace
// period only covers a MISSED frame on an already-tracked vehicle, not a partial vehicle that
// never cleared the bar to start being tracked at all). Same real trade as before: a few more
// false positives for meaningfully fewer real, partially-visible vehicles going undetected.
const MIN_DETECTION_SCORE = 0.3;
// Real, confirmed complaint (new screenshot evidence): boxes barely clearing MIN_DETECTION_SCORE
// (a "Vehicle 30%" that's mostly roof/sky, a "Vehicle 33%" that's mostly trees) were being drawn
// on screen looking like a broken/misfit box, even though tracking them internally at that low a
// bar is still genuinely useful (keeps a partial vehicle's track alive through TRACK_GRACE_MS
// once it does clear a real detection -- see MIN_DETECTION_SCORE's own comment). Separating "good
// enough to track" from "good enough to actually draw" fixes the visible symptom without undoing
// that earlier fix: a track can exist and keep its speed estimate warm below this bar, it just
// doesn't render a box the user has to look at until the read is solid enough to trust the shape.
// Raised again (0.45 -> 0.55) -- real, confirmed evidence (screenshots dated 8/17, after the
// 0.45 fix was already live) showed this bar still let visibly loose/misfit boxes ("Vehicle 33%",
// "Heavy Vehicle 69%") through onto the screen. A track can still exist and keep its speed
// estimate warm well below this (MIN_DETECTION_SCORE), it just has to be more confident before
// its box is something the user has to look at.
const MIN_RENDER_SCORE = 0.55;
// Real, confirmed complaint: a low-confidence detection box spanning almost the entire frame
// (a misclassified shadow/road surface/dashboard reflection, not an actual close-up vehicle)
// rendered as a giant box "covering the whole screen" instead of locking to the real car body.
// A genuinely huge box IS possible at very close range (a phone mounted right next to traffic, or
// a near-collision) -- so this doesn't reject big boxes outright, it just requires a much higher
// score to accept one that large, same principle as MIN_DETECTION_SCORE but scaled to how much
// of the frame the box claims to cover. Tightened AGAIN (0.6/0.8 -> 0.5/0.88) after the previous
// tightening still let a "Heavy Vehicle 69%" box sprawled across two parked cars, a shed, and
// open sky through -- 69% cleared the old 0.8 bar's near-miss zone often enough in practice, and
// the old 0.6 frame-fraction trigger only caught boxes covering more than 60% of the frame, not
// the merely-loose-but-still-clearly-wrong medium-large boxes also being reported. Both the size
// trigger and the score bar it has to clear went up again; a real close-range vehicle still gets
// through since it'll score much higher than 88% once actually filling that much of the frame.
const OVERSIZED_BOX_FRAME_FRACTION = 0.5;
const MIN_SCORE_FOR_OVERSIZED_BOX = 0.88;
// Belt-and-suspenders on top of the score gate above -- caps how much of the screen the drawn
// box is ever allowed to visually cover, applied at render time (see its call site). Catches the
// same "box covering the whole screen" complaint even for a detection that did clear the score
// gate above, without needing to guess the exact right score cutoff. Lowered alongside the gate
// above (0.82 -> 0.7) for the same reason.
const MAX_BOX_RENDER_FRACTION = 0.7;
// This model's own fixed TFLite_Detection_PostProcess output size (see
// assets/models/tflite_ssd_mobilenet_v1) -- it never returns more than this many candidate
// detections per frame, regardless of how many are actually above MIN_DETECTION_SCORE.
const MAX_MODEL_DETECTIONS = 10;
// Frame Processor throttle -- unlike the old JS-thread cadence, this no longer has to leave
// headroom for touch handling (it's not competing with the JS thread at all), so it can run
// much more often; capped mainly for battery/thermal, not responsiveness.
const FRAME_PROCESSOR_THROTTLE_MS = 300;

// Attempts (each tied to one side-capture pass) before giving up on a persistently unreadable
// plate for a given track -- caps total OCR work per vehicle instead of retrying forever on one
// that's obscured, too far, or at a bad angle.
const MAX_PLATE_ATTEMPTS = 6;
// On-device ML Kit text recognition (rn-mlkit-ocr) doesn't expose a per-read numeric
// confidence score at all -- so instead of a fabricated confidence number, a plate only ever
// gets shown once the SAME text has actually been read at least twice within its last few
// attempts, a real, direct way to reject a one-off misread before it's ever displayed.
const PLATE_CANDIDATE_WINDOW = 3;
const PLATE_CONFIRM_COUNT = 2;
// The slower, JS-thread side loop that still exists purely for plate OCR crops and lightbar
// sampling (neither is something a Frame Processor worklet can call into -- rn-mlkit-ocr's
// recognizeText is a Promise-based native module call, and the lightbar sampler works off a
// full decoded JPEG, not a worklet-visible frame buffer). Only ever runs when there's actually
// a tracked vehicle to check (see captureForPlateAndLightbar's early-out below), and does no
// detection work of its own, so it's considerably lighter than the old full capture/decode/
// detect cycle even at a similar cadence.
const SIDE_CAPTURE_INTERVAL_MS = 900;
const SIDE_CAPTURE_INTERVAL_MS_NAVIGATING = 1400;
// Real, confirmed failure mode this guards against: takePictureAsync's promise never settling
// at all (neither resolving nor rejecting) -- a stalled native camera call would otherwise leave
// sideCapturingRef permanently true, silently freezing this side loop forever with zero
// user-visible feedback. Racing it against a plain timer means the app's own logic always gets
// control back, whether or not the native call ever does.
const SIDE_CAPTURE_TIMEOUT_MS = 6000;
// Same protection for the JPEG decode step -- pure JS, no native camera hardware involved, so
// a much shorter bound than the capture itself is enough.
const SIDE_DECODE_TIMEOUT_MS = 5000;
// Consecutive side-loop failures (timeouts or thrown errors) before giving up and surfacing the
// existing "Reconnecting…" indicator instead of quietly retrying forever -- one bad frame
// shouldn't error out immediately (real, temporary hiccups happen), but a real, ongoing problem
// should always end up somewhere the user can see, never a silently stuck screen. Detection
// itself (the Frame Processor) has no equivalent failure mode surfaced here -- a stalled model
// call just means no new boxes for a while, not a thrown error to catch.
const MAX_CONSECUTIVE_CAPTURE_FAILURES = 4;
// Remembers that the driver already closed the "how detection works" explainer -- previously
// this banner had no dismiss control at all on mobile (unlike the web app's equivalent, which
// does), so it stayed pinned across the whole detection view every single time it was opened.
const INFO_DISMISSED_KEY = "@trackline/aiDetectionInfoDismissed";

interface RawDetection {
  label: "Vehicle" | "Heavy Vehicle";
  score: number;
  bbox: [number, number, number, number];
}

function boxIoU(a: [number, number, number, number], b: [number, number, number, number]): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const interLeft = Math.max(ax, bx);
  const interTop = Math.max(ay, by);
  const interRight = Math.min(ax + aw, bx + bw);
  const interBottom = Math.min(ay + ah, by + bh);
  const interW = Math.max(0, interRight - interLeft);
  const interH = Math.max(0, interBottom - interTop);
  const interArea = interW * interH;
  if (interArea <= 0) return 0;
  const unionArea = aw * ah + bw * bh - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

// Real, confirmed cause of "multiple overlapping boxes/labels stacked on the one real vehicle":
// this model's TFLite_Detection_PostProcess op already runs NMS internally, but (like every
// standard multi-class detector's built-in NMS) only WITHIN each raw class -- car(3) and
// motorcycle(4) are separate classes to the model, each with their own independent NMS pass, so
// a spurious motorcycle-class detection overlapping a real car-class detection of the same
// vehicle survives the model's own suppression untouched. Both get remapped to the same "Vehicle"
// label above, but nothing suppressed the duplicate BETWEEN them -- confirmed exactly reproduced
// (several "Vehicle 3x%"/"Heavy Vehicle 4x%" boxes all on the one real van, overlapping labels
// unreadable). This is a second, cross-class NMS pass over the already-remapped Vehicle/Heavy
// Vehicle list: greedy, highest score first, discarding any lower-score box that overlaps an
// already-kept one past IOU_SUPPRESS_THRESHOLD, regardless of which raw class either came from.
const IOU_SUPPRESS_THRESHOLD = 0.35;

function suppressOverlappingDetections(detections: RawDetection[]): RawDetection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: RawDetection[] = [];
  for (const det of sorted) {
    if (kept.some((k) => boxIoU(k.bbox, det.bbox) > IOU_SUPPRESS_THRESHOLD)) continue;
    kept.push(det);
  }
  return kept;
}

// Plain thin rectangle outline, per explicit request matching a real reference screenshot of
// the exact look wanted -- a clean, tight box hugging the vehicle's own visible silhouette, not
// the four-corner-bracket "camera focus reticle" style this used to be (that was itself an
// earlier explicit request, since superseded by this one). Kept as its own named component
// (not inlined at each call site) since it's still shared by both the vehicle box and the plate
// frame below, just simplified to a single bordered rect instead of four separate corner pieces.
function TargetCorners({ width, height, color }: { width: number; height: number; color: string }) {
  return (
    <View
      pointerEvents="none"
      style={[styles.targetRect, { width, height, borderColor: color }]}
    />
  );
}

// Color-codes the lock/target box by the vehicle's own real road speed, per explicit request:
// under 50 km/h amber/orange (an uncertain/low reading -- also the neutral default below for any
// speed that isn't a confirmed "absolute" reading at all), 50-70 green (normal, confident cruise
// speed), over 70 red. Matches real fixed-camera traffic-radar convention (a driver glances at a
// color, not a number, to gauge how fast someone's going). Only applied to a real "absolute"
// road-speed reading (a genuine ego-GPS-combined estimate, or a stationary/mounted camera's own
// closing rate treated as the target's real speed -- see speedTracker.ts's combineWithEgoSpeed);
// a plain "closing" rate (no GPS fix at all yet, so whether the camera itself is moving is
// genuinely unknown) isn't a confirmed speed measurement and stays the neutral default amber
// rather than implying a threshold it can't actually back up.
function speedLockColor(box: TrackedBox): string {
  if (box.state === "parked" || box.speedKmh === null || box.speedKind !== "absolute") return "#F59E0B";
  const abs = Math.abs(box.speedKmh);
  if (abs > 70) return "#DC2626";
  if (abs >= 50) return "#22C55E";
  return "#F59E0B";
}

// Maps a box from the Frame Processor's UPRIGHT coordinate space (frameWidth x frameHeight,
// the same space `boxes` state and the on-screen overlay use) into a still photo's own RAW,
// pre-rotation pixel space (rawWidth x rawHeight, matching decodePhotoForDetection's decode and
// what expo-image-manipulator's crop actually operates against -- see captureForPlateAndLightbar's
// own comment for why). This is the exact inverse of the rotation the Frame Processor's own
// resize() call applies to go from raw to upright -- see that worklet's own comment for the
// forward direction and the orientation-to-degrees mapping this mirrors.
function mapUprightBoxToRawPhoto(
  bbox: [number, number, number, number],
  uprightWidth: number,
  uprightHeight: number,
  rawWidth: number,
  rawHeight: number,
  orientation: string
): [number, number, number, number] {
  if (uprightWidth <= 0 || uprightHeight <= 0) return bbox;
  const [bx, by, bw, bh] = bbox;
  const u0 = bx / uprightWidth;
  const v0 = by / uprightHeight;
  const u1 = (bx + bw) / uprightWidth;
  const v1 = (by + bh) / uprightHeight;

  const toRaw = (u: number, v: number): [number, number] => {
    switch (orientation) {
      case "landscape-right":
        return [v, 1 - u];
      case "landscape-left":
        return [1 - v, u];
      case "portrait-upside-down":
        return [1 - u, 1 - v];
      default:
        return [u, v];
    }
  };

  const [ru0, rv0] = toRaw(u0, v0);
  const [ru1, rv1] = toRaw(u1, v1);

  const rx0 = Math.min(ru0, ru1) * rawWidth;
  const rx1 = Math.max(ru0, ru1) * rawWidth;
  const ry0 = Math.min(rv0, rv1) * rawHeight;
  const ry1 = Math.max(rv0, rv1) * rawHeight;

  return [rx0, ry0, rx1 - rx0, ry1 - ry0];
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
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

// vision-camera's PhotoFile.path is a bare filesystem path ("/var/mobile/..."), not a URI --
// unlike expo-camera's photo.uri, which always came back with the file:// scheme already on
// it. Both expo-file-system's File and expo-image-manipulator expect a real URI, so this adds
// the scheme back on rather than assuming every caller downstream already handles a bare path.
function toFileUri(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}

interface Props {
  onClose: () => void;
  // True whenever a route is active in the background -- used to ease off the side capture
  // cadence (see SIDE_CAPTURE_INTERVAL_MS_NAVIGATING). This screen used to also draw a route
  // overlay while navigating, removed per explicit request: it covered too much of the frame to
  // actually point a camera at nearby vehicles through, which is the entire point of this screen.
  isNavigating?: boolean;
}

export function VehicleDetectionScreen({ onClose, isNavigating = false }: Props) {
  // Diagnostic timing only (see the Sentry "perf:" breadcrumbs throughout this file) -- not
  // used for any real logic. Marks when this component first rendered, so onInitialized below
  // can report how long the native camera session genuinely took to come up.
  const mountTimeRef = useRef(Date.now());
  const insets = useSafeAreaInsets();
  // Landscape add-on only -- pure layout signal for the HUD reflow below (banner/detail panel
  // side-anchored instead of spanning full-width, safe-area padding on both sides). Updates
  // live as the device physically rotates, same as any other window-size-driven layout in RN.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscapeLayout = windowWidth > windowHeight;
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  // photoResolution raised again, to real 4K (3840x2160) -- per explicit request for a
  // meaningfully clearer source image for the plate/lightbar side capture loop
  // (captureForPlateAndLightbar below). That loop's plate crop reads straight off this still
  // photo via native, hardware-accelerated cropping (expo-image-manipulator, see plateOcr.ts) --
  // not through the JS-thread JPEG decode -- so the full 4K detail genuinely reaches OCR on
  // whatever small plate-sized region gets cropped out of it, real, meaningfully more pixels to
  // read a plate from at real driving distance than 1280x720 gave.
  //
  // videoResolution deliberately NOT raised to match -- unlike the still-photo path above, the
  // Frame Processor's video stream feeds the live TFLite model, which the resize plugin always
  // downsamples to a FIXED 300x300 input (see TFLITE_INPUT_SIZE) no matter what the source
  // resolution is. A 4K video buffer would mean the resize plugin (and the continuous native
  // capture pipeline behind it) doing meaningfully more GPU/battery/thermal work on every single
  // frame at the Frame Processor's own ~3fps cadence, for a fixed-size model input that can't
  // use any of those extra pixels -- real, ongoing cost for zero detection-accuracy benefit.
  // 1280x720 already gives the model everything it can actually use.
  //
  // Real, honest tradeoff on the photo side: a 4K still photo is a meaningfully bigger file for
  // decodePhotoForDetection's pure-JS jpeg-js decode (used for lightbar flash sampling, not the
  // plate crop) to churn through every ~0.9-1.4s cadence tick -- SIDE_DECODE_TIMEOUT_MS already
  // bounds a slow decode to a graceful retry rather than a hang, but this genuinely needs a real
  // device test pass (not just a simulator) to confirm it doesn't introduce visible stutter on
  // older/lower-end hardware before treating it as final.
  const format = useCameraFormat(device, [
    { photoResolution: { width: 3840, height: 2160 } },
    { videoResolution: { width: 1280, height: 720 } },
  ]);
  // Real camera zoom -- vision-camera's `zoom` prop drives the actual native capture session
  // (AVCaptureDevice/CameraX), not just the on-screen preview, so both takePhoto() and the Frame
  // Processor's own video stream genuinely see the zoomed-in frame. Simplified to a single
  // normal/5x toggle (previously a +/- fine control) per explicit request -- two clear, known-
  // good states instead of a range that could land somewhere between them with no real benefit.
  // 5x is capped to the device's own maxZoom for devices that can't reach it (rare, but a real
  // possible value on some older/budget hardware) -- never higher, since digital zoom well past
  // what the sensor can really resolve just produces a blurrier, less detectable frame, the
  // opposite of the point. Starts at the device's own neutralZoom (1x on a single-camera device;
  // the wide-angle "normal" zoom on a multi-camera one -- never the ultra-wide fish-eye lens,
  // which would distort vehicles and hurt detection, not help it).
  const ZOOM_5X = 5;
  const [is5xZoom, setIs5xZoom] = useState(false);
  const [normalZoomFactor, setNormalZoomFactor] = useState(1);
  useEffect(() => {
    if (device) setNormalZoomFactor(device.neutralZoom);
  }, [device]);
  const zoomFactor = is5xZoom ? Math.min(ZOOM_5X, device?.maxZoom ?? ZOOM_5X) : normalZoomFactor;
  // Same ref pattern as egoSpeedRef below -- onDetections runs from the Frame Processor bridge,
  // not a normal re-render, so it needs a ref (always current by the time the next frame lands)
  // rather than closing over the zoomFactor value from whenever it was first created. Feeds
  // speedTracker.ts's update() so parked-vehicle detection and distance/speed estimates both
  // account for the real, current zoom -- see that file's own comments for why zoom-unaware math
  // there was misreading handheld shake at 5x zoom as a moving vehicle.
  const zoomFactorRef = useRef(1);
  zoomFactorRef.current = zoomFactor;
  const toggleZoom = useCallback(() => {
    setIs5xZoom((v) => !v);
  }, []);
  // Real ego GPS speed for turning a tracked vehicle's closing/receding rate into its own
  // actual road speed -- see speedTracker.ts's combineWithEgoSpeed. Reuses the SAME
  // app-wide location watcher LocationProvider already runs (App.tsx) rather than starting a
  // second GPS subscription just for this screen, so there's nothing extra to tear down here.
  const { location } = useLocation();
  const egoSpeedRef = useRef<number | null>(null);
  egoSpeedRef.current = location?.coords.speed ?? null;
  // No "error" state -- see the model-load effect and the two capture paths' catch blocks
  // below. Every failure mode here now auto-recovers on its own instead of ever stopping and
  // waiting on a manual tap.
  const [status, setStatus] = useState<"loading-model" | "running">("loading-model");
  // >0 once the model has failed to load at least once -- only changes the loading text to be
  // honest that it's taking a retry or two, never blocks anything or asks for a tap.
  const [modelLoadAttempt, setModelLoadAttempt] = useState(0);
  // True only while the plate/lightbar side loop has been failing for a few ticks in a row -- a
  // small, non-blocking "Reconnecting…" indicator, not a dead end. Clears itself the instant a
  // side capture actually succeeds again.
  const [recovering, setRecovering] = useState(false);
  const [boxes, setBoxes] = useState<TrackedBox[]>([]);
  // The coordinate space `boxes` (and thus the plate/emergency overlays) are expressed in --
  // the Frame Processor's own video frame dimensions, set from onDetections below. Named
  // `photoSize` (not `frameSize`) to keep the render-side scale/offset math below unchanged
  // from before this rewrite -- it's still just "the pixel space the boxes are in."
  const [photoSize, setPhotoSize] = useState<{ width: number; height: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  // Landscape add-on only -- see the box-render loop's own comment below for why this exists.
  // frame.orientation/width/height (the RAW, pre-upright-rotation sensor dimensions -- see the
  // Frame Processor's own comment on frame.width/height) are only ever READ here, never fed
  // into detection/tracking itself, so nothing about how a vehicle actually gets detected,
  // tracked, or speed-estimated changes -- this is purely about where the already-correct boxes
  // get DRAWN once the device is physically rotated.
  const [rawFrameInfo, setRawFrameInfo] = useState<{
    width: number;
    height: number;
    orientation: string;
  } | null>(null);
  // Plate text (plus the real estimated region it was actually cropped from -- see
  // plateLocator.ts -- so the on-screen frame can be sized/positioned to the real plate instead
  // of a generic floating label) is display-only -- keyed by track id, never written anywhere
  // but this component's own state, cleared the moment a vehicle's track is pruned (see below).
  // Nothing here is persisted or sent off-device.
  const [plateTexts, setPlateTexts] = useState<Map<number, { text: string; region: PlateRegion }>>(
    new Map()
  );
  // Track ids with a confirmed, actually-strobing lightbar signature (see
  // lightbarDetector.ts) -- real detected evidence, not a model's guess at vehicle type.
  const [emergencyTrackIds, setEmergencyTrackIds] = useState<Set<number>>(new Set());
  // Tapping a box locks visual focus onto that one vehicle (a highlighted outline + checkmark)
  // when several are in frame -- purely a this-screen, this-session UI focus aid, the same way
  // tapping a subject focuses a camera. The selection itself is never written to storage or sent
  // anywhere and clears the moment the vehicle's track is dropped or the screen closes. That's
  // now separate from the plate text itself, though: once a plate is actually confirmed (see
  // captureForPlateAndLightbar below), it IS automatically written to the on-device vehicle
  // history log (vehicleHistory.ts) -- never sent off-device, but no longer session-only, per
  // explicit request to remember fully-detected vehicles across sessions.
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null);
  const onSelectBox = useCallback((id: number) => {
    setSelectedTrackId((prev) => (prev === id ? null : id));
  }, []);
  // Track ids whose plate has actually been confirmed AND written to the persistent vehicle
  // history log this session (see captureForPlateAndLightbar's plate-confirm callback below) --
  // purely a "saved" badge on-screen, the real persistence already happened the instant this
  // gets set. Pruned alongside plateTexts/plateTextsRef in onDetections below.
  const [savedTrackIds, setSavedTrackIds] = useState<Set<number>>(new Set());
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const cameraRef = useRef<Camera>(null);
  const sideIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sideCapturingRef = useRef(false);
  // Set the instant this screen unmounts (a real unmount -- see MapScreen.tsx's Modal fix --
  // not just hidden behind a still-visible-but-invisible modal). Checked after every await in
  // the side capture loop below so an in-flight capture/decode/OCR chain can't keep running (or
  // touch a torn-down native camera session) after the screen is gone.
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);
  // Portrait everywhere else in the app stays locked (see App.tsx's own lockAsync) -- this
  // screen alone unlocks rotation for as long as it's open, per explicit request to add
  // landscape as an ADD-ON here without touching how any other screen (or this screen's own
  // portrait behavior) already works. Re-locks back to portrait on close so the rest of the app
  // never sees anything but portrait, exactly as before this screen ever existed.
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);
  const speedTrackerRef = useRef(createSpeedTracker());
  // Mirrors `boxes` state so the side capture loop (a stable, empty-deps useCallback) can read
  // the latest tracked vehicles without depending on the state itself -- same reasoning as
  // plateTextsRef below.
  const boxesRef = useRef<TrackedBox[]>([]);
  // Mirrors `photoSize` state for the same reason -- the side loop needs the Frame Processor's
  // own frame dimensions to rescale tracked bboxes into whatever its own takePhoto() capture
  // actually returns (see captureForPlateAndLightbar).
  const frameSizeRef = useRef<{ width: number; height: number } | null>(null);
  const plateAttemptsRef = useRef(new Map<number, number>());
  const platesReadingRef = useRef(new Set<number>());
  // Last few raw OCR reads per track id, oldest first (capped to PLATE_CANDIDATE_WINDOW) --
  // see PLATE_CANDIDATE_WINDOW/PLATE_CONFIRM_COUNT's own comment for why this exists.
  const plateCandidatesRef = useRef(new Map<number, string[]>());
  // Mirrors `plateTexts` state so the side loop can check/update it without depending on the
  // state itself -- keeps it referentially stable (empty deps), so the capture interval effect
  // below doesn't tear down and rebuild every time a plate read resolves.
  const plateTextsRef = useRef(new Map<number, { text: string; region: PlateRegion }>());
  const consecutiveFailuresRef = useRef(0);

  const [infoDismissed, setInfoDismissed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const tStart = Date.now();
    AsyncStorage.getItem(INFO_DISMISSED_KEY).then((value) => {
      Sentry.logger.info("perf: vehicleDetectionScreen.infoDismissedRead", { ms: Date.now() - tStart });
      if (!cancelled && value === "1") setInfoDismissed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const dismissInfo = useCallback(() => {
    setInfoDismissed(true);
    AsyncStorage.setItem(INFO_DISMISSED_KEY, "1").catch(() => {});
  }, []);

  // Holds the boxed TFLite model (see tfliteVehicleModel.ts) once loaded, readable from inside
  // the Frame Processor worklet below. A `useSharedValue` from react-native-worklets-core
  // specifically -- not a plain useRef -- because a worklet's closure only safely captures
  // primitives (by copy) or SharedValues/HostObjects/HostFunctions (by reference); a plain ref
  // object doesn't fall into either category and isn't guaranteed to reflect updates correctly
  // from inside the separate worklet Runtime.
  const boxedModelShared = useSharedValue<BoxedHybridObject<TensorflowModel> | null>(null);
  // Real, confirmed lag contributor: this SharedValue kept holding its reference to the boxed
  // TFLite model (and the GPU/NPU delegate context that comes with it) after the screen closed --
  // nothing ever cleared it back to null on unmount. tfliteVehicleModel.ts's own module-level
  // cache is deliberately kept alive across opens for a fast reopen (see its own comment) and is
  // NOT touched here -- this only drops this one screen instance's own worklet-visible handle
  // into that cache, so the underlying delegate/thread work it was keeping warm doesn't have to
  // keep running once there's no camera left to feed it frames.
  useEffect(() => {
    return () => {
      boxedModelShared.value = null;
    };
  }, [boxedModelShared]);

  // Auto-retries forever with a capped backoff instead of ever dead-ending on a manual "tap
  // Retry" button -- a transient hiccup (a slow first disk read, a momentary GC pause) resolves
  // itself within a couple of attempts with zero user action needed; a persistent one just
  // keeps trying quietly in the background for as long as the screen stays open, which is the
  // most this screen can honestly do without ever leaving the driver stuck looking at a dead
  // end. modelLoadAttempt only changes the loading text (see the banner below), never gates
  // anything.
  const MODEL_LOAD_RETRY_DELAYS_MS = [1500, 3000, 6000, 10000];
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attemptLoad = () => {
      loadBoxedTFLiteModel()
        .then((boxed) => {
          if (cancelled) return;
          boxedModelShared.value = boxed;
          setStatus("running");
        })
        .catch((err) => {
          if (cancelled) return;
          Sentry.logger.error("vehicle-detection: tflite model load failed, auto-retrying", {
            attempt,
            error: err instanceof Error ? err.message : String(err),
          });
          attempt += 1;
          setModelLoadAttempt(attempt);
          const delay =
            MODEL_LOAD_RETRY_DELAYS_MS[Math.min(attempt - 1, MODEL_LOAD_RETRY_DELAYS_MS.length - 1)];
          timer = setTimeout(attemptLoad, delay);
        });
    };
    attemptLoad();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs on the JS thread once the Frame Processor worklet below bridges a frame's detections
  // back -- the same tracker/state-update logic the old captureAndDetect used to do inline,
  // just fed by the Frame Processor instead of a JS-thread tfjs call. Deliberately does NOT do
  // plate OCR or lightbar sampling here -- see captureForPlateAndLightbar's own comment for why
  // those stay on the separate, slower side loop.
  const onDetections = useRunOnJS(
    (
      detections: RawDetection[],
      frameWidth: number,
      frameHeight: number,
      rawWidth: number,
      rawHeight: number,
      orientation: string
    ) => {
      if (unmountedRef.current) return;
      setPhotoSize({ width: frameWidth, height: frameHeight });
      frameSizeRef.current = { width: frameWidth, height: frameHeight };
      setRawFrameInfo({ width: rawWidth, height: rawHeight, orientation });
      const suppressed = suppressOverlappingDetections(detections);
      const tracked = speedTrackerRef.current.update(
        suppressed,
        frameWidth,
        Date.now(),
        egoSpeedRef.current,
        zoomFactorRef.current
      );
      boxesRef.current = tracked;
      setBoxes(tracked);

      const liveIds = speedTrackerRef.current.liveTrackIds();
      setSelectedTrackId((prev) => (prev !== null && !liveIds.has(prev) ? null : prev));

      // Prune cached plate state for any track id the tracker has fully dropped (not just ones
      // missing from this frame's `tracked` -- a track survives a short grace period on a
      // single missed detection, and pruning off `tracked` alone would wipe a legitimately
      // in-progress read on that miss).
      for (const id of plateAttemptsRef.current.keys()) {
        if (!liveIds.has(id)) plateAttemptsRef.current.delete(id);
      }
      for (const id of plateCandidatesRef.current.keys()) {
        if (!liveIds.has(id)) plateCandidatesRef.current.delete(id);
      }
      let pruned = false;
      for (const id of plateTextsRef.current.keys()) {
        if (!liveIds.has(id)) {
          plateTextsRef.current.delete(id);
          pruned = true;
        }
      }
      if (pruned) setPlateTexts(new Map(plateTextsRef.current));
      setSavedTrackIds((prev) => {
        let changed = false;
        const next = new Set<number>();
        for (const id of prev) {
          if (liveIds.has(id)) next.add(id);
          else changed = true;
        }
        return changed ? next : prev;
      });
    },
    []
  );

  const { resize } = useResizePlugin();
  const lastFrameProcessedMs = useSharedValue(0);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      const boxed = boxedModelShared.value;
      if (!boxed) return;
      const now = Date.now();
      if (now - lastFrameProcessedMs.value < FRAME_PROCESSOR_THROTTLE_MS) return;
      lastFrameProcessedMs.value = now;

      // frame.width/frame.height are the RAW camera sensor buffer's dimensions (confirmed from
      // react-native-vision-camera's own native source -- CVPixelBufferGetWidth/Height on the
      // untouched buffer), which for the back camera are landscape (e.g. 1280x720) even while
      // the phone is held upright in portrait -- takePhoto()'s own PhotoFile.width/height don't
      // have this quirk (photos get reported already upright), which is exactly why this bug
      // never showed up in the old capture-loop path, only here. frame.orientation says how
      // many degrees the raw buffer needs to be rotated to appear upright (see its own real
      // type doc). Left unhandled, the model was being fed a sideways frame and its normalized
      // box coordinates were being multiplied straight against the sideways frame.width/height
      // -- the real, confirmed cause of the oversized/mispositioned boxes, the multiple ghost
      // "steady" tracks (a box that's wrong-shaped and jumps around frame to frame can't stay
      // matched to the same track), the bogus non-zero speed on a parked car (that same jumping
      // read as fake motion), and the missing plate detection (locatePlateRegion estimating a
      // crop off the wrong box). Rotating here to upright before the model ever sees pixels
      // fixes the root cause once, instead of patching each downstream symptom separately.
      let rotation: "0deg" | "90deg" | "180deg" | "270deg" = "0deg";
      let uprightWidth = frame.width;
      let uprightHeight = frame.height;
      if (frame.orientation === "portrait-upside-down") {
        rotation = "180deg";
      } else if (frame.orientation === "landscape-right") {
        rotation = "90deg";
        uprightWidth = frame.height;
        uprightHeight = frame.width;
      } else if (frame.orientation === "landscape-left") {
        rotation = "270deg";
        uprightWidth = frame.height;
        uprightHeight = frame.width;
      }

      // Resized/rotated/converted to exactly what this model expects (300x300 RGB uint8,
      // upright) entirely on the camera's own worklet thread -- see vision-camera-resize-
      // plugin's own docs for why this (GPU-accelerated resize + YUV->RGB conversion) is
      // dramatically cheaper here than doing the equivalent in JS ever was.
      const resized = resize(frame, {
        scale: { width: TFLITE_INPUT_SIZE, height: TFLITE_INPUT_SIZE },
        pixelFormat: "rgb",
        dataType: "uint8",
        rotation,
      });

      // unbox() re-materializes the real TfliteModel HybridObject inside this worklet's own
      // Runtime -- see tfliteVehicleModel.ts's own comment on why box()/unbox() is needed here
      // at all. runSync() is the actual native forward pass, blocking this worklet (never the
      // JS thread) for however long real on-device inference takes.
      const model = boxed.unbox();
      const outputs = model.runSync([resized.buffer as ArrayBuffer]);

      // This model's standard TFLite_Detection_PostProcess output: 4 tensors, all float32
      // regardless of the quantized input -- [0] normalized [ymin,xmin,ymax,xmax] boxes,
      // [1] class ids, [2] scores, [3] a single-element detection count. See
      // assets/models/tflite_ssd_mobilenet_v1/labelmap.txt for the full class list; this model
      // was converted with the background class already excluded from its outputs, so labelmap
      // line N (1-indexed) corresponds to output class id N-1. Since the frame fed to the model
      // was already rotated upright above, these normalized coordinates are already in that
      // same upright space -- scale against uprightWidth/uprightHeight, not the raw sideways
      // frame.width/frame.height.
      const boxesArr = new Float32Array(outputs[0]);
      const classesArr = new Float32Array(outputs[1]);
      const scoresArr = new Float32Array(outputs[2]);
      const countArr = new Float32Array(outputs[3]);
      const count = Math.min(Math.round(countArr[0] ?? 0), MAX_MODEL_DETECTIONS);

      const detections: RawDetection[] = [];
      for (let i = 0; i < count; i++) {
        const score = scoresArr[i];
        if (score < MIN_DETECTION_SCORE) continue;
        const classId = Math.round(classesArr[i]);
        // car=3, motorcycle=4, bus=6, truck=8 -- see labelmap.txt.
        let label: "Vehicle" | "Heavy Vehicle" | null = null;
        if (classId === 3 || classId === 4) label = "Vehicle";
        else if (classId === 6 || classId === 8) label = "Heavy Vehicle";
        if (!label) continue;

        const ymin = boxesArr[i * 4 + 0];
        const xmin = boxesArr[i * 4 + 1];
        const ymax = boxesArr[i * 4 + 2];
        const xmax = boxesArr[i * 4 + 3];
        const w = (xmax - xmin) * uprightWidth;
        const h = (ymax - ymin) * uprightHeight;
        if (w <= 0 || h <= 0) continue;
        // See OVERSIZED_BOX_FRAME_FRACTION's own comment -- a near-full-frame box needs a much
        // higher score than an ordinary one to be trusted as a real close-up vehicle rather than
        // a low-confidence misdetection sprawled across most of the screen.
        const isOversized = xmax - xmin > OVERSIZED_BOX_FRAME_FRACTION || ymax - ymin > OVERSIZED_BOX_FRAME_FRACTION;
        if (isOversized && score < MIN_SCORE_FOR_OVERSIZED_BOX) continue;
        detections.push({ label, score, bbox: [xmin * uprightWidth, ymin * uprightHeight, w, h] });
      }

      // Only the parsed, tiny result array (plus the upright frame dimensions the boxes are
      // relative to) crosses back to JS here -- never the raw frame or the raw output tensors,
      // per the explicit Phase 2 spec this rewrite followed. frame.width/height/orientation
      // (the RAW, pre-rotation sensor info -- see this worklet's own comment above) also cross
      // over now, landscape add-on only -- see rawFrameInfo's own comment for why the render
      // side needs them.
      onDetections(detections, uprightWidth, uprightHeight, frame.width, frame.height, frame.orientation);
    },
    [resize, onDetections]
  );

  // Real, evidence-based emergency-lightbar check (actively strobing red/blue light) and
  // on-device plate OCR -- both still run here, on the JS thread, at a slower cadence than
  // detection itself now uses. Neither is something a Frame Processor worklet can call into:
  // rn-mlkit-ocr's recognizeText is a Promise-based native module call (not worklet-callable),
  // and the lightbar sampler (lightbarDetector.ts) works off a fully decoded JPEG buffer, not a
  // worklet-visible frame. Only ever fires when there's an actual tracked vehicle to check
  // (boxesRef.current, fed by the Frame Processor's own onDetections above) -- with nothing in
  // frame there's nothing to crop or sample, so this skips the shutter entirely rather than
  // burning capture/decode work on an empty scene every tick.
  const captureForPlateAndLightbar = useCallback(async () => {
    if (sideCapturingRef.current || unmountedRef.current || !cameraRef.current) return;
    if (boxesRef.current.length === 0) return;
    sideCapturingRef.current = true;
    const tCycleStart = Date.now();
    try {
      const photoFile: PhotoFile = await withTimeout(
        cameraRef.current.takePhoto({ enableShutterSound: false }),
        SIDE_CAPTURE_TIMEOUT_MS,
        "takePhoto"
      );
      if (!photoFile || unmountedRef.current) return;
      const photo = { uri: toFileUri(photoFile.path), width: photoFile.width, height: photoFile.height };
      const decoded = await withTimeout(
        decodePhotoForDetection(photo.uri),
        SIDE_DECODE_TIMEOUT_MS,
        "decodePhotoForDetection"
      );
      if (unmountedRef.current) return;
      consecutiveFailuresRef.current = 0;
      setRecovering(false);

      // The vehicle box (box.bbox) is in the Frame Processor's own UPRIGHT coordinate space
      // (frameSizeRef, corrected -- see the Frame Processor's own comment on frame.orientation).
      // This side capture's photo is a SEPARATE image with its own EXIF-style orientation
      // (photoFile.orientation) -- confirmed from react-native-vision-camera's own PhotoFile
      // doc ("Camera sensors are landscape, so e.g. portrait photos will have a value of
      // landscape-left") and from expo-image-manipulator's own crop implementation (its bounds
      // check compares against the EXIF-corrected UIImage.size, but the actual crop runs
      // against the raw, PRE-rotation CGImage buffer -- so the rect it needs is really in that
      // raw space, not the upright one the size check implies). decodePhotoForDetection's JPEG
      // decode (used for lightbar sampling below) reads that same raw, pre-rotation buffer too.
      // mapUprightBoxToRawPhoto (below) does the same rotation the Frame Processor's own
      // resize() call does, just inverted -- upright box -> raw photo pixel space -- so both
      // the lightbar sampler and the plate crop end up reading the actual pixels they're meant
      // to, not an axis-swapped or rotated region.
      const frameSize = frameSizeRef.current;
      const photoOrientation = photoFile.orientation;

      const nowMs = Date.now();
      const liveIds = speedTrackerRef.current.liveTrackIds();
      const nextEmergencyIds = new Set<number>();
      const plateReadPromises: Promise<void>[] = [];

      for (const box of boxesRef.current) {
        const rawBbox = frameSize
          ? mapUprightBoxToRawPhoto(
              box.bbox,
              frameSize.width,
              frameSize.height,
              decoded.width,
              decoded.height,
              photoOrientation
            )
          : box.bbox;

        if (sampleLightbarActivity(decoded, box.id, rawBbox, nowMs)) {
          nextEmergencyIds.add(box.id);
        }

        if (plateTextsRef.current.has(box.id) || platesReadingRef.current.has(box.id)) continue;
        const attempts = plateAttemptsRef.current.get(box.id) ?? 0;
        if (attempts >= MAX_PLATE_ATTEMPTS) continue;
        // Computed against the vehicle's own UPRIGHT box -- locatePlateRegion's "lower-middle
        // band" reasoning only makes sense relative to how the vehicle actually looks the right
        // way up (real plate position), not the photo's raw, possibly-sideways pixel grid.
        const region = locatePlateRegion(box.bbox);
        if (!region) continue;
        // Only the actual crop passed to OCR needs to be in the photo's own raw pixel space --
        // `region` itself (upright, matching the on-screen box coordinates) is what gets stored
        // and rendered as the plate frame overlay below.
        const rawRegionBbox = frameSize
          ? mapUprightBoxToRawPhoto(
              [region.x, region.y, region.w, region.h],
              frameSize.width,
              frameSize.height,
              decoded.width,
              decoded.height,
              photoOrientation
            )
          : [region.x, region.y, region.w, region.h];
        const rawRegion: PlateRegion = {
          x: rawRegionBbox[0],
          y: rawRegionBbox[1],
          w: rawRegionBbox[2],
          h: rawRegionBbox[3],
        };

        plateAttemptsRef.current.set(box.id, attempts + 1);
        platesReadingRef.current.add(box.id);
        const trackId = box.id;
        plateReadPromises.push(
          readPlateText(photo.uri, rawRegion)
            .then((text) => {
              if (!text || unmountedRef.current) return;
              // Confirm before ever showing anything -- see PLATE_CANDIDATE_WINDOW's own
              // comment. A single successful read (even one that matched the plate-shaped
              // regex) isn't shown until the same text has come up at least
              // PLATE_CONFIRM_COUNT times within its last PLATE_CANDIDATE_WINDOW attempts, so
              // one misread on an otherwise-correctly-read plate can't flicker a wrong string
              // onto the screen even briefly.
              const history = plateCandidatesRef.current.get(trackId) ?? [];
              history.push(text);
              if (history.length > PLATE_CANDIDATE_WINDOW) history.shift();
              plateCandidatesRef.current.set(trackId, history);

              const counts = new Map<string, number>();
              for (const candidate of history) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
              let confirmedText: string | null = null;
              for (const [candidate, c] of counts) {
                if (c >= PLATE_CONFIRM_COUNT) confirmedText = candidate;
              }
              if (!confirmedText) return;

              plateTextsRef.current.set(trackId, { text: confirmedText, region });
              setPlateTexts(new Map(plateTextsRef.current));

              // The exact moment a plate goes from "read" to "confirmed" (see
              // PLATE_CONFIRM_COUNT above) -- real, on-device evidence, not a guess -- so this
              // is also the moment this vehicle gets automatically written to the persistent
              // history log, per explicit request. Reads the track's live label/speed off
              // boxesRef (not stale closure state) so a confirm that lands a tick after the
              // vehicle's own speed last updated still saves the freshest number available.
              const trackedBox = boxesRef.current.find((b) => b.id === trackId);
              if (trackedBox) {
                upsertDetectedVehicle(confirmedText, {
                  label: trackedBox.label as "Vehicle" | "Heavy Vehicle",
                  speedKmh: trackedBox.state === "parked" ? 0 : trackedBox.speedKmh,
                  speedKind: trackedBox.state === "parked" ? "absolute" : trackedBox.speedKind,
                }).catch((err) => {
                  Sentry.logger.error("vehicle-detection: history save failed", { error: String(err) });
                });
                setSavedTrackIds((prev) => (prev.has(trackId) ? prev : new Set(prev).add(trackId)));
              }
            })
            .catch((err) => {
              Sentry.logger.error("vehicle-detection: plate OCR failed", { error: String(err) });
              console.warn("[vehicle-detection] plate OCR failed", err);
            })
            .finally(() => platesReadingRef.current.delete(trackId))
        );
      }

      setEmergencyTrackIds(nextEmergencyIds);
      pruneLightbarTracks(liveIds);

      // Every capture writes a brand-new temp JPEG that isn't reliably cleaned up on its own --
      // vision-camera's own docs are explicit that a captured photo "might get deleted once the
      // app closes," not before. Deleted once every plate crop that reads from it this tick has
      // actually finished (best-effort -- a failed cleanup here is silently swallowed, never
      // surfaced as a detection failure).
      const capturedUri = photo.uri;
      Promise.allSettled(plateReadPromises).finally(() => {
        try {
          new File(capturedUri).delete();
        } catch {}
      });
      Sentry.logger.info("perf: vehicleDetectionScreen.sideCaptureCycle", {
        ms: Date.now() - tCycleStart,
        vehicleCount: boxesRef.current.length,
      });
    } catch (err) {
      console.warn("[vehicle-detection] plate/lightbar capture failed", err);
      Sentry.logger.error("vehicle-detection: plate/lightbar capture failed", { error: String(err) });
      if (unmountedRef.current) return;
      consecutiveFailuresRef.current += 1;
      // A single bad frame is normal (a real hiccup, not a real problem) and just gets silently
      // retried on the next tick with no visible change at all. Only once it's clearly not a
      // one-off does a small, non-blocking "Reconnecting…" indicator appear (see the render
      // below) -- this loop never stops or waits on anything here, so there's nothing for the
      // driver to tap; it clears itself the instant a capture actually succeeds again. Vehicle
      // detection itself keeps running regardless -- it's the Frame Processor's own separate
      // pipeline, unaffected by this loop's failures.
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_CAPTURE_FAILURES) {
        Sentry.logger.error("vehicle-detection: repeated side-capture failures, still retrying", {
          consecutiveFailures: consecutiveFailuresRef.current,
        });
        setRecovering(true);
      }
    } finally {
      sideCapturingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (status !== "running") return;
    const intervalMs = isNavigating ? SIDE_CAPTURE_INTERVAL_MS_NAVIGATING : SIDE_CAPTURE_INTERVAL_MS;
    sideIntervalRef.current = setInterval(captureForPlateAndLightbar, intervalMs);
    return () => {
      if (sideIntervalRef.current) clearInterval(sideIntervalRef.current);
    };
  }, [status, captureForPlateAndLightbar, isNavigating]);

  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  }, []);

  // vision-camera's useCameraPermission() reads the native permission status synchronously
  // (unlike expo-camera's async-only useCameraPermissions(), which had a real "still checking,
  // null" state this screen used to have to guard against with its own dedicated loading
  // branch) -- hasPermission is always a real boolean from the very first render, so there's
  // no equivalent indeterminate state left to handle here.
  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          TrackLine needs camera access to detect vehicles in view.
        </Text>
        <Pressable style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant camera access</Text>
        </Pressable>
        <Pressable onPress={onClose}>
          <Text style={styles.closeLink}>Close</Text>
        </Pressable>
      </View>
    );
  }

  // Real absent-hardware/still-enumerating state (vision-camera's device list can briefly be
  // empty right after the native module initializes) -- same "always a working Close, never a
  // dead-end blank screen" principle as the permission screens above.
  if (!device) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator color="#fff" />
        <Text style={styles.permissionText}>Looking for a camera…</Text>
        <Pressable onPress={onClose}>
          <Text style={styles.closeLink}>Close</Text>
        </Pressable>
      </View>
    );
  }

  // Went through two wrong single-answer theories this session before landing on this -- worth
  // recording both, since real screenshot evidence (a mounted/near-flat phone: status bar and
  // "X"/zoom buttons all still in their normal PORTRAIT positions, while the actual scene content
  // -- including a real "AKAI" label visible in one of the reports -- is rotated 90°) disproved
  // BOTH of them on their own:
  //   1. "The preview always shows the RAW sensor orientation" (the original assumption) --
  //      wrong whenever the interface genuinely does rotate (actively turning the phone by hand),
  //      where vision-camera's own preview auto-rotates via `previewOrientation` (confirmed from
  //      its source, Camera.tsx's onPreviewOrientationChanged/RotationHelper.ts) and remapping on
  //      top of that double-rotates the box.
  //   2. "The preview always auto-rotates to match the physical device" (this session's first
  //      fix) -- wrong for a phone mounted close to flat (a dashboard/window-sill dashcam mount,
  //      the actual real-world case a driving app hits constantly): iOS's own interface
  //      orientation is gravity-derived and a shallow mount angle often never confidently commits
  //      to landscape at all, so nothing ever tells vision-camera's preview to rotate -- it's
  //      still showing the raw, un-rotated sensor buffer, exactly like the screenshots show.
  // The real signal isn't "is the phone physically landscape" (rawFrameInfo.orientation) OR
  // "did the interface visually rotate" (isLandscapeLayout, from useWindowDimensions) in
  // isolation -- it's whether the two AGREE. frame.orientation is read directly off the camera's
  // own sensor/motion signal (unaffected by whether the app's interface ever actually rotates --
  // it's already proven reliable for the Frame Processor's own model-feeding rotation above, no
  // complaints there), while isLandscapeLayout only flips once iOS's interface genuinely commits.
  // They match whenever the preview really did auto-rotate (case 1) -- no remap needed, box.bbox
  // already lines up. They DISAGREE exactly in the flat-mount case (2) -- sensor says landscape,
  // interface never moved, so the preview is still raw -- and that's exactly when the remap is
  // needed, same math as the still-photo capture path already uses for its own separate raw
  // buffer below.
  const isLandscapeFrame =
    rawFrameInfo?.orientation === "landscape-left" || rawFrameInfo?.orientation === "landscape-right";
  const previewLikelyUnrotated = isLandscapeFrame && !isLandscapeLayout;
  const displaySize =
    previewLikelyUnrotated && rawFrameInfo ? { width: rawFrameInfo.width, height: rawFrameInfo.height } : photoSize;

  const scale =
    displaySize && containerSize
      ? Math.max(containerSize.width / displaySize.width, containerSize.height / displaySize.height)
      : 1;
  const offsetX = displaySize && containerSize ? (containerSize.width - displaySize.width * scale) / 2 : 0;
  const offsetY = displaySize && containerSize ? (containerSize.height - displaySize.height * scale) / 2 : 0;

  // Tapping a locked box opens this detail panel -- every field below is read straight off
  // that vehicle's own live tracked state (the same `boxes`/`plateTexts`/`emergencyTrackIds`
  // the boxes themselves render from), never re-queried or recomputed separately, so it can
  // never show something different from what's actually on screen.
  const selectedBox = selectedTrackId !== null ? boxes.find((b) => b.id === selectedTrackId) : undefined;
  const selectedPlate = selectedTrackId !== null ? plateTexts.get(selectedTrackId) : undefined;
  const selectedIsEmergency = selectedTrackId !== null && emergencyTrackIds.has(selectedTrackId);

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      {/* isActive stays true for as long as this component is mounted -- the Modal fix in
          MapScreen.tsx already guarantees a real unmount (camera session torn down along with
          everything else) on Close, so there's no separate "pause the session" state needed
          here. pixelFormat="yuv" is the efficient native default for Frame Processors --
          vision-camera-resize-plugin (used inside frameProcessor above) handles the
          YUV->RGB conversion this model needs entirely on its own thread.
          Landscape add-on only -- key'd on orientation so React fully unmounts and remounts a
          fresh native preview view across a rotation instead of trying to resize the existing
          one in place. Real, confirmed reason this is here: the native preview layer
          (AVCaptureVideoPreviewLayer, always "cover"/resizeAspectFill -- it doesn't letterbox by
          itself) can end up keeping a stale frame from before the rotation, rendering only in
          whatever small region its old layout still remembers with the rest of the screen just
          black, rather than picking up the container's new post-rotation size. A fresh mount
          guarantees a fresh, correctly-sized layout every time; the brief black flash during the
          remount is a small, expected cost for a real physical rotation, not a stuck/broken
          state like the one this fixes. */}
      <Camera
        key={isLandscapeLayout ? "landscape" : "portrait"}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={true}
        photo={true}
        photoQualityBalance="speed"
        pixelFormat="yuv"
        // Real, direct fix for "doesn't pick up vehicles at night" -- the model can only ever
        // detect what's actually visible in the captured frame, and a dark, motion-blurred night
        // frame (streetlights blown out, everything else near-black, exactly what a low-light
        // dashcam shot looks like) gives it far less real signal to work with than a well-lit
        // daytime frame, regardless of confidence threshold tuning. lowLightBoost is the OS's own
        // sensor-level low-light enhancement (only applied when the hardware actually supports
        // it), improving the raw frame quality the detector runs against, not just how the photo
        // looks to a human.
        lowLightBoost={device?.supportsLowLightBoost ?? false}
        frameProcessor={frameProcessor}
        zoom={zoomFactor}
        onInitialized={() =>
          Sentry.logger.info("perf: vehicleDetectionScreen.cameraInitialized", {
            ms: Date.now() - mountTimeRef.current,
          })
        }
        onError={(error) =>
          Sentry.logger.error("vehicle-detection: camera runtime error", {
            code: error.code,
            message: error.message,
          })
        }
      />

      {/* Real zoom -- changes the actual native capture session (see zoomFactor's own comment
          above), so this isn't just a cosmetic preview crop: both the Frame Processor and
          takePhoto() genuinely see the zoomed-in frame, giving the detector more real pixels on
          a distant vehicle. A single normal/5x toggle, not a fine +/- control -- two clear,
          always-good states rather than a range that could land somewhere in between with no
          real benefit. */}
      <Pressable
        style={({ pressed }) => [
          styles.zoomToggle,
          // insets.right is always 0 in portrait, so this is identical to the old static
          // `right: spacing.md` there -- only actually shifts once physically landscape, where
          // a notch/camera cutout can land on either side depending on which way it's rotated.
          { top: insets.top + spacing.md + 140, right: insets.right + spacing.md },
          pressed && { opacity: pressedOpacity },
        ]}
        onPress={toggleZoom}
        accessibilityLabel={is5xZoom ? "Switch to normal view" : "Switch to 5x zoom view"}
        hitSlop={8}
      >
        <Text style={styles.zoomToggleText}>{is5xZoom ? "5x" : "1x"}</Text>
      </Pressable>

      {photoSize &&
        containerSize &&
        boxes
          // Tracking (speedTrackerRef, above) still runs against the full MIN_DETECTION_SCORE
          // bar -- only what actually gets DRAWN is held to the higher MIN_RENDER_SCORE, so a
          // weak read never disappears from tracking, it just doesn't put a shaky box on screen
          // until it's a read worth trusting.
          .filter((box) => box.score >= MIN_RENDER_SCORE)
          .map((box) => {
          // See the scale/offsetX/offsetY comment above -- only remapped into raw-sensor space
          // when the preview is confirmed likely un-rotated (sensor landscape, interface never
          // moved); otherwise box.bbox already matches what the auto-rotated preview shows.
          const displayBbox = previewLikelyUnrotated
            ? mapUprightBoxToRawPhoto(
                box.bbox,
                photoSize.width,
                photoSize.height,
                displaySize!.width,
                displaySize!.height,
                rawFrameInfo!.orientation
              )
            : box.bbox;
          const [x, y, w, h] = displayBbox;
          const isEmergency = emergencyTrackIds.has(box.id);
          const isSelected = selectedTrackId === box.id;
          const plateInfo = plateTexts.get(box.id);
          // "absolute" -- ego GPS speed was available, so this is a real estimate of the
          // OTHER vehicle's own road speed (see speedTracker.ts's combineWithEgoSpeed),
          // exactly what this label is meant to answer. "closing" -- no ego speed to combine
          // with, so this is only the closing/receding rate between the two vehicles, labeled
          // with an explicit arrow (never presented as the vehicle's real speed) so it isn't
          // mistaken for the same thing. Never a fabricated number either way -- null shows
          // nothing at all.
          const speedLabel =
            box.state === "parked"
              ? "Parked"
              : box.speedKmh === null
                ? null
                : box.speedKind === "absolute"
                  ? `${Math.max(0, Math.round(box.speedKmh))} km/h`
                  : Math.abs(box.speedKmh) < 3
                    ? "steady"
                    : `${box.speedKmh > 0 ? "▲" : "▼"} ${Math.round(Math.abs(box.speedKmh))} km/h`;
          // Clamped to the visible container -- a close vehicle at 5x zoom (or just one that
          // fills most of the frame at 1x) very plausibly has a real box bigger than the screen
          // itself, with its edges landing well off-screen in every direction. Previously the
          // box (and its TargetCorners brackets) rendered at its true, unclamped size/position
          // regardless, meaning a box that big had EVERY edge off-screen -- no border, no
          // corner, nothing visible at all, even though a vehicle genuinely was detected and
          // labeled (the confidence chip, drawn separately, was the only thing still showing).
          // Computing true edges first and clamping each one independently means whatever
          // portion of the box actually is on-screen still draws a real, visible rounded-corner
          // frame hugging the visible part of the vehicle, instead of vanishing entirely.
          const rawLeftPx = x * scale + offsetX;
          const rawTopPx = y * scale + offsetY;
          const rawRightPx = rawLeftPx + w * scale;
          const rawBottomPx = rawTopPx + h * scale;
          const edgeClampedLeftPx = Math.max(0, Math.min(rawLeftPx, containerSize.width));
          // Floored at insets.top (not 0) -- a near-full-frame box's top edge otherwise clamped
          // straight to the physical top of the full-bleed camera preview, which put the
          // type/confidence label (rendered 6px inside the box's own top edge, see labelAboveBox
          // below) directly under the status bar/TestFlight banner instead of below it -- the
          // real cause of the label text reading as jumbled into "TestFlight" in testing
          // screenshots.
          const edgeClampedTopPx = Math.max(insets.top, Math.min(rawTopPx, containerSize.height));
          const edgeClampedWidthPx = Math.max(0, Math.min(rawRightPx, containerSize.width) - edgeClampedLeftPx);
          const edgeClampedHeightPx = Math.max(0, Math.min(rawBottomPx, containerSize.height) - edgeClampedTopPx);
          // Second, purely visual safety net on top of the frame-processor's own oversized-box
          // score gate (see OVERSIZED_BOX_FRAME_FRACTION above) -- caps how much of the screen
          // the drawn lock box itself is ever allowed to cover, re-centered on the box's own true
          // center rather than the container's, so a real close-up vehicle still reads as
          // "locked on tight" instead of a rectangle swallowing the whole preview. Display-only,
          // same principle as enforceMinAspectRatio in speedTracker.ts -- it never touches
          // box.bbox itself, so the actual distance/speed estimate (which reads the raw detection
          // width directly) can't be corrupted by this.
          const maxBoxWidthPx = containerSize.width * MAX_BOX_RENDER_FRACTION;
          const maxBoxHeightPx = containerSize.height * MAX_BOX_RENDER_FRACTION;
          const boxCenterXPx = edgeClampedLeftPx + edgeClampedWidthPx / 2;
          const boxCenterYPx = edgeClampedTopPx + edgeClampedHeightPx / 2;
          const boxWidthPx = Math.min(edgeClampedWidthPx, maxBoxWidthPx);
          const boxHeightPx = Math.min(edgeClampedHeightPx, maxBoxHeightPx);
          const boxLeftPx = Math.max(0, Math.min(boxCenterXPx - boxWidthPx / 2, containerSize.width - boxWidthPx));
          const boxTopPx = Math.max(
            insets.top,
            Math.min(boxCenterYPx - boxHeightPx / 2, containerSize.height - boxHeightPx)
          );
          const lockColor = isEmergency ? "#DC2626" : isSelected ? "#22D3EE" : speedLockColor(box);
          // Keeps the type/speed labels fully on-screen even when the detected box itself
          // extends past an edge -- a vehicle filling most of the frame very plausibly has its
          // own left edge at or past 0, which used to cut the label's own text off (e.g.
          // "Vehicle 44%" rendering as "cle 44%"). Shifts right by however far the box's own
          // left is negative, never left, so the label stays anchored to the vehicle it's
          // labeling rather than drifting toward the screen center. labelAboveBox drops both
          // labels inside the box (below its top edge) instead of above it whenever there's no
          // real room above without sitting under the status bar/notch.
          const labelLeftPx = Math.max(0, -boxLeftPx);
          const labelAboveBox = boxTopPx - 24 >= insets.top + spacing.xs;
          return (
            <React.Fragment key={box.id}>
              <Pressable
                onPress={() => onSelectBox(box.id)}
                // A distant or partially-clipped vehicle's box can be genuinely small on screen
                // -- hitSlop keeps "tap the vehicle to see its details" reliably tappable even
                // then, rather than needing a pixel-perfect tap on a narrow box.
                hitSlop={16}
                style={[
                  styles.box,
                  // Emergency coloring is carried entirely by lockColor (fed into targetRect
                  // below) now that box itself has no border of its own to separately color.
                  isSelected && styles.boxSelected,
                  {
                    left: boxLeftPx,
                    top: boxTopPx,
                    width: boxWidthPx,
                    height: boxHeightPx,
                  },
                ]}
              >
                <TargetCorners width={boxWidthPx} height={boxHeightPx} color={lockColor} />
                <Text
                  style={[
                    styles.boxLabel,
                    isEmergency && styles.boxLabelEmergency,
                    { left: labelLeftPx, top: labelAboveBox ? -24 : 6 },
                  ]}
                >
                  {isEmergency ? `${box.label} — lights active` : `${box.label} ${Math.round(box.score * 100)}%`}
                </Text>
                {/* Bottom-center, just outside the box's own bottom edge -- per explicit
                    request matching a real reference screenshot (speed as small live text
                    under the vehicle, not layered inside/above the box with the type/
                    confidence label). Never a guessed number -- this is the exact same live
                    speedLabel value the tracker just computed for this frame, same as before
                    this only moved where it renders. */}
                {speedLabel && (
                  <View
                    style={[styles.speedLabelWrap, { top: boxHeightPx + 6 }]}
                    pointerEvents="none"
                  >
                    {/* Every tracked vehicle renders its own independent badge here -- state
                        (parked vs moving) and speed are computed per-track in speedTracker.ts,
                        never a single global reading -- so a parked car and a moving car sharing
                        the same frame each show their own correct label at the same time. The
                        small leading icon (parking-circle vs speedometer) makes that state
                        readable at a glance, not just from the text/color, per explicit request
                        for a more professional, neatly-designed badge. */}
                    <View style={[styles.speedLabel, box.state === "parked" && styles.speedLabelParked]}>
                      {box.state === "parked" ? (
                        <MaterialCommunityIcons name="parking" size={11} color="#fff" />
                      ) : (
                        <Ionicons name="speedometer-outline" size={10} color="#fff" />
                      )}
                      <Text style={styles.speedLabelText}>{speedLabel}</Text>
                    </View>
                  </View>
                )}
                {/* Tap a box to lock visual focus on it when several vehicles are in frame --
                    a this-screen, this-session UI aid only (like tapping to focus a camera).
                    Nothing about the selection is saved, stored, or sent anywhere; it clears the
                    moment the vehicle leaves frame or this screen closes. */}
                {isSelected && (
                  <View style={styles.selectedBadge} pointerEvents="none">
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                )}
              </Pressable>
              {/* Plate text only ever appears once on-device OCR actually confirms a real read
                  (see plateOcr.ts) -- never a location guess with nothing behind it. Once
                  confirmed it's also automatically written to the on-device vehicle history log
                  (never sent off-device -- see vehicleHistory.ts and the small "Saved" badge
                  below), not just held in this screen's own session state anymore. The frame
                  itself is the *real* estimated plate rectangle (plateLocator.ts's region, the
                  same crop OCR actually read from) in its own real position, not a generic label
                  floating under the vehicle box -- rendered as a sibling of the vehicle box (not
                  nested in it) since the plate region has its own independent coordinates in the
                  source photo. */}
              {plateInfo &&
                (() => {
                  // Same remap condition as the vehicle box above -- plateInfo.region is also in
                  // photoSize's upright space, so it needs the same raw-sensor-space remap
                  // exactly when the preview is confirmed likely un-rotated.
                  const displayPlateRegion: [number, number, number, number] = previewLikelyUnrotated
                    ? mapUprightBoxToRawPhoto(
                        [plateInfo.region.x, plateInfo.region.y, plateInfo.region.w, plateInfo.region.h],
                        photoSize.width,
                        photoSize.height,
                        displaySize!.width,
                        displaySize!.height,
                        rawFrameInfo!.orientation
                      )
                    : [plateInfo.region.x, plateInfo.region.y, plateInfo.region.w, plateInfo.region.h];
                  // Same off-screen-edge clamp as the vehicle box above -- a plate region is
                  // normally a small sub-crop well inside the vehicle box, but on a vehicle box
                  // that's itself mostly off-screen (a close vehicle at 5x zoom) the plate region
                  // can still start off-screen too.
                  const rawPlateLeftPx = displayPlateRegion[0] * scale + offsetX;
                  const rawPlateTopPx = displayPlateRegion[1] * scale + offsetY;
                  const rawPlateRightPx = rawPlateLeftPx + displayPlateRegion[2] * scale;
                  const rawPlateBottomPx = rawPlateTopPx + displayPlateRegion[3] * scale;
                  const plateLeftPx = Math.max(0, Math.min(rawPlateLeftPx, containerSize.width));
                  const plateTopPx = Math.max(0, Math.min(rawPlateTopPx, containerSize.height));
                  const plateWidthPx = Math.max(0, Math.min(rawPlateRightPx, containerSize.width) - plateLeftPx);
                  const plateHeightPx = Math.max(0, Math.min(rawPlateBottomPx, containerSize.height) - plateTopPx);
                  const plateLabelLeftPx = Math.max(0, -plateLeftPx);
                  const plateLabelAbove = plateTopPx - 26 >= insets.top + spacing.xs;
                  const isSaved = savedTrackIds.has(box.id);
                  return (
                    <View
                      // "box-none" (not "none") -- per explicit request that a confirmed plate
                      // "automatically displays it and users can have option to revcheck" right
                      // there, not only after first tapping the vehicle box to open the detail
                      // panel below. The frame/label themselves still pass touches through (no
                      // onPress of their own), only the new Rev Check pill actually captures one.
                      pointerEvents="box-none"
                      style={[
                        styles.plateFrame,
                        { left: plateLeftPx, top: plateTopPx, width: plateWidthPx, height: plateHeightPx },
                      ]}
                    >
                      <TargetCorners width={plateWidthPx} height={plateHeightPx} color="#22D3EE" />
                      <View
                        style={[
                          styles.plateFrameLabelWrap,
                          { left: plateLabelLeftPx, top: plateLabelAbove ? -26 : 6 },
                        ]}
                        pointerEvents="none"
                      >
                        <Text style={styles.plateFrameLabelText} numberOfLines={1}>
                          {plateInfo.text}
                        </Text>
                      </View>
                      {/* Every plateInfo here is already a CONFIRMED read (plateTexts only ever
                          holds one after PLATE_CONFIRM_COUNT -- see captureForPlateAndLightbar's
                          own comment), so this never needs a disabled/"waiting" state the way the
                          detail panel's own Rev Check button below does. Same destination/params
                          as that button, just reachable in one tap straight off the live plate
                          instead of needing to select the box first. */}
                      <Pressable
                        onPress={() =>
                          navigation.navigate("RevCheck", {
                            plate: plateInfo.text,
                            vehicleLabel: box.label as "Vehicle" | "Heavy Vehicle",
                            speedKmh: box.state === "parked" ? 0 : box.speedKmh,
                            speedKind: box.state === "parked" ? "absolute" : box.speedKind,
                          })
                        }
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.plateRevCheckPill,
                          // Always anchored off the frame's own bottom edge -- the label above
                          // sits near the TOP of the frame either way it's positioned (see
                          // plateLabelAbove's own comment), so the bottom stays clear regardless.
                          // Same left clamp as the label above, so it never renders off-screen
                          // when the frame itself is partly off the left edge.
                          { top: plateHeightPx + 6, left: plateLabelLeftPx },
                          pressed && { opacity: pressedOpacity },
                        ]}
                      >
                        <Ionicons name="search" size={10} color="#FFFFFF" />
                        <Text style={styles.plateRevCheckPillText}>Rev Check</Text>
                      </Pressable>
                      {isSaved && (
                        <View style={styles.savedBadge} pointerEvents="none">
                          <View style={styles.savedBadgeInner}>
                            <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                            <Text style={styles.savedBadgeText}>Saved</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })()}
            </React.Fragment>
          );
        })}

      {(status !== "running" || !infoDismissed) && (
      <View
        style={[
          styles.banner,
          isLandscapeLayout && styles.bannerLandscape,
          {
            top: insets.top + spacing.md,
            // Side-anchored (right, capped width) instead of spanning the full width once
            // landscape -- a full-width explainer banner would otherwise stretch across almost
            // the entire wide frame, covering far more of the live camera view than it needs to.
            // insets.right/left are always 0 in portrait, so the portrait case is unchanged.
            ...(isLandscapeLayout
              ? { right: insets.right + spacing.lg }
              : { left: insets.left + spacing.lg, right: insets.right + spacing.lg }),
          },
        ]}
      >
        {status === "loading-model" && (
          <>
            <ActivityIndicator color="#fff" />
            {/* Loading is now the native TFLite model parse (react-native-fast-tflite) --
                fast (a bundled ~4MB file, no network fetch, no separate warmup pass the way
                the old tfjs model needed). Past the first attempt this is honest that it's
                retrying, but never asks for a tap -- see the auto-retry effect above. */}
            <Text style={styles.bannerText}>
              {modelLoadAttempt > 0
                ? "Still loading the detection model — retrying automatically…"
                : "Loading detection model…"}
            </Text>
          </>
        )}
        {status === "running" && !infoDismissed && (
          <>
            <Text style={styles.bannerText}>
              Detecting vehicles — amber target-lock box,
              generic "Vehicle"/"Heavy Vehicle". Turns red with "lights active" only once an
              actual strobing red/blue light is confirmed near the vehicle's own roofline for a
              few seconds — real detected evidence, not a guess at vehicle type (a
              marked/unmarked car with no lights on shows no different to any other car, the
              same way a driver wouldn't notice one either). Speed (top-center of box) shows a
              real km/h estimate of that vehicle's own road speed once your own GPS speed is
              available to combine with it (assumes it's ahead of you, same direction); with no
              GPS fix it falls back to an arrow + closing/receding rate instead, and shows
              "0 km/h" once a vehicle has been still for a couple of seconds. A plate number
              only appears once the same on-device text read comes back at least twice in a
              row — it's never stored or sent anywhere, just shown live while that vehicle
              stays in view. Tap any box for its full details. Use the 1x/5x button on the right
              to zoom in on a distant vehicle — this zooms the real camera capture, not just the
              preview, so it can genuinely help detect something too far away to register at 1x.
            </Text>
            <Pressable onPress={dismissInfo} hitSlop={12} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>
          </>
        )}
      </View>
      )}

      {/* Small, non-blocking "still working on it" indicator -- never a dead end, never asks
          for a tap. Only shown once the explainer banner above is out of the way (same top
          offset -- recovering can only become true while status is "running", so the banner is
          only still up here if it hasn't been dismissed yet) and clears itself the instant a
          side capture actually succeeds again. Vehicle detection itself is unaffected by this --
          it's the Frame Processor's own separate pipeline. */}
      {recovering && infoDismissed && (
        <View style={[styles.recoveringPill, { top: insets.top + spacing.md }]}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.recoveringPillText}>Reconnecting to camera…</Text>
        </View>
      )}

      {/* Detail panel for whichever box is tapped (see onSelectBox) -- speed/plate/type/
          emergency status, all read live off the same tracked state the boxes themselves use.
          Tapping the same box again (or its own close) clears the selection, same as tapping
          it once already does for the on-box highlight. */}
      {selectedBox && (
        <View
          style={[
            styles.detailPanel,
            isLandscapeLayout && styles.detailPanelLandscape,
            {
              bottom: insets.bottom + spacing.xl + 64,
              // Side-anchored (right, capped width) instead of spanning the full width once
              // landscape, same reasoning as the explainer banner above. insets.right/left are
              // always 0 in portrait, so that case is unchanged.
              ...(isLandscapeLayout
                ? { right: insets.right + spacing.lg }
                : { left: insets.left + spacing.lg, right: insets.right + spacing.lg }),
            },
          ]}
        >
          <View style={styles.detailPanelHeader}>
            <Text style={styles.detailPanelTitle}>{selectedBox.label}</Text>
            <Pressable onPress={() => setSelectedTrackId(null)} hitSlop={10} accessibilityLabel="Close vehicle details">
              <Ionicons name="close" size={18} color="#9CA3AF" />
            </Pressable>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Speed</Text>
            {/* Bright, colored speed pill (same thresholds as the on-box lock color -- under 50
                amber, 50-70 green, over 70 red) instead of plain white text, per explicit
                request -- the color itself reads as fast/normal/slow at a glance, the same way
                the box's own lock color already does. */}
            <View style={[styles.speedPill, { backgroundColor: speedLockColor(selectedBox) }]}>
              {/* Red is dark/saturated enough that white text reads far better on it than the
                  dark text amber/green (both bright, light colors) need instead. */}
              <Text style={[styles.speedPillText, speedLockColor(selectedBox) === "#DC2626" && styles.speedPillTextOnRed]}>
                {selectedBox.state === "parked"
                  ? "Parked"
                  : selectedBox.speedKmh === null
                    ? "—"
                    : selectedBox.speedKind === "absolute"
                      ? `${Math.max(0, Math.round(selectedBox.speedKmh))} km/h`
                      : `${Math.round(Math.abs(selectedBox.speedKmh))} km/h closing`}
              </Text>
            </View>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Plate</Text>
            <Text style={styles.detailValue}>{selectedPlate?.text ?? "Not read yet"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Emergency lights</Text>
            <Text style={[styles.detailValue, selectedIsEmergency && styles.detailValueAlert]}>
              {selectedIsEmergency ? "Active" : "None detected"}
            </Text>
          </View>
          {/* Explicit, tappable "save this capture" per request -- a confirmed plate read is
              already auto-saved to the persistent history log the instant it's confirmed (see
              captureForPlateAndLightbar's plate-confirm callback), but that happens silently in
              the background with only a small badge on the plate frame as feedback. This gives
              a direct, visible action + confirmation for the exact same save, same gating as
              "Run REV Check" (a real plate is the vehicle's only stable identity to save under). */}
          <Pressable
            onPress={() => {
              if (!selectedPlate || selectedTrackId === null) return;
              upsertDetectedVehicle(selectedPlate.text, {
                label: selectedBox.label as "Vehicle" | "Heavy Vehicle",
                speedKmh: selectedBox.state === "parked" ? 0 : selectedBox.speedKmh,
                speedKind: selectedBox.state === "parked" ? "absolute" : selectedBox.speedKind,
              }).catch((err) => {
                Sentry.logger.error("vehicle-detection: manual save failed", { error: String(err) });
              });
              setSavedTrackIds((prev) => (prev.has(selectedTrackId) ? prev : new Set(prev).add(selectedTrackId)));
            }}
            disabled={!selectedPlate}
            style={({ pressed }) => [
              styles.saveButton,
              !selectedPlate && styles.saveButtonDisabled,
              pressed && !!selectedPlate && { opacity: pressedOpacity },
            ]}
          >
            <Ionicons
              name={selectedTrackId !== null && savedTrackIds.has(selectedTrackId) ? "checkmark-circle" : "download-outline"}
              size={16}
              color={selectedPlate ? colors.accent : "#9CA3AF"}
            />
            <Text style={[styles.saveButtonText, !selectedPlate && styles.saveButtonTextDisabled]}>
              {!selectedPlate
                ? "Waiting for plate to save…"
                : selectedTrackId !== null && savedTrackIds.has(selectedTrackId)
                  ? "Saved to vehicle history"
                  : "Save capture"}
            </Text>
          </Pressable>
          {/* Only enabled once there's an actual confirmed plate to check -- a REV check needs a
              real plate number, not a guess, same rule the plate label itself follows. Navigates
              straight into the same RevCheckScreen a saved history entry opens, prefilled with
              this vehicle's live label/speed/plate (see RevCheckScreen's own summary card). */}
          <Pressable
            onPress={() =>
              selectedPlate &&
              navigation.navigate("RevCheck", {
                plate: selectedPlate.text,
                vehicleLabel: selectedBox.label as "Vehicle" | "Heavy Vehicle",
                speedKmh: selectedBox.state === "parked" ? 0 : selectedBox.speedKmh,
                speedKind: selectedBox.state === "parked" ? "absolute" : selectedBox.speedKind,
              })
            }
            disabled={!selectedPlate}
            style={({ pressed }) => [
              styles.revCheckButton,
              !selectedPlate && styles.revCheckButtonDisabled,
              pressed && !!selectedPlate && { opacity: pressedOpacity },
            ]}
          >
            <Text style={styles.revCheckButtonText}>
              {selectedPlate ? "Run REV Check" : "Waiting for plate read…"}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Only control left at the bottom now that Switch Camera is gone (per explicit request
          -- it also removed the whole facing-switch-mid-capture crash risk category with it).
          A transparent circular X (not a solid white pill) so it reads as a real camera-
          overlay exit control rather than a floating opaque button competing with the actual
          vehicle boxes for attention. */}
      <Pressable
        style={({ pressed }) => [
          styles.closeButton,
          { bottom: insets.bottom + spacing.xl },
          pressed && { opacity: pressedOpacity },
        ]}
        onPress={onClose}
        accessibilityLabel="Close vehicle detection"
        hitSlop={12}
      >
        <Ionicons name="close" size={26} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  permissionText: {
    color: "#fff",
    fontSize: 15,
    textAlign: "center",
  },
  permissionButton: {
    backgroundColor: "#2563EB",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  permissionButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  closeLink: {
    color: "#9CA3AF",
    marginTop: 8,
  },
  // No border of its own -- targetRect (rendered as this box's child) is the single, correctly
  // colored outline now, matching the plain thin rectangle in the reference screenshots. This
  // used to also carry its own faint static border (from the old four-corner-bracket look,
  // which needed a separate "always visible" outline connecting the brackets) -- redundant now
  // that targetRect is a full rectangle already, and it fought with targetRect's own sharper
  // corners at the edges.
  box: {
    position: "absolute",
  },
  // Thin, tight rectangle -- see TargetCorners' own comment for why this replaced the old
  // four-corner-bracket style. 1.5px keeps it reading as a clean tracking outline, not a bulky
  // block that eats into the vehicle it's supposed to be hugging.
  targetRect: {
    position: "absolute",
    top: 0,
    left: 0,
    borderWidth: 1.5,
    borderRadius: 2,
  },
  boxSelected: {
    borderColor: "#22D3EE",
    borderWidth: 4,
  },
  selectedBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#22D3EE",
    alignItems: "center",
    justifyContent: "center",
  },
  boxLabel: {
    position: "absolute",
    top: -22,
    left: 0,
    backgroundColor: "#F59E0B",
    color: "#111827",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
    ...shadow.low,
  },
  boxLabelEmergency: {
    backgroundColor: "#DC2626",
    color: "#fff",
  },
  speedLabelWrap: {
    position: "absolute",
    // top always supplied inline at the call site (boxHeightPx + gap, so it sits just under
    // the box regardless of that box's own height) -- this is just a safe fallback.
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  speedLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#111827",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
    ...shadow.low,
  },
  speedLabelText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  speedLabelParked: {
    backgroundColor: "#4B5563",
  },
  // Sized/positioned to the real estimated plate rectangle (see the render call site) -- an
  // exact frame around the actual plate, not a generic fixed-size badge floating near it.
  // No border of its own -- same reasoning as the vehicle box above, targetRect (rendered as
  // this frame's child) is the single rectangle outline around the plate now.
  plateFrame: {
    position: "absolute",
  },
  // On top of the plate's own target rectangle (not below it) -- reads as a real label
  // tagging the locked-on plate, per explicit request.
  plateFrameLabelWrap: {
    position: "absolute",
    top: -24,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  plateFrameLabelText: {
    backgroundColor: "#22D3EE",
    color: "#111827",
    fontSize: 12,
    fontWeight: "800",
    fontFamily: "monospace",
    letterSpacing: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
    ...shadow.low,
  },
  savedBadge: {
    position: "absolute",
    // Pushed further down (was -20) to sit clear below the new plateRevCheckPill row, which now
    // occupies the space just under the plate frame -- see that style's own top offset.
    bottom: -44,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 3,
  },
  plateRevCheckPill: {
    position: "absolute",
    // No left:0/right:0 -- this is a real, content-sized pill (like plateFrameLabelWrap's own
    // Text above it), not a full-width bar, so it doesn't stretch to an oddly wide blue strip
    // under a narrow plate frame. `left` is supplied inline at the call site (the same
    // plateLabelLeftPx clamp the label above already uses).
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#2563EB",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  plateRevCheckPillText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  savedBadgeInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(17, 24, 39, 0.85)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  savedBadgeText: {
    color: "#22C55E",
    fontSize: 10,
    fontWeight: "700",
  },
  banner: {
    position: "absolute",
    // left/right deliberately NOT set here -- always supplied inline at the call site (which
    // differs between portrait, full-width, and landscape, side-anchored-only) so there's never
    // a stale value from this base style left un-overridden.
    backgroundColor: "rgba(17, 24, 39, 0.85)",
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
  },
  // Landscape add-on only -- see the call site's own comment.
  bannerLandscape: {
    width: "48%",
    maxWidth: 420,
  },
  bannerText: {
    color: "#fff",
    fontSize: 12,
    flex: 1,
  },
  recoveringPill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    backgroundColor: "rgba(17, 24, 39, 0.85)",
    borderRadius: radius.pill,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  recoveringPillText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  detailPanel: {
    position: "absolute",
    // left/right deliberately NOT set here -- see banner's own comment, same reasoning.
    // Lightened way down from a near-opaque slab (was rgba(...,0.94)) per explicit request for
    // a more professional look that doesn't just block out the camera feed behind it -- the
    // subtle border (rather than a heavy fill) is what now gives the panel its shape/definition.
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.high,
  },
  // Landscape add-on only -- see the call site's own comment.
  detailPanelLandscape: {
    width: "46%",
    maxWidth: 380,
  },
  detailPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  detailPanelTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  detailLabel: {
    color: "#9CA3AF",
    fontSize: 13,
  },
  detailValue: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  speedPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  speedPillText: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "800",
  },
  speedPillTextOnRed: {
    color: "#FFFFFF",
  },
  detailValueAlert: {
    color: "#F87171",
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: spacing.sm,
  },
  saveButtonDisabled: {
    borderColor: "rgba(255,255,255,0.16)",
  },
  saveButtonText: {
    color: colors.accent,
    fontWeight: "700",
    fontSize: 13,
  },
  saveButtonTextDisabled: {
    color: "#9CA3AF",
  },
  revCheckButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
  },
  revCheckButtonDisabled: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  revCheckButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  closeButton: {
    position: "absolute",
    alignSelf: "center",
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomToggle: {
    position: "absolute",
    right: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(17, 24, 39, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomToggleText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
});
