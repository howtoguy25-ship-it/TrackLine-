// Saved planned drives: users/{uid}/plannedDrives. The server (refreshPlannedDrives) re-checks
// each one's traffic 30 minutes before it's due and sends the reminder push, so drives live in
// Firestore rather than only on the phone.
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/services/firebase";
import type { PlannedDrive } from "@/travel/plannedDrives";

const drivesOf = (uid: string) => collection(db, "users", uid, "plannedDrives");

export function watchPlannedDrives(uid: string, onDrives: (drives: PlannedDrive[]) => void, onError: (err: Error) => void): () => void {
  return onSnapshot(
    query(drivesOf(uid), orderBy("leaveAtMs")),
    (snap) => onDrives(snap.docs.map((d) => ({ ...(d.data() as Omit<PlannedDrive, "id">), id: d.id }))),
    (err) => onError(err)
  );
}

export async function savePlannedDrive(uid: string, drive: Omit<PlannedDrive, "id">): Promise<string> {
  const ref = await addDoc(drivesOf(uid), { ...drive, recheckedAt: null, reminded: false });
  return ref.id;
}

export async function deletePlannedDrive(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(db, "users", uid, "plannedDrives", id));
}
