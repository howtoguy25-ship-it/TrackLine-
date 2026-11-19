// Saved planned drives: users/{uid}/plannedDrives. The server (refreshPlannedDrives) re-checks
// each one's traffic 30 minutes before it's due and sends the reminder push, so drives live in
// Firestore rather than only on the phone.
import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
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

// "Tell me when to leave": stored on users/{uid} so the server's re-check push respects it too.
export async function getLeaveReminders(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data()?.plannedDriveReminders !== false : true;
}

export async function setLeaveReminders(uid: string, on: boolean): Promise<void> {
  await setDoc(doc(db, "users", uid), { plannedDriveReminders: on }, { merge: true });
}

/**
 * What the list says when it can't load or save. Never the raw Firebase text ("Missing or
 * insufficient permissions") -- that's for the log, with its code.
 */
export function plannedDrivesErrorText(action: "load" | "save" | "delete"): string {
  if (action === "save") return "Couldn't save your drive — check your connection and try again.";
  if (action === "delete") return "Couldn't delete that drive — try again.";
  return "Couldn't load your drives — tap to retry.";
}

/** Firebase's error code ("permission-denied", "unavailable"...), for the log. */
export function firebaseErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : err instanceof Error ? err.name : "unknown";
}
