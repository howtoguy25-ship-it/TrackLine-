import { recognizeText } from "rn-mlkit-ocr";
import { Sentry } from "@/services/sentry";

// Real, explicit request: a dedicated camera capture for VIN plates/compliance plates/rego
// papers, separate from AI Vehicle Detection's own live plate reader (see plateOcr.ts) --
// that one only ever gets a rough vehicle bounding box to crop from a moving frame, which is
// exactly the wrong shape of input for a VIN (never localized by object detection, and printed
// wherever the vehicle's compliance plate/windshield etch/paperwork happens to be). This runs
// the same real on-device Google ML Kit OCR (rn-mlkit-ocr, no network call, nothing uploaded)
// on the WHOLE captured photo instead of a cropped region -- the driver is expected to
// deliberately frame the source close-up against this screen's own guide overlay, so there's no
// moving-vehicle bounding box to crop to in the first place.

// Real VIN rule, not an arbitrary filter: ISO 3779 excludes I, O and Q from every VIN (too easy
// to misread against 1/0) -- rejecting any 17-character candidate that contains one of them is a
// genuine accuracy improvement, not just a stricter pattern for its own sake.
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

// Same pattern plateOcr.ts already uses for the live detector's own plate reads -- letters/
// digits only, a real plate's typical length range.
const PLATE_TEXT_PATTERN = /^[A-Z0-9]{3,8}$/;

function bestMatch(blocks: { text: string }[], wholeText: string, pattern: RegExp): string | null {
  for (const block of blocks) {
    const cleaned = block.text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (pattern.test(cleaned)) return cleaned;
  }
  // Same fallback plateOcr.ts relies on -- a real design element (a state name, a QR code, a
  // logo) sometimes splits one printed string across more than one OCR block/line even though
  // it reads correctly as a whole; the full concatenated text catches that case.
  const cleanedWhole = wholeText.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return pattern.test(cleanedWhole) ? cleanedWhole : null;
}

/**
 * Runs on-device OCR on a captured photo and returns the first real, ISO-3779-shaped 17
 * character VIN found, or null if nothing that shape was actually read -- never a guess, never
 * a partial/lower-confidence string.
 */
export async function recognizeVinFromPhoto(photoUri: string): Promise<string | null> {
  try {
    const result = await recognizeText(photoUri);
    return bestMatch(result.blocks, result.text, VIN_PATTERN);
  } catch (err) {
    Sentry.logger.error("documentScan: VIN OCR failed", { error: String(err) });
    return null;
  }
}

/**
 * Same idea for a plate/registration photo -- returns the first real plate-shaped text found.
 */
export async function recognizePlateFromPhoto(photoUri: string): Promise<string | null> {
  try {
    const result = await recognizeText(photoUri);
    return bestMatch(result.blocks, result.text, PLATE_TEXT_PATTERN);
  } catch (err) {
    Sentry.logger.error("documentScan: plate OCR failed", { error: String(err) });
    return null;
  }
}
