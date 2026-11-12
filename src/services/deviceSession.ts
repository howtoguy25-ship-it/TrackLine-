import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { Platform } from "react-native";
import { db } from "@/services/firebase";

// Real install/activity tracking for the Owner Dashboard -- one doc per device, written by
// EVERY session (the app's default anonymous one included, see firebase.ts's ensureSignedIn),
// unlike users/{uid} (services/userProfile.ts) which only ever gets a doc for a real sign-in.
// This is the one place "how many people have actually installed this app" and "how many are
// using it right now" can be answered honestly -- an anonymous driver who never signs in is
// still a real install and a real active user, and previously showed up nowhere at all.
const COLLECTION = "deviceSessions";

// Heartbeat calls (see touchDeviceSessionActivity) happen far more often than a genuine new
// piece of information arrives -- throttling the actual Firestore write client-side keeps this
// a real, low-cost background habit rather than a write on every AppState flicker.
const MIN_HEARTBEAT_INTERVAL_MS = 60 * 1000;
let lastHeartbeatAt = 0;

/** Called once per app session (see AuthContext) -- records this device's first-ever open (if
 *  this is genuinely the first time) and refreshes its "last active" timestamp immediately. */
export async function ensureDeviceSession(uid: string, isAnonymous: boolean): Promise<void> {
  const ref = doc(db, COLLECTION, uid);
  const snap = await getDoc(ref);
  await setDoc(
    ref,
    {
      platform: Platform.OS,
      isAnonymous,
      lastActiveAt: serverTimestamp(),
      ...(snap.exists() ? {} : { firstOpenAt: serverTimestamp() }),
    },
    { merge: true }
  );
  lastHeartbeatAt = Date.now();
}

/** Cheap, frequent-safe heartbeat -- call from an AppState "active" listener while the app is
 *  in the foreground. Real, not simulated: "active now" on the Owner Dashboard is defined as
 *  "this device's lastActiveAt is within the last few minutes," so this write is what actually
 *  keeps that number honest for as long as a driver keeps the app open. */
export async function touchDeviceSessionActivity(uid: string): Promise<void> {
  const now = Date.now();
  if (now - lastHeartbeatAt < MIN_HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeatAt = now;
  await setDoc(doc(db, COLLECTION, uid), { lastActiveAt: serverTimestamp() }, { merge: true });
}

/** Stores this device's real Expo push token once notification permission is granted (see
 *  pushNotifications.ts) -- the ONLY thing broadcastNotification (firebase/functions/index.js)
 *  reads to know who to actually send to. A device that never grants permission simply never
 *  gets this field set, and is correctly excluded from every broadcast rather than sent a
 *  guaranteed-to-fail push. */
export async function saveExpoPushToken(uid: string, token: string): Promise<void> {
  await setDoc(doc(db, COLLECTION, uid), { expoPushToken: token }, { merge: true });
}
