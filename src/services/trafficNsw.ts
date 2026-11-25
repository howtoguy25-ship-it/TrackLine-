import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/services/firebase";
import { EMPTY_TRAFFIC_SNAPSHOT, parseTrafficSnapshot, type TrafficSnapshot } from "@/services/trafficNswModel";

// Live Traffic NSW: one shared Firestore document, rewritten by the server every five minutes
// (firebase/functions -- refreshNswTraffic) and read live by every phone. A single listener on a
// single document; nothing here talks to Transport for NSW directly, and the API key never
// leaves the server.

const listeners = new Set<(snapshot: TrafficSnapshot) => void>();
let latest: TrafficSnapshot = EMPTY_TRAFFIC_SNAPSHOT;
let unsubscribeFirestore: (() => void) | null = null;

/**
 * Subscribes to the live snapshot. Every subscriber shares the one Firestore listener, which is
 * opened with the first subscriber and closed with the last. The callback is called straight
 * away with the latest known value.
 */
export function subscribeNswTraffic(listener: (snapshot: TrafficSnapshot) => void): () => void {
  listeners.add(listener);
  listener(latest);
  if (!unsubscribeFirestore) {
    unsubscribeFirestore = onSnapshot(
      doc(db, "trafficNsw", "current"),
      (snap) => {
        latest = snap.exists() ? parseTrafficSnapshot(snap.data()) : EMPTY_TRAFFIC_SNAPSHOT;
        listeners.forEach((l) => l(latest));
      },
      () => {
        // Couldn't read it (signed out, offline with nothing cached): keep whatever was last
        // known rather than blanking the map.
      }
    );
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeFirestore) {
      unsubscribeFirestore();
      unsubscribeFirestore = null;
    }
  };
}
