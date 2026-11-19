// Dashcam vehicle tracker: turns the detector's raw boxes (every ~200 ms) into steady, named
// tracks, the way ByteTrack/SORT do it, so boxes don't jitter, blink out for a frame, swap
// between two cars, or appear on a one-frame false hit.
//
//   1. Predict: every track moves on by its own velocity (a constant-velocity Kalman filter on
//      the box centre, width and height). A car that moves fast still lines up with its box.
//   2. Match the confident detections to the predicted boxes by overlap (best pairs first,
//      across ALL tracks and detections, not first-come-first-served).
//   3. Match the leftover low-score detections only to tracks that already exist, so a car that
//      goes faint (shadow, glare, partly hidden) keeps its track instead of being lost.
//   4. New tracks start only from confident detections and show after `minHits` frames; a lost
//      track keeps coasting on its prediction for `maxCoastMs` before it's dropped.
//
// The numbers in DEFAULT_TRACKER_PARAMS were trained (training/tracker/, ~5 min on CPU) against
// real ground-truth vehicle tracks from UA-DETRAC traffic video, using detections from this
// app's own shipping model on those frames. See training/tracker/REPORT.md for before/after.
// Pure TS (no React Native), so the exact same code is trained, tested and shipped.
import trained from "./boxTrackerParams.json";

export type Box = [number, number, number, number]; // x, y, width, height (px)

export interface TrackerParams {
  /** Detections at or above this score match first and can start tracks. */
  highScore: number;
  /** Detections between this and highScore only keep existing tracks alive. */
  lowScore: number;
  /** A new track needs at least this score. */
  newTrackScore: number;
  /** Minimum overlap (IoU with the predicted box) for a confident match. */
  matchIoU: number;
  /** Minimum overlap for a low-score match. */
  lowMatchIoU: number;
  /** Frames a track must be seen before it's shown. */
  minHits: number;
  /** How long a lost track keeps coasting on its prediction. */
  maxCoastMs: number;
  /** Kalman process noise for position and size, as a fraction of the box height. */
  qPos: number;
  /** Kalman process noise for velocity, as a fraction of the box height per second. */
  qVel: number;
  /** Kalman measurement noise, as a fraction of the box height. */
  rMeas: number;
}

export const DEFAULT_TRACKER_PARAMS: TrackerParams = trained.params as TrackerParams;

export interface Detection {
  bbox: Box;
  score: number;
  label?: string;
  /** Detector class ("car", "truck"...), carried through to the track. */
  cls?: string;
}

export interface Track {
  id: number;
  bbox: Box;
  score: number;
  label?: string;
  cls?: string;
  hits: number;
  /** true when this frame's box is a prediction (no detection matched). */
  coasting: boolean;
  /** Velocity of the box centre, px per second. */
  velocity: [number, number];
}

// One constant-velocity Kalman filter per box dimension: state [value, rate], covariance 2x2.
interface Axis {
  x: number;
  v: number;
  p00: number;
  p01: number;
  p11: number;
}

const axis = (x: number, varPos: number, varVel: number): Axis => ({ x, v: 0, p00: varPos, p01: 0, p11: varVel });

function predictAxis(a: Axis, dt: number, qp: number, qv: number): void {
  a.x += a.v * dt;
  const p00 = a.p00 + dt * (2 * a.p01 + dt * a.p11) + qp * dt;
  const p01 = a.p01 + dt * a.p11;
  a.p00 = p00;
  a.p01 = p01;
  a.p11 = a.p11 + qv * dt;
}

function correctAxis(a: Axis, z: number, r: number): void {
  const s = a.p00 + r;
  const k0 = a.p00 / s;
  const k1 = a.p01 / s;
  const y = z - a.x;
  a.x += k0 * y;
  a.v += k1 * y;
  const p00 = (1 - k0) * a.p00;
  const p01 = (1 - k0) * a.p01;
  const p11 = a.p11 - k1 * a.p01;
  a.p00 = p00;
  a.p01 = p01;
  a.p11 = p11;
}

interface InternalTrack {
  id: number;
  axes: [Axis, Axis, Axis, Axis]; // cx, cy, w, h
  score: number;
  label?: string;
  cls?: string;
  hits: number;
  lastSeenMs: number;
  matchedNow: boolean;
}

const toCenter = (b: Box): [number, number, number, number] => [b[0] + b[2] / 2, b[1] + b[3] / 2, b[2], b[3]];

function boxOf(t: InternalTrack): Box {
  const [cx, cy, w, h] = t.axes.map((a) => a.x);
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  return [cx - W / 2, cy - H / 2, W, H];
}

export function iou(a: Box, b: Box): number {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** Best-first matching on overlap: every (track, detection) pair above `minIoU`, highest first. */
export function matchByOverlap(tracks: Box[], dets: Box[], minIoU: number): [number, number][] {
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < tracks.length; i++) {
    for (let j = 0; j < dets.length; j++) {
      const o = iou(tracks[i], dets[j]);
      if (o >= minIoU) pairs.push([o, i, j]);
    }
  }
  pairs.sort((a, b) => b[0] - a[0]);
  const usedT = new Set<number>();
  const usedD = new Set<number>();
  const out: [number, number][] = [];
  for (const [, i, j] of pairs) {
    if (usedT.has(i) || usedD.has(j)) continue;
    usedT.add(i);
    usedD.add(j);
    out.push([i, j]);
  }
  return out;
}

export function createBoxTracker(params: TrackerParams = DEFAULT_TRACKER_PARAMS) {
  let tracks: InternalTrack[] = [];
  let nextId = 1;
  let lastMs: number | null = null;

  function update(detections: Detection[], nowMs: number): Track[] {
    const dt = lastMs == null ? 0 : Math.max(0, Math.min(2, (nowMs - lastMs) / 1000));
    lastMs = nowMs;
    // 1. Predict.
    for (const t of tracks) {
      const h = Math.max(8, t.axes[3].x);
      const qp = (params.qPos * h) ** 2;
      const qv = (params.qVel * h) ** 2;
      for (const a of t.axes) predictAxis(a, dt, qp, qv);
      t.matchedNow = false;
    }
    const dets = detections.filter((d) => d.score >= params.lowScore && d.bbox[2] > 0 && d.bbox[3] > 0);
    const high = dets.filter((d) => d.score >= params.highScore);
    const low = dets.filter((d) => d.score < params.highScore);

    const apply = (t: InternalTrack, d: Detection) => {
      const z = toCenter(d.bbox);
      const r = (params.rMeas * Math.max(8, z[3])) ** 2;
      t.axes.forEach((a, k) => correctAxis(a, z[k], r));
      t.hits += 1;
      t.score = d.score;
      t.label = d.label ?? t.label;
      t.cls = d.cls ?? t.cls;
      t.lastSeenMs = nowMs;
      t.matchedNow = true;
    };

    // 2. Confident detections against every track.
    const predicted = tracks.map(boxOf);
    const m1 = matchByOverlap(predicted, high.map((d) => d.bbox), params.matchIoU);
    const usedHigh = new Set<number>();
    for (const [i, j] of m1) {
      apply(tracks[i], high[j]);
      usedHigh.add(j);
    }
    // 3. Faint detections only keep the remaining existing tracks alive.
    const rest = tracks.map((t, i) => i).filter((i) => !tracks[i].matchedNow);
    const m2 = matchByOverlap(rest.map((i) => predicted[i]), low.map((d) => d.bbox), params.lowMatchIoU);
    for (const [ri, j] of m2) apply(tracks[rest[ri]], low[j]);

    // 4. New tracks from unmatched confident detections; drop tracks lost too long.
    high.forEach((d, j) => {
      if (usedHigh.has(j) || d.score < params.newTrackScore) return;
      const [cx, cy, w, h] = toCenter(d.bbox);
      const vp = (params.rMeas * h) ** 2;
      const vv = (params.qVel * h * 4) ** 2;
      tracks.push({
        id: nextId++,
        axes: [axis(cx, vp, vv), axis(cy, vp, vv), axis(w, vp, vv), axis(h, vp, vv)],
        score: d.score,
        label: d.label,
        cls: d.cls,
        hits: 1,
        lastSeenMs: nowMs,
        matchedNow: true,
      });
    });
    tracks = tracks.filter((t) => nowMs - t.lastSeenMs <= params.maxCoastMs);
    // Two tracks that have grown onto the same car: keep the older one.
    tracks.sort((a, b) => a.id - b.id);
    const kept: InternalTrack[] = [];
    for (const t of tracks) {
      const b = boxOf(t);
      if (!kept.some((k) => iou(boxOf(k), b) > 0.7)) kept.push(t);
    }
    tracks = kept;

    return tracks
      .filter((t) => t.hits >= params.minHits)
      .map((t) => ({
        id: t.id,
        bbox: boxOf(t),
        score: t.score,
        label: t.label,
        cls: t.cls,
        hits: t.hits,
        coasting: !t.matchedNow,
        velocity: [t.axes[0].v, t.axes[1].v] as [number, number],
      }));
  }

  return {
    update,
    reset() {
      tracks = [];
      lastMs = null;
    },
  };
}
