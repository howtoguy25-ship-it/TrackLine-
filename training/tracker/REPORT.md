# Dashcam tracker training

What was trained: the 10 parameters of the new vehicle tracker (`src/detection/boxTracker.ts`:
constant-velocity Kalman filter + two-stage overlap matching). Not the detector: the detector is
still the shipping SSD MobileNet v2 (`assets/models/tflite_ssd_mobilenet_v2/model.tflite`).

## Data (real)

- **Video:** UA-DETRAC traffic-camera footage, via `huggingface.co/datasets/abhineet123/ua_detrac`
  (tagged CC-BY-4.0 there; the original UA-DETRAC release is for research use. Only the 10
  numbers below are kept, no frames or labels are in the repo).
- **Sampling:** 12 sequences × 100 frames, every 5th frame. That is 5 fps, the app's 200 ms
  detection cadence.
- **Totals:** 1,200 frames and 11,754 ground-truth vehicle boxes.
- **Detections:** produced by **this app's own detector** on those frames
  (`training/tracker/detect.py`, TFLite on CPU, 300×300 input like the app). That gave 18,629
  vehicle detections.
- **Split:** 8 sequences for training, 4 held out. All scores below are on the held-out 4,
  which the training never saw.

## Training

- **Script:** `npx tsx training/tracker/train.ts detections.json 300`.
- **Budget:** 300 s of wall clock on this container's CPU (no GPU, no cloud).
- **Search:** random search, then local refinement.
- **Objective:** MOTA + 0.25·MOTP − 0.002·jitter(px).

Two runs:

1. **Unconstrained** (10,000+ trials): it chose to show a box after 1 frame and drop it after
   0.2 s. That scores best on fixed traffic cameras. But it is exactly the one-frame ghost boxes
   and blinking boxes drivers reported, so it is **not shipped**. The record is in
   `REPORT-unconstrained.json` and `params-unconstrained.json`.
2. **Shipped**: the same 300 s, with product limits. A box needs at least 2 frames to appear and
   coasts at least 0.6 s. Its record is `REPORT.json`, and the numbers are in
   `src/detection/boxTrackerParams.json`.

## Results (held-out video)

| tracker | MOTA ↑ | false boxes ↓ | missed ↓ | id switches ↓ | box overlap (MOTP) ↑ | jitter px ↓ |
|---|---|---|---|---|---|---|
| shipped before (speedTracker matching) | −0.032 | 1,190 | 2,494 | 42 | 0.726 | 4.26 |
| new tracker, untrained defaults | 0.302 | 452 | 2,021 | 47 | 0.748 | 3.82 |
| new tracker, trained, unconstrained (not shipped) | 0.419 | 131 | 1,923 | 43 | 0.757 | 5.13 |
| **new tracker, trained, shipped** | **0.379** | **226** | **1,982** | **32** | **0.757** | 5.24 |

Honest limits:

- **Jitter:** frame-to-frame jitter is about 1 px worse than before, because the tracker now
  follows fast cars instead of lagging behind them.
- **Missed cars:** they are mostly small, distant vehicles a 300×300 detector cannot see at all.
  Only ground truth at least 40 px tall counts, and tracking cannot fix the detector.
- **Camera type:** UA-DETRAC is traffic cameras, not dashcams. Real dashcam behaviour needs the
  phone test (TEST_ON_PHONE §32).
