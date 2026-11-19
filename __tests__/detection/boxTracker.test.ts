// The dashcam tracker (src/detection/boxTracker.ts): steady boxes that follow a moving car without
// lag, no blink on a missed frame, no box from a one-frame false hit, no id swap when two cars
// pass, a faint detection keeps a track alive but can't start one.
import { describe, expect, it } from "@jest/globals";
import { createBoxTracker, iou, matchByOverlap, DEFAULT_TRACKER_PARAMS, type Box, type TrackerParams } from "@/detection/boxTracker";
import { estimateDistanceM, VEHICLE_WIDTH_M } from "@/utils/speedTracker";
import trained from "@/detection/boxTrackerParams.json";

const P: TrackerParams = { ...DEFAULT_TRACKER_PARAMS, minHits: 2, maxCoastMs: 900, highScore: 0.5, lowScore: 0.15, newTrackScore: 0.5, matchIoU: 0.2, lowMatchIoU: 0.2 };
const car = (x: number, y = 200, w = 120, h = 80): Box => [x, y, w, h];

describe("boxTracker", () => {
  it("a car seen once is not shown (a one-frame false hit makes no box)", () => {
    const t = createBoxTracker(P);
    expect(t.update([{ bbox: car(100), score: 0.9 }], 0)).toHaveLength(0);
    expect(t.update([], 200)).toHaveLength(0);
  });

  it("keeps one id on a car moving across the frame, and keeps up with it", () => {
    const t = createBoxTracker(P);
    let out: ReturnType<typeof t.update> = [];
    for (let k = 0; k < 15; k++) out = t.update([{ bbox: car(100 + k * 30), score: 0.8 }], k * 200);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
    // It has learned the car's speed (30 px per 200 ms = 150 px/s) and sits on it, not behind it.
    expect(out[0].velocity[0]).toBeGreaterThan(100);
    expect(iou(out[0].bbox, car(100 + 14 * 30))).toBeGreaterThan(0.8);
  });

  it("rides out a missed frame on its prediction, then drops the track after maxCoastMs", () => {
    const t = createBoxTracker(P);
    for (let k = 0; k < 5; k++) t.update([{ bbox: car(100 + k * 20), score: 0.8 }], k * 200);
    const miss = t.update([], 1000);
    expect(miss).toHaveLength(1);
    expect(miss[0].coasting).toBe(true);
    expect(miss[0].bbox[0]).toBeGreaterThan(180); // moved on, not frozen
    expect(t.update([], 2000)).toHaveLength(0);
  });

  it("a faint detection keeps a track alive but never starts one", () => {
    const t = createBoxTracker(P);
    for (let k = 0; k < 3; k++) t.update([{ bbox: car(100), score: 0.8 }], k * 200);
    const faint = t.update([{ bbox: car(102), score: 0.2 }], 600);
    expect(faint[0].coasting).toBe(false);
    const t2 = createBoxTracker(P);
    for (let k = 0; k < 5; k++) expect(t2.update([{ bbox: car(100), score: 0.2 }], k * 200)).toHaveLength(0);
  });

  it("two cars passing each other keep their own ids", () => {
    const t = createBoxTracker(P);
    let out: ReturnType<typeof t.update> = [];
    for (let k = 0; k < 12; k++) {
      out = t.update(
        [
          { bbox: car(100 + k * 25, 200), score: 0.8 },
          { bbox: car(500 - k * 25, 240), score: 0.8 },
        ],
        k * 200
      );
    }
    const left = out.find((o) => o.velocity[0] > 0)!;
    const right = out.find((o) => o.velocity[0] < 0)!;
    expect(left.id).toBe(1);
    expect(right.id).toBe(2);
  });

  it("matches best pairs first, not first-come-first-served", () => {
    // Track 0 overlaps detection 0 a little and detection 1 a lot; track 1 only overlaps det 0.
    const m = matchByOverlap([[0, 0, 100, 100], [60, 0, 100, 100]], [[50, 0, 100, 100], [5, 0, 100, 100]], 0.1);
    expect(m).toEqual(expect.arrayContaining([[0, 1], [1, 0]]));
  });

  it("ships the trained parameters, with a record of the training", () => {
    expect(trained.note).toMatch(/Trained by training\/tracker\/train\.ts/);
    const report = require("../../training/tracker/REPORT.json");
    expect(report.trainedSeconds).toBeGreaterThanOrEqual(290);
    expect(report.params).toEqual(trained.params);
    expect(report.source).toMatch(/UA-DETRAC/);
    // Product limits the training was not allowed to tune away: no one-frame ghost boxes, no blinking.
    expect(trained.params.minHits).toBeGreaterThanOrEqual(2);
    expect(trained.params.maxCoastMs).toBeGreaterThanOrEqual(600);
    // On video it never trained on, it beats the tracker it replaces.
    expect(report.heldOut.after_trained.mota).toBeGreaterThan(report.heldOut.before_shippedTracker.mota);
    expect(report.heldOut.after_trained.fp).toBeLessThan(report.heldOut.before_shippedTracker.fp);
  });
});

describe("distance uses the vehicle's real width", () => {
  it("a bus box the same size as a car's is further away; a motorbike's is closer", () => {
    const car = estimateDistanceM(100, 1000, 1, "car");
    expect(estimateDistanceM(100, 1000, 1, "bus") / car).toBeCloseTo(VEHICLE_WIDTH_M.bus / VEHICLE_WIDTH_M.car, 5);
    expect(estimateDistanceM(100, 1000, 1, "motorcycle")).toBeLessThan(car);
    expect(estimateDistanceM(100, 1000, 1)).toBe(car);
  });
});
