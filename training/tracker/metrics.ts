// CLEAR-MOT style scoring of a tracker against real ground-truth vehicle tracks (UA-DETRAC):
// per frame, tracker boxes are matched to ground-truth boxes (IoU >= 0.5, best pairs first);
// misses (FN), false boxes (FP) and identity switches (IDSW: a ground-truth car whose track id
// changed) are counted. MOTA = 1 - (FN + FP + IDSW) / ground-truth boxes. MOTP = mean IoU of the
// matches (how tight the boxes sit). Ground truth too small for a 300x300 detector to see
// (< MIN_GT_HEIGHT px tall at 960x540) and the dataset's "ignored" regions are don't-care: a
// tracker box on them is neither a hit nor a false box.
import { iou, matchByOverlap, type Box } from "../../src/detection/boxTracker";

export const MIN_GT_HEIGHT = 40;

export interface Frame {
  t: number;
  dets: { bbox: Box; score: number; cls: string }[];
  gt: { bbox: Box; id: number }[];
  ignore: Box[];
}
export interface Sequence {
  seq: string;
  width: number;
  height: number;
  frames: Frame[];
}
export interface Scores {
  gt: number;
  fn: number;
  fp: number;
  idsw: number;
  mota: number;
  motp: number;
  /** Mean frame-to-frame jump of a matched box's centre beyond the car's own motion, px. */
  jitter: number;
}

const ioa = (a: Box, region: Box) => {
  const x0 = Math.max(a[0], region[0]);
  const y0 = Math.max(a[1], region[1]);
  const x1 = Math.min(a[0] + a[2], region[0] + region[2]);
  const y1 = Math.min(a[1] + a[3], region[1] + region[3]);
  return (Math.max(0, x1 - x0) * Math.max(0, y1 - y0)) / Math.max(1, a[2] * a[3]);
};

export type RunTracker = (frames: Frame[]) => { id: number; bbox: Box }[][];

export function score(seqs: Sequence[], run: RunTracker): Scores {
  let gtN = 0, fn = 0, fp = 0, idsw = 0, iouSum = 0, matches = 0, jitterSum = 0, jitterN = 0;
  for (const s of seqs) {
    const out = run(s.frames);
    const lastId = new Map<number, number>();
    const lastOffset = new Map<number, [number, number]>();
    s.frames.forEach((f, k) => {
      const big = f.gt.filter((g) => g.bbox[3] >= MIN_GT_HEIGHT);
      const small = f.gt.filter((g) => g.bbox[3] < MIN_GT_HEIGHT).map((g) => g.bbox);
      const tracks = out[k] ?? [];
      const m = matchByOverlap(big.map((g) => g.bbox), tracks.map((t) => t.bbox), 0.5);
      const usedT = new Set(m.map(([, j]) => j));
      gtN += big.length;
      fn += big.length - m.length;
      for (const [i, j] of m) {
        const g = big[i];
        const t = tracks[j];
        iouSum += iou(g.bbox, t.bbox);
        matches++;
        const prev = lastId.get(g.id);
        if (prev != null && prev !== t.id) idsw++;
        lastId.set(g.id, t.id);
        const off: [number, number] = [t.bbox[0] + t.bbox[2] / 2 - (g.bbox[0] + g.bbox[2] / 2), t.bbox[1] + t.bbox[3] / 2 - (g.bbox[1] + g.bbox[3] / 2)];
        const po = lastOffset.get(g.id);
        if (po) {
          jitterSum += Math.hypot(off[0] - po[0], off[1] - po[1]);
          jitterN++;
        }
        lastOffset.set(g.id, off);
      }
      tracks.forEach((t, j) => {
        if (usedT.has(j)) return;
        const dontCare = small.some((b) => iou(b, t.bbox) >= 0.3) || f.ignore.some((r) => ioa(t.bbox, r) >= 0.5) || big.some((g) => iou(g.bbox, t.bbox) >= 0.3) || t.bbox[3] < MIN_GT_HEIGHT * 0.7;
        if (!dontCare) fp++;
      });
    });
  }
  return {
    gt: gtN,
    fn,
    fp,
    idsw,
    mota: gtN ? 1 - (fn + fp + idsw) / gtN : 0,
    motp: matches ? iouSum / matches : 0,
    jitter: jitterN ? jitterSum / jitterN : 0,
  };
}
