// Crash history near the driver: the server's crashRecords (Live Traffic NSW crashes and
// confirmed driver crash reports, 3 years), read by map cell. firestore.rules: signed-in read.
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "@/services/firebase";
import { encodeGeohash } from "@/utils/geo";

export interface CrashRecord {
  id: string;
  lat: number;
  lng: number;
}

/** Records in the ~5 km cell around a point (geohash precision 5). */
export async function fetchCrashRecordsNear(latitude: number, longitude: number): Promise<CrashRecord[]> {
  const cell = encodeGeohash(latitude, longitude, 5);
  const snap = await getDocs(query(collection(db, "crashRecords"), where("geohash", ">=", cell), where("geohash", "<", `${cell}~`), limit(500)));
  const now = Date.now();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as { lat: number; lng: number; expiresAt?: { toMillis(): number } }) }))
    .filter((r) => typeof r.lat === "number" && typeof r.lng === "number" && (!r.expiresAt || r.expiresAt.toMillis() > now))
    .map((r) => ({ id: r.id, lat: r.lat, lng: r.lng }));
}
