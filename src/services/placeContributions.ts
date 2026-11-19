import { addDoc, collection, doc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import * as ImageManipulator from "expo-image-manipulator";
import * as Crypto from "expo-crypto";
import { db, storage } from "@/services/firebase";
import type { PlaceDetails } from "@/services/places";

// What drivers add to a place page: their own photos, and "this place is wrong" reports.
//
// Photos are moderated. An upload writes the image to the uploader's own folder in Storage and
// a `placePhotos` document with status "pending". Nothing is shown to anyone else until that
// status is set to "approved" -- which only the project owner can do (firestore.rules), e.g. from
// the Firebase console. Pending and rejected photos are never listed for other drivers.

const MAX_EDGE = 1600;

export interface ApprovedPlacePhoto {
  id: string;
  url: string;
}

/** Shrinks, uploads and files a photo for review. Throws if anything fails. */
export async function submitPlacePhoto(uid: string, placeId: string, localUri: string): Promise<void> {
  // Re-encoded as a JPEG no larger than 1600px: smaller to store and send, and it drops whatever
  // location and camera metadata the original carried.
  const resized = await ImageManipulator.manipulateAsync(localUri, [{ resize: { width: MAX_EDGE } }], {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const photoId = Crypto.randomUUID();
  const storagePath = `placePhotos/${uid}/${photoId}.jpg`;
  // The review document goes first: the Storage rules only accept an upload that has one.
  await setDoc(doc(db, "placePhotos", photoId), {
    placeId,
    uploaderUid: uid,
    storagePath,
    status: "pending",
    createdAt: serverTimestamp(),
  });
  const blob = await (await fetch(resized.uri)).blob();
  await uploadBytes(ref(storage, storagePath), blob, { contentType: "image/jpeg" });
}

/** Approved driver photos for a place. An empty list if there are none or they can't be read. */
export async function getApprovedPlacePhotos(placeId: string): Promise<ApprovedPlacePhoto[]> {
  try {
    const snap = await getDocs(
      query(collection(db, "placePhotos"), where("placeId", "==", placeId), where("status", "==", "approved"))
    );
    const photos = await Promise.all(
      snap.docs.map(async (d) => {
        try {
          return { id: d.id, url: await getDownloadURL(ref(storage, d.data().storagePath as string)) };
        } catch {
          return null;
        }
      })
    );
    return photos.filter((p): p is ApprovedPlacePhoto => p !== null);
  } catch {
    return [];
  }
}

export type PlaceReportReason = "wrong_location" | "closed" | "wrong_name" | "other";

/** "This place is wrong": stored for the project owner to look at (admin-only reads). */
export async function reportPlace(uid: string, place: PlaceDetails, reason: PlaceReportReason): Promise<void> {
  await addDoc(collection(db, "placeReports"), {
    reportedBy: uid,
    placeId: place.placeId,
    name: place.name.slice(0, 200),
    address: place.address.slice(0, 300),
    lat: place.location.latitude,
    lng: place.location.longitude,
    reason,
    createdAt: serverTimestamp(),
  });
}
