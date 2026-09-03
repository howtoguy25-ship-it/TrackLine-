import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  increment,
  addDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/services/firebase";
import { encodeGeohash } from "@/utils/geo";
import { classifyAuRegion } from "@/utils/auStates";
import { ALERT_TTL_MS, type AlertDoc, type AlertType } from "@/types/alert";
import { containsBlockedLanguage, clampToWordLimit } from "@/utils/commentFilter";

const ALERTS_COLLECTION = "alerts";

// Real "hide for 1 hour, self only" -- shared schema/behavior with the mobile app (same
// Firestore collection/rules, see firebase/firestore.rules and mobile's services/alerts.ts).
// Hiding was previously permanent (a plain uid array); hiddenBy is now a map of
// uid -> the ms timestamp they hid it, so a hide genuinely expires and only ever affects that
// one uid's own view.
const HIDE_DURATION_MS = 60 * 60 * 1000;

function isHiddenForUser(alert: AlertDoc, uid: string): boolean {
  const hiddenAt = alert.hiddenBy[uid];
  return typeof hiddenAt === "number" && Date.now() - hiddenAt < HIDE_DURATION_MS;
}

function toAlertDoc(id: string, data: any): AlertDoc {
  return {
    id,
    type: data.type,
    lat: data.lat,
    lng: data.lng,
    geohash: data.geohash,
    region: typeof data.region === "string" ? data.region : undefined,
    createdBy: data.createdBy,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : data.createdAt,
    expiresAt: data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : data.expiresAt,
    confirmCount: data.confirmCount ?? 0,
    denyCount: data.denyCount ?? 0,
    // Pre-migration docs could briefly still have the old plain-array shape -- treated as
    // "nobody's hidden it yet" rather than crashing on the shape mismatch (short-lived alerts,
    // all pruned by the scheduled cleanup function well within a day).
    hiddenBy: data.hiddenBy && typeof data.hiddenBy === "object" && !Array.isArray(data.hiddenBy) ? data.hiddenBy : {},
    comment: typeof data.comment === "string" && data.comment.length > 0 ? data.comment : undefined,
  };
}

export async function reportAlert(
  type: AlertType,
  location: { lat: number; lng: number },
  uid: string,
  // Real per-user override (Settings' "Alert lifetime") -- null/undefined keeps the existing
  // per-type default (ALERT_TTL_MS). Mirrors mobile's services/alerts.ts signature exactly.
  customTtlMs?: number | null,
  // Optional, up to 7 words, mirroring the mobile app -- re-clamped and re-checked against the
  // profanity list here too (not just in PlacementBar's own live validation), so a comment can
  // never reach Firestore over the word limit or containing a not-allowed word no matter what
  // path got it here. Dropped entirely (undefined) rather than saved if it still contains
  // blocked language after clamping -- there's no server-side moderation, so refusing to write
  // it is the only real enforcement available.
  comment?: string | null
): Promise<string> {
  const now = Date.now();
  const geohash = encodeGeohash(location.lat, location.lng, 9);
  const region = classifyAuRegion(location.lat, location.lng);
  const ttlMs = customTtlMs ?? ALERT_TTL_MS[type];
  const trimmedComment = comment?.trim();
  const safeComment =
    trimmedComment && !containsBlockedLanguage(trimmedComment) ? clampToWordLimit(trimmedComment) : undefined;

  const ref = await addDoc(collection(db, ALERTS_COLLECTION), {
    type,
    lat: location.lat,
    lng: location.lng,
    geohash,
    region,
    createdBy: uid,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(now + ttlMs),
    confirmCount: 0,
    denyCount: 0,
    hiddenBy: {},
    ...(safeComment ? { comment: safeComment } : {}),
  });

  return ref.id;
}

// Re-applies the hide filter on a plain timer, not just whenever a new Firestore snapshot
// happens to arrive -- a hide expiring after HIDE_DURATION_MS is purely a client-side clock
// event, so without this a hidden alert would only reappear by coincidence.
const REEMIT_INTERVAL_MS = 60 * 1000;

/**
 * Live subscription to every non-expired alert whose region is one of visibleRegions -- real
 * Australian state/territory selection (see utils/auStates.ts's classifyAuRegion) instead of a
 * plain distance radius, per explicit request. Mirrors mobile's services/alerts.ts exactly.
 * An empty selection means "nothing toggled on" -- Firestore's own `in` operator rejects an
 * empty array, so that case is handled here by skipping the query and emitting nothing.
 */
export function subscribeVisibleAlerts(
  visibleRegions: string[],
  currentUid: string,
  onChange: (alerts: AlertDoc[]) => void
): Unsubscribe {
  if (visibleRegions.length === 0) {
    onChange([]);
    return () => {};
  }

  let latestDocs: AlertDoc[] = [];
  function emit() {
    const now = Date.now();
    onChange(latestDocs.filter((alert) => alert.expiresAt > now && !isHiddenForUser(alert, currentUid)));
  }
  const unsubscribe = onSnapshot(
    query(collection(db, ALERTS_COLLECTION), where("region", "in", visibleRegions)),
    (snap) => {
      latestDocs = snap.docs.map((d) => toAlertDoc(d.id, d.data()));
      emit();
    }
  );
  const reemitInterval = setInterval(emit, REEMIT_INTERVAL_MS);
  return () => {
    clearInterval(reemitInterval);
    unsubscribe();
  };
}

export async function deleteAlert(alertId: string): Promise<void> {
  await deleteDoc(doc(db, ALERTS_COLLECTION, alertId));
}

export async function hideAlertForUser(alertId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, ALERTS_COLLECTION, alertId), {
    [`hiddenBy.${uid}`]: Date.now(),
  });
}

export async function confirmAlert(alertId: string): Promise<void> {
  await updateDoc(doc(db, ALERTS_COLLECTION, alertId), {
    confirmCount: increment(1),
  });
}
