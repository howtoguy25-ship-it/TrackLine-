import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Directory, File, Paths } from "expo-file-system";
import { Sentry } from "@/services/sentry";

// Real, explicit request: a saved thumbnail per history entry. Deliberately small -- this is a
// list-row thumbnail (see VehicleHistoryScreen), not a full-resolution photo -- so a long
// driving session's worth of saved vehicles doesn't quietly eat meaningful device storage.
const THUMBNAIL_WIDTH = 240;
const THUMBNAIL_DIR_NAME = "vehicleThumbnails";

// Paths.document (not Paths.cache) -- per expo-file-system's own docs, cache "can be deleted by
// the system when the device runs low on storage" at any time, which is exactly wrong for
// something meant to persist as part of a driver's saved vehicle history across sessions, same
// durability expectation as the AsyncStorage entry it's attached to.
function thumbnailDirectory(): Directory {
  const dir = new Directory(Paths.document, THUMBNAIL_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Crops the real vehicle region out of an already-captured photo -- the same still photo
 * captureForPlateAndLightbar (VehicleDetectionScreen) already took for plate OCR, so this adds
 * no extra camera capture of its own -- and saves a small, persistent JPEG alongside the rest of
 * this app's on-device history data. bboxInPhotoSpace must already be in the SAME raw pixel
 * space as photoUri itself (i.e. already run through mapUprightBoxToRawPhoto, same as the plate
 * crop region is -- see captureForPlateAndLightbar's own comment on why that mapping exists).
 * Returns null (never throws) on any failure -- a missing thumbnail is a cosmetic gap in a
 * history row, never a reason to fail the real history save it's attached to.
 */
export async function saveVehicleThumbnail(
  photoUri: string,
  bboxInPhotoSpace: [number, number, number, number],
  fileNameHint: string
): Promise<string | null> {
  try {
    const [x, y, w, h] = bboxInPhotoSpace;
    const crop = {
      originX: Math.max(0, Math.round(x)),
      originY: Math.max(0, Math.round(y)),
      width: Math.max(1, Math.round(w)),
      height: Math.max(1, Math.round(h)),
    };
    const manipulated = await ImageManipulator.manipulate(photoUri)
      .crop(crop)
      .resize({ width: THUMBNAIL_WIDTH })
      .renderAsync();
    // ImageManipulator's own saveAsync always writes into the OS cache directory (see its own
    // JSDoc) -- moved into thumbnailDirectory() (Paths.document) right after, since that temp
    // cache copy is exactly the kind of file the OS can silently reclaim under storage pressure.
    const saved = await manipulated.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
    const dest = new File(thumbnailDirectory(), `${fileNameHint}-${Date.now()}.jpg`);
    await new File(saved.uri).move(dest);
    return dest.uri;
  } catch (err) {
    Sentry.logger.error("vehicleThumbnail: save failed", { error: String(err) });
    return null;
  }
}

// Best-effort cleanup -- called whenever a history entry that owned a thumbnail is deleted or
// overwritten with a fresh one, so re-sightings of the same vehicle (upsertDetectedVehicle
// updates the SAME entry, not a new one) don't silently accumulate orphaned JPEGs on disk
// forever. Never throws -- a failed delete here is a harmless leaked file, not a reason to fail
// the real history mutation it's cleaning up after.
export function deleteVehicleThumbnail(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {}
}
