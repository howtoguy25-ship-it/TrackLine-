import React, { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { Camera, useCameraDevice, useCameraFormat, useCameraPermission, useFrameProcessor } from "react-native-vision-camera";
import { useResizePlugin } from "vision-camera-resize-plugin";
import { useSharedValue, useRunOnJS } from "react-native-worklets-core";
import type { BoxedHybridObject } from "react-native-nitro-modules";
import type { TensorflowModel } from "react-native-fast-tflite";
import { useIsFocused } from "@react-navigation/native";
import { loadBoxedTFLiteModel, TFLITE_INPUT_SIZE } from "@/services/tfliteVehicleModel";
import { createBoxTracker, DEFAULT_TRACKER_PARAMS, iou } from "@/detection/boxTracker";
import { createSpeedTracker } from "@/utils/speedTracker";
import type { CameraTrack, LiveStatus, SceneKind } from "@/nav/liveScene";

// The camera half of the live road view: the back camera, the same on-device SSD MobileNet model
// and the same trained box tracker + distance estimate as the AI vehicle detection screen
// (screens/VehicleDetectionScreen.tsx), at 5 frames a second. Only the tracked boxes leave the
// camera thread; no frame or photo is kept. Mounted only while the live view is on and showing,
// and paused when another screen (e.g. vehicle detection itself) is in front.

const THROTTLE_MS = 200;
const MIN_SCORE = 0.3;
const LOW_SCORE = DEFAULT_TRACKER_PARAMS.lowScore;
const MAX_DETECTIONS = 20;
/** Model load gives up after this long and shows "didn't load" with Try again. */
export const MODEL_TIMEOUT_MS = 10_000;

interface Raw {
  cls: SceneKind;
  score: number;
  bbox: [number, number, number, number];
}

function suppress(dets: Raw[]): Raw[] {
  const kept: Raw[] = [];
  for (const d of [...dets].sort((a, b) => b.score - a.score)) if (!kept.some((k) => iou(k.bbox, d.bbox) > 0.25)) kept.push(d);
  return kept;
}

export function LiveVehicleCamera({
  attempt,
  egoSpeedKmh,
  onTracks,
  onStatus,
}: {
  /** Bump to try loading the model again. */
  attempt: number;
  egoSpeedKmh: number | null;
  onTracks: (tracks: CameraTrack[], frameWidth: number) => void;
  onStatus: (s: LiveStatus) => void;
}) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  const format = useCameraFormat(device, [{ videoResolution: { width: 1280, height: 720 } }]);
  const focused = useIsFocused();
  const model = useSharedValue<BoxedHybridObject<TensorflowModel> | null>(null);
  const [ready, setReady] = useState(false);
  const boxTracker = useRef(createBoxTracker());
  const speedTracker = useRef(createSpeedTracker());
  const egoRef = useRef(egoSpeedKmh);
  const onTracksRef = useRef(onTracks);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    egoRef.current = egoSpeedKmh;
    onTracksRef.current = onTracks;
    onStatusRef.current = onStatus;
  });

  useEffect(() => {
    if (!hasPermission) requestPermission().then((ok) => !ok && onStatusRef.current("noPermission"));
  }, [hasPermission, requestPermission]);
  useEffect(() => {
    if (!device) onStatusRef.current("noCamera");
  }, [device]);

  // The model: loaded once per attempt, 10 s limit.
  useEffect(() => {
    let cancelled = false;
    onStatusRef.current("starting");
    const timer = setTimeout(() => {
      if (!cancelled && !model.value) onStatusRef.current("modelFailed");
    }, MODEL_TIMEOUT_MS);
    loadBoxedTFLiteModel()
      .then((boxed) => {
        if (cancelled) return;
        model.value = boxed;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onStatusRef.current("modelFailed");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempt, model]);
  useEffect(
    () => () => {
      model.value = null;
    },
    [model]
  );

  const onFrame = useRunOnJS((dets: Raw[], frameWidth: number) => {
    const now = Date.now();
    const steady = boxTracker.current.update(suppress(dets), now);
    const tracked = speedTracker.current.update(
      steady.map((t) => ({ bbox: t.bbox, score: t.score, label: "Vehicle", trackId: t.id, cls: t.cls })),
      frameWidth,
      now,
      egoRef.current,
      1,
      []
    );
    const clsById = new Map(steady.map((t) => [t.id, (t.cls ?? "car") as SceneKind]));
    onStatusRef.current("running");
    onTracksRef.current(
      tracked.map((t) => ({ id: t.id, bbox: t.bbox, cls: clsById.get(t.id) ?? "car", distanceM: t.distanceM, speedKmh: t.speedKind === "absolute" ? t.speedKmh : null })),
      frameWidth
    );
  }, []);

  const { resize } = useResizePlugin();
  const last = useSharedValue(0);
  /* eslint-disable react-hooks/immutability -- worklet SharedValues are written through .value (their API) */
  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      const boxed = model.value;
      if (!boxed) return;
      const now = Date.now();
      if (now - last.value < THROTTLE_MS) return;
      last.value = now;
      // A dashboard mount is portrait; the raw buffer is landscape, so it's turned upright first.
      const portrait = frame.orientation === "portrait" || frame.orientation === "portrait-upside-down";
      const rotation = frame.orientation === "landscape-right" ? "90deg" : frame.orientation === "landscape-left" ? "270deg" : frame.orientation === "portrait-upside-down" ? "180deg" : "0deg";
      const w = portrait ? frame.width : frame.height;
      const h = portrait ? frame.height : frame.width;
      const resized = resize(frame, { scale: { width: TFLITE_INPUT_SIZE, height: TFLITE_INPUT_SIZE }, pixelFormat: "rgb", dataType: "uint8", rotation });
      const out = boxed.unbox().runSync([resized.buffer as ArrayBuffer]);
      const boxes = new Float32Array(out[0]);
      const classes = new Float32Array(out[1]);
      const scores = new Float32Array(out[2]);
      const count = Math.min(Math.round(new Float32Array(out[3])[0] ?? 0), MAX_DETECTIONS);
      const dets: Raw[] = [];
      for (let i = 0; i < count; i++) {
        const score = scores[i];
        if (score < Math.min(MIN_SCORE, LOW_SCORE)) continue;
        const c = Math.round(classes[i]);
        // car=2, motorcycle=3, bus=5, truck=7 (the model's labelmap, raw ids).
        const cls: SceneKind | null = c === 2 ? "car" : c === 3 ? "motorcycle" : c === 5 ? "bus" : c === 7 ? "truck" : null;
        if (!cls) continue;
        const bw = (boxes[i * 4 + 3] - boxes[i * 4 + 1]) * w;
        const bh = (boxes[i * 4 + 2] - boxes[i * 4]) * h;
        if (bw <= 0 || bh <= 0) continue;
        // Same sanity checks as the detection screen: no near-full-frame or tall boxes unless very sure.
        if ((bw / w > 0.65 || bh / h > 0.65) && score < 0.9) continue;
        if (bw / bh < 0.9 && score < 0.75) continue;
        dets.push({ cls, score, bbox: [boxes[i * 4 + 1] * w, boxes[i * 4] * h, bw, bh] });
      }
      onFrame(dets, w);
    },
    [resize, onFrame]
  );
  /* eslint-enable react-hooks/immutability */

  if (!device || !hasPermission) return null;
  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      format={format}
      isActive={focused && ready}
      pixelFormat="yuv"
      frameProcessor={frameProcessor}
      testID="live-camera"
    />
  );
}
