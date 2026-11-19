// Trains the dashcam tracker's parameters (src/detection/boxTracker.ts) for a fixed wall-clock
// budget against real UA-DETRAC ground-truth tracks, using detections from TrackLine's own
// shipping detector on those frames (training/tracker/detect.py). Random search, then a local
// search around the best, on the training sequences; the held-out sequences are only scored at
// the end, so the reported improvement is on video the training never saw.
//
//   npx tsx training/tracker/train.ts <detections.json> [seconds=300]
//
// Writes src/detection/boxTrackerParams.json and training/tracker/REPORT.json.
import { readFileSync, writeFileSync } from "fs";
import { createBoxTracker, type TrackerParams } from "../../src/detection/boxTracker";
import { createSpeedTracker } from "../../src/utils/speedTracker";
import { score, type Frame, type RunTracker, type Scores, type Sequence } from "./metrics";

const [, , file, secondsArg] = process.argv;
const BUDGET_S = Number(secondsArg ?? 300);
const data = JSON.parse(readFileSync(file, "utf8")) as { sequences: Sequence[]; source: string; model: string };
const seqs = data.sequences;
const test = seqs.filter((_, i) => i % 3 === 2);
const train = seqs.filter((_, i) => i % 3 !== 2);

// The app's own gate before tracking (VehicleDetectionScreen: MIN_DETECTION_SCORE 0.3, then
// suppressOverlappingDetections at IoU 0.25, higher score kept).
const APP_MIN_SCORE = 0.3;
function appNms(dets: Frame["dets"]): Frame["dets"] {
  const sorted = dets.slice().sort((a, b) => b.score - a.score);
  const kept: Frame["dets"] = [];
  const io = (a: number[], b: number[]) => {
    const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
    const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
    const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    return i / (a[2] * a[3] + b[2] * b[3] - i);
  };
  for (const d of sorted) if (!kept.some((k) => io(k.bbox, d.bbox) > 0.25)) kept.push(d);
  return kept;
}

/** Before: the tracker the app shipped with (speedTracker's own matching and smoothing). */
const runOld: RunTracker = (frames) => {
  const tr = createSpeedTracker();
  return frames.map((f) =>
    tr.update(appNms(f.dets.filter((d) => d.score >= APP_MIN_SCORE)).map((d) => ({ bbox: d.bbox, score: d.score, label: d.cls })), 960, f.t).map((b) => ({ id: b.id, bbox: b.bbox }))
  );
};

const runNew = (p: TrackerParams): RunTracker => (frames) => {
  const tr = createBoxTracker(p);
  return frames.map((f) => tr.update(appNms(f.dets.filter((d) => d.score >= p.lowScore)), f.t).map((t) => ({ id: t.id, bbox: t.bbox })));
};

// MOTA first, then tighter boxes (MOTP), then steadier ones (less jitter, px).
const objective = (s: Scores) => s.mota + 0.25 * s.motp - 0.002 * s.jitter;

type Range = [number, number, boolean?]; // min, max, integer
const SPACE: Record<keyof TrackerParams, Range> = {
  highScore: [0.3, 0.7],
  lowScore: [0.1, 0.35],
  newTrackScore: [0.3, 0.8],
  matchIoU: [0.05, 0.5],
  lowMatchIoU: [0.05, 0.6],
  // Product limits, not tuned away: at least 2 frames before a box shows (no one-frame ghost
  // boxes) and at least 0.6 s of coasting (no box blinking off on one missed frame). A first,
  // unconstrained run chose 1 frame / 0.2 s -- better MOTA on fixed traffic cameras, but exactly
  // the two things drivers complained about (training/tracker/REPORT-unconstrained.json).
  minHits: [2, 4, true],
  maxCoastMs: [600, 2000, true],
  qPos: [0.005, 0.3],
  qVel: [0.02, 1.5],
  rMeas: [0.01, 0.3],
};
const keys = Object.keys(SPACE) as (keyof TrackerParams)[];
const clampP = (p: TrackerParams): TrackerParams => {
  const out = { ...p };
  for (const k of keys) {
    const [lo, hi, int] = SPACE[k];
    let v = Math.min(hi, Math.max(lo, out[k]));
    if (int) v = Math.round(v);
    out[k] = v;
  }
  if (out.lowScore > out.highScore) out.lowScore = out.highScore;
  return out;
};
const randomP = (): TrackerParams => clampP(Object.fromEntries(keys.map((k) => [k, SPACE[k][0] + Math.random() * (SPACE[k][1] - SPACE[k][0])])) as unknown as TrackerParams);
const nudge = (p: TrackerParams, scale: number): TrackerParams =>
  clampP(Object.fromEntries(keys.map((k) => [k, p[k] + (Math.random() * 2 - 1) * scale * (SPACE[k][1] - SPACE[k][0])])) as unknown as TrackerParams);

const start = JSON.parse(readFileSync("src/detection/boxTrackerParams.json", "utf8")).params as TrackerParams;
let best = start;
let bestScore = objective(score(train, runNew(best)));
const t0 = Date.now();
let evals = 1;
const log: { s: number; objective: number }[] = [];
while ((Date.now() - t0) / 1000 < BUDGET_S) {
  const elapsed = (Date.now() - t0) / 1000;
  // First third: explore; then refine around the best with a shrinking step.
  const cand = elapsed < BUDGET_S / 3 && Math.random() < 0.6 ? randomP() : nudge(best, 0.25 * (1 - elapsed / BUDGET_S) + 0.02);
  const s = objective(score(train, runNew(cand)));
  evals++;
  if (s > bestScore) {
    best = cand;
    bestScore = s;
    log.push({ s: Math.round(elapsed), objective: +s.toFixed(4) });
    console.log(`${elapsed.toFixed(0)}s  eval ${evals}  objective ${s.toFixed(4)}`);
  }
}
const round = (p: TrackerParams) => Object.fromEntries(keys.map((k) => [k, SPACE[k][2] ? p[k] : +p[k].toFixed(4)])) as unknown as TrackerParams;
best = round(best);
const fmt = (s: Scores) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v.toFixed(4)]));
const report = {
  source: data.source,
  detector: data.model,
  trainedSeconds: Math.round((Date.now() - t0) / 1000),
  evaluations: evals,
  trainSequences: train.map((s) => s.seq),
  testSequences: test.map((s) => s.seq),
  frames: { train: train.reduce((n, s) => n + s.frames.length, 0), test: test.reduce((n, s) => n + s.frames.length, 0) },
  heldOut: { before_shippedTracker: fmt(score(test, runOld)), after_untrainedNewTracker: fmt(score(test, runNew(start))), after_trained: fmt(score(test, runNew(best))) },
  train: { before_shippedTracker: fmt(score(train, runOld)), after_trained: fmt(score(train, runNew(best))) },
  params: best,
  progress: log,
};
writeFileSync("src/detection/boxTrackerParams.json", JSON.stringify({ note: "Trained by training/tracker/train.ts; see training/tracker/REPORT.json.", params: best }, null, 2) + "\n");
writeFileSync("training/tracker/REPORT.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.heldOut, null, 2));
