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
import { classifyAuRegion, type AuRegionCode } from "@/utils/auStates";
import { ALERT_TTL_MS, type AlertDoc, type AlertType } from "@/types/alert";
import { containsBlockedLanguage, clampToWordLimit } from "@/utils/commentFilter";

const ALERTS_COLLECTION = "alerts";

// Real "hide for 1 hour, self only" per explicit request -- hiding was previously permanent
// (a plain uid array, once in it, always excluded from that user's own view). hiddenBy is now
// a map of uid -> the ms timestamp they hid it, so a hide can genuinely expire: past this many
// ms, isHiddenForUser below stops counting it, and the alert reappears for that one user again
// (never for anyone else -- this only ever filters what THIS uid's own client shows, same as
// before). Re-hiding just overwrites the same key with a fresh timestamp.
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
    // createdAt is written with serverTimestamp() (see reportAlert below), which the local
    // optimistic write Firestore fires through onSnapshot *before* the server round-trip
    // resolves it -- during that brief window, data.createdAt is genuinely `null`, not a
    // Timestamp. Falling through null as-is here (the previous behavior) made
    // `Date.now() - null` coerce to `Date.now() - 0`, i.e. "reported 56 years ago" flashing
    // for a split second on every alert the instant it's created. Date.now() is a real,
    // honest "just now" stand-in for those few hundred ms, not a mock value -- the very next
    // snapshot (server-confirmed) replaces it with the real timestamp.
    createdAt:
      data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : (data.createdAt ?? Date.now()),
    expiresAt: data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : data.expiresAt,
    confirmCount: data.confirmCount ?? 0,
    denyCount: data.denyCount ?? 0,
    // Pre-migration docs could still have the old plain-array shape for a short window (short-
    // lived alerts, 45min-24h TTL, all pruned by the scheduled cleanup function well within a
    // day) -- treated as "nobody's hidden it yet" rather than crashing on the shape mismatch.
    hiddenBy: data.hiddenBy && typeof data.hiddenBy === "object" && !Array.isArray(data.hiddenBy) ? data.hiddenBy : {},
    comment: typeof data.comment === "string" && data.comment.length > 0 ? data.comment : undefined,
  };
}

export async function reportAlert(
  type: AlertType,
  location: { latitude: number; longitude: number },
  uid: string,
  // Real per-user override (Settings' "Alert lifetime") -- null/undefined keeps the existing
  // per-type default (ALERT_TTL_MS), same behavior as before this setting existed.
  customTtlMs?: number | null,
  // Optional, up to 7 words, per explicit request -- re-clamped and re-checked against the
  // profanity list here too (not just in the placement bar's own live validation), so a comment
  // can never reach Firestore over the word limit or containing a not-allowed word no matter
  // what path got it here. A comment that still contains blocked language after clamping is
  // dropped entirely (undefined) rather than silently saved -- this app has no server-side
  // moderation, so refusing to write it at all is the only real enforcement available.
  comment?: string | null
): Promise<string> {
  const now = Date.now();
  const geohash = encodeGeohash(location.latitude, location.longitude, 9);
  const region = classifyAuRegion(location.latitude, location.longitude);
  const ttlMs = customTtlMs ?? ALERT_TTL_MS[type];
  const trimmedComment = comment?.trim();
  const safeComment =
    trimmedComment && !containsBlockedLanguage(trimmedComment)
      ? clampToWordLimit(trimmedComment)
      : undefined;

  const ref = await addDoc(collection(db, ALERTS_COLLECTION), {
    type,
    lat: location.latitude,
    lng: location.longitude,
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
// event, nothing about the alert doc itself changes when that hour passes, so without this a
// hidden alert would only ever reappear by coincidence (whenever something else about it
// happened to trigger a fresh snapshot). One minute is frequent enough that "reappears" after
// the hour is up feels prompt without re-filtering on every render.
const REEMIT_INTERVAL_MS = 60 * 1000;

/**
 * Live subscription to every non-expired alert whose region is one of visibleRegions -- real
 * Australian state/territory selection (see utils/auStates.ts's classifyAuRegion) instead of a
 * plain distance radius, per explicit request: a driver who toggles on e.g. NSW and QLD sees
 * every alert in both regions regardless of how far away it is, not just nearby ones. An empty
 * selection means "nothing toggled on" -- Firestore's own `in` operator rejects an empty array,
 * so that case is handled here by skipping the query entirely and emitting nothing, rather than
 * letting it throw.
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

// Hides for the CALLING user only, for HIDE_DURATION_MS (1 hour), per explicit request -- never
// affects any other user's own view (each uid's hide is its own key in the map), and re-hiding
// later (once it's reappeared, or even before) just overwrites this same key with a fresh
// timestamp, restarting the hour.
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

// "Not here" vote -- the other half of the automatic proximity "Still here? / Not here" prompt
// (see MapScreen's AlertStillHereCard). Mirrors confirmAlert exactly, just the other counter.
export async function denyAlert(alertId: string): Promise<void> {
  await updateDoc(doc(db, ALERTS_COLLECTION, alertId), {
    denyCount: increment(1),
  });
}
