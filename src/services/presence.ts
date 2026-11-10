import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  limit,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "@firebase/functions";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, functions } from "@/services/firebase";
import type { TrackyMoodKey } from "@/components/trackys/moods";

// Real, explicit request (Ghost mode + visibility control, Part 3 client) -- the client half of
// the presence system. The server (firebase/functions/index.js's updatePresence/clearPresence,
// Part 3 server) is the only thing that ever writes a presence/{uid} doc; this file only ever
// reads that collection and calls the two callables, matching firestore.rules' own
// `allow write: if false` on that collection.

export interface PresenceDoc {
  uid: string;
  lat: number;
  lng: number;
  headingDeg: number | null;
  mood: TrackyMoodKey;
  displayName?: string;
  updatedAt: number;
}

const MAX_PRESENCE_DOCS = 200;

// Real, explicit request -- "Map shows max 50 Trackys, clustered." This file fetches a larger
// safety margin (MAX_PRESENCE_DOCS) ordered by recency (not geo-bounded -- presence has no
// region/geohash field yet, see this function's own limitation note below), and the caller
// (MapScreen) is the one that actually filters to the current viewport and caps the rendered
// set at 50, closest-first -- same "fetch broad, render narrow" split this app already uses for
// alerts (visibleRegions) vs this screen's own viewport-only place layers.
//
// Known limitation, not silently worked around: without a geohash field on presence docs, a
// city with more than MAX_PRESENCE_DOCS simultaneously-visible drivers could have some of its
// nearest ones missed by this plain recency-ordered fetch. Acceptable for this app's real
// current scale; a geohash-bounded query (same pattern alerts.ts already uses) is the real fix
// if that ever becomes untrue.
export function subscribeNearbyPresence(
  selfUid: string,
  onChange: (presences: PresenceDoc[]) => void
): Unsubscribe {
  const q = query(collection(db, "presence"), orderBy("updatedAt", "desc"), limit(MAX_PRESENCE_DOCS));
  return onSnapshot(
    q,
    (snap) => {
      const presences: PresenceDoc[] = [];
      snap.forEach((docSnap) => {
        if (docSnap.id === selfUid) return;
        const data = docSnap.data();
        if (typeof data.lat !== "number" || typeof data.lng !== "number") return;
        presences.push({
          uid: docSnap.id,
          lat: data.lat,
          lng: data.lng,
          headingDeg: typeof data.headingDeg === "number" ? data.headingDeg : null,
          mood: typeof data.mood === "string" ? (data.mood as TrackyMoodKey) : "happy",
          displayName: typeof data.displayName === "string" ? data.displayName : undefined,
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : Date.now(),
        });
      });
      onChange(presences);
    },
    () => onChange([])
  );
}

export interface PresenceTracePoint {
  lat: number;
  lng: number;
}

export interface UpdatePresenceResult {
  outcome: "success" | "not_driving" | "suppressed_near_sensitive_location";
}

const updatePresenceCallable = httpsCallable<
  {
    trace: PresenceTracePoint[];
    headingDeg: number | null;
    speedKmh: number;
    mood: TrackyMoodKey;
    allowName: boolean;
    tripContext?: { sourceLat?: number; sourceLng?: number; destLat?: number; destLng?: number };
  },
  UpdatePresenceResult
>(functions, "updatePresence");

export async function callUpdatePresence(args: {
  trace: PresenceTracePoint[];
  headingDeg: number | null;
  speedKmh: number;
  mood: TrackyMoodKey;
  allowName: boolean;
  tripContext?: { sourceLat?: number; sourceLng?: number; destLat?: number; destLng?: number };
}): Promise<UpdatePresenceResult> {
  const res = await updatePresenceCallable(args);
  return res.data;
}

const clearPresenceCallable = httpsCallable<Record<string, never>, { outcome: "success" }>(functions, "clearPresence");

export async function callClearPresence(): Promise<void> {
  await clearPresenceCallable({}).catch(() => {});
}

// Real, explicit request -- "[Wave 👋] rate-limited 1/10min/blockable." Server-enforced (see
// sendWave in firebase/functions/index.js, which is the real rate-limit/block check -- this
// client-side cache is only a fast, honest UI disable so a driver doesn't tap Wave, wait for a
// round trip, and then learn it did nothing); it's cleared on app reinstall same as every other
// AsyncStorage-only local cache in this app.
const WAVE_COOLDOWN_KEY_PREFIX = "@trackline/waveCooldown/";
const WAVE_COOLDOWN_MS = 10 * 60 * 1000;

export async function getWaveCooldownRemainingMs(targetUid: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(`${WAVE_COOLDOWN_KEY_PREFIX}${targetUid}`);
    if (!raw) return 0;
    const sentAt = Number(raw);
    const remaining = WAVE_COOLDOWN_MS - (Date.now() - sentAt);
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

export interface SendWaveResult {
  outcome: "success" | "rate_limited" | "target_not_visible" | "no_token" | "error";
}

const sendWaveCallable = httpsCallable<{ targetUid: string }, SendWaveResult>(functions, "sendWave");

export async function callSendWave(targetUid: string): Promise<SendWaveResult> {
  try {
    const res = await sendWaveCallable({ targetUid });
    if (res.data.outcome === "success" || res.data.outcome === "rate_limited") {
      await AsyncStorage.setItem(`${WAVE_COOLDOWN_KEY_PREFIX}${targetUid}`, String(Date.now())).catch(() => {});
    }
    return res.data;
  } catch {
    return { outcome: "error" };
  }
}

// Real, explicit request -- "Block/report from card." A block is the BLOCKING driver's own,
// client-writable list (safe to allow directly, same self-only-write reasoning as alerts.ts's
// hiddenBy map) -- sendWave/presence reads check it server-side via the Admin SDK regardless of
// these rules.
export async function blockUser(selfUid: string, targetUid: string): Promise<void> {
  await setDoc(doc(db, "blocks", selfUid), { blockedUids: arrayUnion(targetUid) }, { merge: true });
}

export async function unblockUser(selfUid: string, targetUid: string): Promise<void> {
  await setDoc(doc(db, "blocks", selfUid), { blockedUids: arrayRemove(targetUid) }, { merge: true });
}

export async function getBlockedUids(selfUid: string): Promise<string[]> {
  const snap = await getDoc(doc(db, "blocks", selfUid));
  const list = snap.data()?.blockedUids;
  return Array.isArray(list) ? list.filter((u) => typeof u === "string") : [];
}

export type UserReportReason = "inappropriate_name" | "harassment" | "other";

// Real, explicit request -- the other half of "Block/report from card." Owner-only read (same
// admin-review convention as the `broadcasts` collection) -- see firestore.rules' own
// `userReports` block. Creation is validated server-side by the rule itself (reportedBy must be
// the caller, reportedUid must be a different real uid) rather than a Cloud Function, since
// this is a simple, safe, self-attributed create -- no secret/provider key or rate-sensitive
// logic involved the way sendWave has.
export async function reportUser(reportedUid: string, reason: UserReportReason, selfUid: string): Promise<void> {
  await addDoc(collection(db, "userReports"), {
    reportedUid,
    reportedBy: selfUid,
    reason,
    createdAt: serverTimestamp(),
  });
}
