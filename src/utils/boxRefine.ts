// Real, explicit request (repeated screenshot evidence: a tracked box's edge sitting well past
// the real vehicle, out into adjacent foliage/fence) -- the raw SSD MobileNet v2 model's own box
// regression is what actually produces this; nothing this app's own post-processing does can
// know the real vehicle's true edges from the box coordinates alone. This uses the ONE place in
// the whole pipeline real decoded pixel data is already available in JS: the side loop's own
// lightbar-sampling photo (see VehicleDetectionScreen.tsx's captureForPlateAndLightbar), already
// fetched every ~1s regardless, at a small fixed resolution cheap enough to also scan here
// without adding real cost to the fast ~200ms detection loop.
//
// Deliberately conservative, not a general-purpose CV algorithm: this only ever TRIMS a box
// inward, capped to a modest maximum per side, and only when it finds a real, sustained color
// shift near an edge -- if nothing clearly differs from the box's own center content, it leaves
// the box untouched rather than guessing. A car body is usually one fairly continuous painted/
// glass surface; foliage and fencing are visually busier and read as a real, sustained color
// shift away from that. This can occasionally be wrong (an unusually two-toned or heavily
// reflective vehicle), which is exactly why the trim is capped and additive-only, applied at
// render time on top of the raw detection -- it never touches the box fed to distance/speed
// math (see its own call site's comment), so a bad read here can only ever make the visible box
// too tight by a bounded amount, never corrupt tracking or speed.

export interface DecodedPhotoLike {
  width: number;
  height: number;
  // Raw RGB pixel data, 3 bytes per pixel, row-major -- exactly what
  // services/vehicleDetection.ts's decodePhotoForDetection/decodePhotoForLightbarSampling
  // already decode via jpeg-js.
  data: Uint8Array;
}

export interface BoxTrim {
  // Fraction (0-MAX_TRIM_FRACTION) of the box's own width/height to trim off each side.
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Never trim more than this off any single side -- bounds how wrong a single bad read can make
// the displayed box, regardless of what the color-difference scan below thinks it found.
const MAX_TRIM_FRACTION = 0.3;
// How many evenly-spaced sample strips to scan across the box's width (for left/right trimming)
// and height (for top/bottom) -- enough resolution to find a real edge without scanning every
// pixel of what's still only a ~1s-cadence side loop, not the fast detection path.
const SAMPLE_COUNT = 24;
// The middle fraction of samples assumed to be real vehicle content, used as the reference color
// everything else is compared against -- the raw detection box is presumably roughly centered on
// the real vehicle even when it overshoots on one or more sides, so its own center is a more
// reliable "this is the vehicle" reference than any fixed assumption about vehicle color.
const CENTER_BAND_FRACTION = 0.34;
// Per-channel-scale Euclidean color distance beyond which a sample is considered "different from
// the vehicle" -- real photos have enough compression/lighting noise that this needs real margin,
// not a hair-trigger on a small lighting gradient across a single body panel.
const COLOR_DIFF_THRESHOLD = 42;
// Consecutive differing samples required, walking in from an edge, before that point is trusted
// as a real content boundary rather than one noisy sample -- same "sustained, not a single
// reading" principle speedTracker.ts already uses for its own parked-state detection.
const SUSTAINED_RUN = 2;
// Boxes smaller than this (in the lightbar-sampling photo's own resolution) don't have enough
// real pixel detail across SAMPLE_COUNT strips to trust any of this -- skipped entirely rather
// than scanning noise.
const MIN_CROP_PX = 24;

function sampleAverageColor(
  photo: DecodedPhotoLike,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number
): [number, number, number] {
  const x0 = Math.max(0, Math.floor(xStart));
  const x1 = Math.min(photo.width, Math.ceil(xEnd));
  const y0 = Math.max(0, Math.floor(yStart));
  const y1 = Math.min(photo.height, Math.ceil(yEnd));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  // Every 3rd pixel in each direction -- plenty for a real average at this crop size, without
  // scanning every single pixel of what can still be a few thousand of them per strip.
  const step = 3;
  for (let y = y0; y < y1; y += step) {
    let rowOffset = (y * photo.width + x0) * 3;
    for (let x = x0; x < x1; x += step) {
      r += photo.data[rowOffset];
      g += photo.data[rowOffset + 1];
      b += photo.data[rowOffset + 2];
      count++;
      rowOffset += 3 * step;
    }
  }
  if (count === 0) return [0, 0, 0];
  return [r / count, g / count, b / count];
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Walks samples[0..reference index) inward (or the mirrored outward walk for the trailing edge)
// looking for where a SUSTAINED run of "different from reference" samples gives way to samples
// that match it again -- that's trusted as the real content boundary. Returns a trim fraction
// (0-MAX_TRIM_FRACTION), 0 if nothing that clear was found.
function findTrimFraction(samples: [number, number, number][], reference: [number, number, number]): number {
  let runStart = -1;
  let runLength = 0;
  for (let i = 0; i < samples.length; i++) {
    const isDifferent = colorDistance(samples[i], reference) > COLOR_DIFF_THRESHOLD;
    if (isDifferent) {
      if (runStart === -1) runStart = i;
      runLength++;
    } else if (runLength >= SUSTAINED_RUN) {
      // A real, sustained differing run just ended at index i -- trim everything up to here.
      return Math.min(MAX_TRIM_FRACTION, i / samples.length);
    } else {
      runStart = -1;
      runLength = 0;
    }
  }
  return 0;
}

/**
 * Scans a tracked box's own crop in an already-decoded photo for a real color-content boundary
 * near each edge, and returns how much (if anything) to trim inward -- see this file's own
 * header for the full reasoning and safety bounds. Returns null when the crop is too small to
 * trust, or when the photo doesn't cover it at all; never throws.
 */
export function refineBoxTrim(
  photo: DecodedPhotoLike,
  bbox: [number, number, number, number]
): BoxTrim | null {
  const [bx, by, bw, bh] = bbox;
  if (bw < MIN_CROP_PX || bh < MIN_CROP_PX) return null;
  if (bx + bw <= 0 || by + bh <= 0 || bx >= photo.width || by >= photo.height) return null;

  try {
    const colStrips: [number, number, number][] = [];
    const stripHeight = bh / 6;
    const centerY = by + bh / 2;
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const x = bx + ((i + 0.5) / SAMPLE_COUNT) * bw;
      colStrips.push(sampleAverageColor(photo, x - bw / (SAMPLE_COUNT * 2), x + bw / (SAMPLE_COUNT * 2), centerY - stripHeight / 2, centerY + stripHeight / 2));
    }
    const rowStrips: [number, number, number][] = [];
    const stripWidth = bw / 6;
    const centerX = bx + bw / 2;
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const y = by + ((i + 0.5) / SAMPLE_COUNT) * bh;
      rowStrips.push(sampleAverageColor(photo, centerX - stripWidth / 2, centerX + stripWidth / 2, y - bh / (SAMPLE_COUNT * 2), y + bh / (SAMPLE_COUNT * 2)));
    }

    const centerLo = Math.floor(SAMPLE_COUNT * (0.5 - CENTER_BAND_FRACTION / 2));
    const centerHi = Math.ceil(SAMPLE_COUNT * (0.5 + CENTER_BAND_FRACTION / 2));

    function centerReference(samples: [number, number, number][]): [number, number, number] {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = centerLo; i < centerHi; i++) {
        r += samples[i][0];
        g += samples[i][1];
        b += samples[i][2];
        count++;
      }
      return count > 0 ? [r / count, g / count, b / count] : samples[Math.floor(SAMPLE_COUNT / 2)];
    }

    const colReference = centerReference(colStrips);
    const rowReference = centerReference(rowStrips);

    const left = findTrimFraction(colStrips, colReference);
    const right = findTrimFraction([...colStrips].reverse(), colReference);
    const top = findTrimFraction(rowStrips, rowReference);
    const bottom = findTrimFraction([...rowStrips].reverse(), rowReference);

    if (left === 0 && right === 0 && top === 0 && bottom === 0) return null;
    return { left, right, top, bottom };
  } catch {
    // Never lets a refinement failure take down the real side-capture cycle it's riding along
    // with -- worst case, this tick's box just stays untrimmed, same as before this existed.
    return null;
  }
}
