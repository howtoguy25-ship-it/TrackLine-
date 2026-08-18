import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { httpsCallable } from "@firebase/functions";
import { File } from "expo-file-system";
import { ImageManipulator } from "expo-image-manipulator";
import { db, functions } from "@/services/firebase";
import type { PlateRegion } from "@/utils/plateLocator";
import { Sentry } from "@/services/sentry";
import { readPlateText as readPlateTextOnDevice } from "@/services/plateOcr";

// Real, cloud OCR alternative to plateOcr.ts's on-device path, per explicit request to use
// Plate Recognizer (platerecognizer.com) specifically -- see recognizePlate in
// firebase/functions/index.js for the real endpoint/auth this calls. Only ever used when a real
// provider is actually connected (subscribePlateRecognizerProviderStatus below); unconfigured,
// readPlateTextSmart falls straight back to the existing on-device path unchanged, so this is
// never a hard requirement for plate reading to keep working. Real, confirmed privacy trade this
// makes when connected: the cropped plate image leaves the device for platerecognizer.com's own
// servers, unlike the on-device path (see app.config.js's NSCameraUsageDescription, updated to
// disclose this honestly).

export interface PlateRecognizerResult {
  outcome: "not_connected" | "error" | "success";
  message?: string;
  plate?: string | null;
  confidence?: number | null;
}

export function subscribePlateRecognizerProviderStatus(onChange: (enabled: boolean) => void): Unsubscribe {
  return onSnapshot(
    doc(db, "config", "plateRecognizerStatus"),
    (snap) => onChange(snap.exists() && snap.data()?.enabled === true),
    () => onChange(false)
  );
}

const recognizePlateCallable = httpsCallable<{ imageBase64: string }, PlateRecognizerResult>(functions, "recognizePlate");

// ArrayBuffer -> base64, no Node Buffer/atob dependency (neither is reliably available for
// binary data in this app's Hermes JS environment) -- a small, standard lookup-table encoder.
// Only ever run against a small cropped plate-region JPEG (tens of KB), not a full photo, so the
// plain-JS loop cost here is negligible.
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    result += b1 === undefined ? "=" : BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    result += b2 === undefined ? "=" : BASE64_CHARS[b2 & 0x3f];
  }
  return result;
}

export async function recognizePlateImage(imageBase64: string): Promise<PlateRecognizerResult> {
  try {
    const res = await recognizePlateCallable({ imageBase64 });
    return res.data;
  } catch (err) {
    return {
      outcome: "error",
      message: err instanceof Error ? err.message : "Couldn't reach the plate recognition service -- check your connection.",
    };
  }
}

// Drop-in replacement for plateOcr.ts's own readPlateText(photoUri, region) -- same signature,
// same crop-then-OCR shape, so VehicleDetectionScreen's own call site only ever needed to swap
// which function it calls, not restructure around a different return shape. `cloudConfigured`
// is passed in explicitly (not read from a hidden module-level subscription) so the caller's own
// already-established subscribeXProviderStatus + state pattern stays the single source of truth,
// matching how fuelCheckConfigured/plateLookupConfigured are threaded through their own screens.
export async function readPlateTextSmart(
  photoUri: string,
  region: PlateRegion,
  cloudConfigured: boolean
): Promise<string | null> {
  if (!cloudConfigured) return readPlateTextOnDevice(photoUri, region);

  const crop = {
    originX: Math.max(0, Math.round(region.x)),
    originY: Math.max(0, Math.round(region.y)),
    width: Math.max(1, Math.round(region.w)),
    height: Math.max(1, Math.round(region.h)),
  };
  const cropped = await ImageManipulator.manipulate(photoUri).crop(crop).renderAsync();
  const saved = await cropped.saveAsync();

  try {
    const buffer = await new File(saved.uri).arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const result = await recognizePlateImage(base64);
    if (result.outcome !== "success") {
      Sentry.logger.warn("plateRecognizer: cloud OCR unavailable, no fallback for this attempt", {
        outcome: result.outcome,
        message: result.message,
      });
      return null;
    }
    return result.plate ?? null;
  } finally {
    // Same cleanup discipline as plateOcr.ts's own on-device path -- this crop is a brand-new
    // temp file on every attempt, never left behind.
    try {
      new File(saved.uri).delete();
    } catch {}
  }
}
