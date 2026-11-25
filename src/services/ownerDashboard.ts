import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getCountFromServer,
  Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "@firebase/functions";
import { db, functions } from "@/services/firebase";

// Real, owner-only usage stats -- every number here comes from a live Firestore read against
// deviceSessions/users (see deviceSession.ts/userProfile.ts for what actually writes those
// collections), never a hardcoded or estimated figure. Firestore's count aggregation
// (getCountFromServer) counts server-side without downloading every matching document, so this
// stays cheap even as the real install base grows.
export interface OwnerStats {
  totalInstalls: number;
  activeNow: number;
  loggedInAccounts: number;
}

// A device counts as "active now" if it's had a real heartbeat (see deviceSession.ts's
// touchDeviceSessionActivity, fired from an AppState "active" listener) within this window --
// long enough that a driver glancing away from the app for a minute doesn't drop off the count,
// short enough that this stays a genuine "right now," not "at some point today."
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

export async function fetchOwnerStats(): Promise<OwnerStats> {
  const deviceSessions = collection(db, "deviceSessions");
  const activeSince = Timestamp.fromMillis(Date.now() - ACTIVE_WINDOW_MS);

  const [installsSnap, activeSnap, usersSnap] = await Promise.all([
    getCountFromServer(deviceSessions),
    getCountFromServer(query(deviceSessions, where("lastActiveAt", ">=", activeSince))),
    getCountFromServer(collection(db, "users")),
  ]);

  return {
    totalInstalls: installsSnap.data().count,
    activeNow: activeSnap.data().count,
    loggedInAccounts: usersSnap.data().count,
  };
}

export interface BroadcastHistoryEntry {
  id: string;
  title: string;
  body: string;
  sentBy: string;
  sentAt: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
}

function formatTimestamp(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in (value as any)) {
    return (value as Timestamp).toDate().toLocaleString();
  }
  return "just now";
}

/** Real send history -- populated only by broadcastNotification (firebase/functions/index.js)
 *  after a send actually completes, never by this client (firestore.rules blocks any client
 *  write to broadcasts/*). Lets the owner see real past sends, not just the most recent one. */
export async function fetchBroadcastHistory(): Promise<BroadcastHistoryEntry[]> {
  const snap = await getDocs(query(collection(db, "broadcasts"), orderBy("sentAt", "desc"), limit(20)));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title ?? "",
      body: data.body ?? "",
      sentBy: data.sentBy ?? "unknown",
      sentAt: formatTimestamp(data.sentAt),
      recipientCount: data.recipientCount ?? 0,
      sentCount: data.sentCount ?? 0,
      failedCount: data.failedCount ?? 0,
    };
  });
}

export interface BroadcastResult {
  outcome: "success" | "error";
  message: string;
  sentCount?: number;
  failedCount?: number;
}

const broadcastNotificationCallable = httpsCallable<{ title: string; body: string }, BroadcastResult>(
  functions,
  "broadcastNotification"
);

/** Sends a real push notification to every device with a registered token (see
 *  pushNotifications.ts) -- routed through Expo's push service, which relays to real APNs/FCM
 *  delivery. This is the "Send" button's own action; there is no draft/preview state that looks
 *  like a send but isn't -- calling this always attempts a real send. */
export async function sendBroadcastNotification(title: string, body: string): Promise<BroadcastResult> {
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (!trimmedTitle || !trimmedBody) {
    return { outcome: "error", message: "Enter both a title and a message before sending." };
  }
  try {
    const result = await broadcastNotificationCallable({ title: trimmedTitle, body: trimmedBody });
    return result.data;
  } catch (err) {
    return {
      outcome: "error",
      message: `Couldn't reach the notification service: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
