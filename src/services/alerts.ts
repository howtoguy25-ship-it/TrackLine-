import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  increment,
  addDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { db } from "@/services/firebase";
import { encodeGeohash } from "@/utils/geo";
import { classifyAuRegion } from "@/utils/auStates";
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
    thanksCount: typeof data.thanksCount === "number" ? data.thanksCount : 0,
    reporterName: typeof data.reporterName === "string" && data.reporterName ? data.reporterName : undefined,
    // Pre-migration docs could still have the old plain-array shape for a short window (short-
    // lived alerts, 45min-24h TTL, all pruned by the scheduled cleanup function well within a
    // day) -- treated as "nobody's hidden it yet" rather than crashing on the shape mismatch.
    hiddenBy: data.hiddenBy && typeof data.hiddenBy === "object" && !Array.isArray(data.hiddenBy) ? data.hiddenBy : {},
    comment: typeof data.comment === "string" && data.comment.length > 0 ? data.comment : undefined,
    needsConfirmation: data.needsConfirmation === true,
    item: typeof data.item === "string" && data.item ? data.item : undefined,
    permanent: data.permanent === true,
    awaitingApproval: data.awaitingApproval === true,
    lastConfirmedAt: data.lastConfirmedAt?.toMillis?.() ?? undefined,
  };
}

// ---- Reporting through the server -----------------------------------------------------------
// Reports go through the submitReport Cloud Function (anti-spam, duplicate merge, trust, a 3 s
// undo window -- firebase/functions/reports/). Until that function is deployed the app falls
// back to writing the alert itself, which the console rules in force today allow; once the
// repo's firestore.rules are deployed that direct write is refused, so the server's checks
// can't be skipped.

export type ReportResult =
  | { kind: "pending"; pendingId: string; publishAtMs: number; needsConfirmation: boolean }
  | { kind: "merged"; alertId: string }
  | { kind: "direct"; alertId: string };

export class ReportRefused extends Error {
  constructor(public reason: string, message: string, public until?: number) {
    super(message);
  }
}

const NOT_DEPLOYED = new Set(["functions/not-found", "functions/unimplemented", "functions/internal", "functions/unavailable"]);

async function callable<T>(name: string, data: unknown): Promise<T> {
  // Loaded on use: the functions SDK ships ESM the test runner can't load (see firebase.ts), and
  // most screens that import this file never report anything.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { httpsCallable } = require("@firebase/functions") as typeof import("@firebase/functions");
  const { functions } = require("@/services/firebase") as typeof import("@/services/firebase");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const res = await httpsCallable(functions, name)(data);
  return res.data as T;
}

export async function submitReport(
  type: AlertType,
  location: { latitude: number; longitude: number },
  from: { latitude: number; longitude: number },
  uid: string,
  options: { customTtlMs?: number | null; comment?: string | null; reporterName?: string | null; item?: string | null } = {}
): Promise<ReportResult> {
  const trimmed = options.comment?.trim();
  const comment = trimmed && !containsBlockedLanguage(trimmed) ? clampToWordLimit(trimmed) : undefined;
  const region = classifyAuRegion(location.latitude, location.longitude);
  try {
    const r = await callable<{ merged: boolean; alertId?: string; pendingId?: string; publishAtMs?: number; needsConfirmation?: boolean }>("submitReport", {
      type,
      at: { lat: location.latitude, lng: location.longitude },
      from: { lat: from.latitude, lng: from.longitude },
      region,
      comment,
      customTtlMs: options.customTtlMs ?? null,
      showName: !!options.reporterName,
      item: options.item ?? null,
    });
    if (r.merged && r.alertId) return { kind: "merged", alertId: r.alertId };
    return { kind: "pending", pendingId: r.pendingId as string, publishAtMs: r.publishAtMs as number, needsConfirmation: !!r.needsConfirmation };
  } catch (err) {
    const e = err as { code?: string; message?: string; details?: { reason?: string; until?: number } };
    if (e.code && NOT_DEPLOYED.has(e.code)) {
      const alertId = await reportAlert(type, location, uid, options.customTtlMs, options.comment, options.reporterName, options.item);
      return { kind: "direct", alertId };
    }
    if (e.details?.reason) throw new ReportRefused(e.details.reason, e.message ?? "Report refused.", e.details.until);
    throw err;
  }
}

/** Undo inside the 3 s window (at most 2 an hour, server-enforced). */
export async function undoReport(result: ReportResult, uid: string): Promise<void> {
  if (result.kind === "pending") {
    try {
      await callable("undoReport", { pendingId: result.pendingId });
    } catch (err) {
      const e = err as { message?: string; details?: { reason?: string } };
      if (e.details?.reason) throw new ReportRefused(e.details.reason, e.message ?? "Can't undo.");
      throw err;
    }
  } else if (result.kind === "direct") {
    // Before the server is deployed: the report was written directly, so undo deletes it
    // (only its creator may -- firestore.rules).
    void uid;
    await deleteAlert(result.alertId);
  }
  // merged: nothing new was posted, nothing to undo.
}

/** Direct write -- only used as the fallback above until submitReport is deployed. */
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
  comment?: string | null,
  // The reporter's own signed-in name, only when they turned on "Show my name on reports";
  // firestore.rules checks it equals their auth token's name. Null = "by anonymous".
  reporterName?: string | null,
  // Settings > Reports item (stop sign camera, narrow bridge...); absent = the type's own.
  item?: string | null
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
    thanksCount: 0,
    ...(safeComment ? { comment: safeComment } : {}),
    ...(item ? { item } : {}),
    // Sent exactly as the auth token has it (the rules compare them); a name over 40 characters
    // is left off rather than cut, so the report says "by anonymous".
    ...(reporterName && reporterName.trim() && reporterName.length <= 40 ? { reporterName } : {}),
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

// Real, explicit request -- the new Inbox screen's own "delete + undo" row action. Reverses
// hideAlertForUser by removing this uid's own entry from the map entirely (not just letting the
// 1-hour timer run out), so "Undo" genuinely puts the alert straight back rather than only
// working within whatever time happens to be left on the hide.
export async function unhideAlertForUser(alertId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, ALERTS_COLLECTION, alertId), {
    [`hiddenBy.${uid}`]: deleteField(),
  });
}

const INBOX_LAST_VIEWED_KEY = "@trackline/inboxLastViewedAt";

// Real "unread" badge count for the main menu's Inbox row -- persisted locally (not synced
// across devices; a real, deliberately simple per-device "have I opened the Inbox since this
// alert came in" signal, same scope every other local AsyncStorage-backed counter in this app
// already has, e.g. services/voice.ts's consent-shown counter).
export async function getInboxLastViewedAt(): Promise<number> {
  const raw = await AsyncStorage.getItem(INBOX_LAST_VIEWED_KEY);
  return raw ? Number(raw) : 0;
}

export async function markInboxViewedNow(): Promise<void> {
  await AsyncStorage.setItem(INBOX_LAST_VIEWED_KEY, String(Date.now()));
}

export type AlertVote = "confirm" | "deny";

/**
 * One "Still here?" / "Not here" vote. The vote marker (alerts/{id}/votes/{uid}) and the counter
 * go up in one batch; firestore.rules only accepts the counter with a marker that didn't exist
 * before, so each user votes once per alert. A second vote is refused by the server and ignored
 * here (returns false).
 */
export async function voteOnAlert(alertId: string, uid: string, vote: AlertVote): Promise<boolean> {
  const batch = writeBatch(db);
  batch.set(doc(db, ALERTS_COLLECTION, alertId, "votes", uid), { vote, at: serverTimestamp() });
  batch.update(doc(db, ALERTS_COLLECTION, alertId), vote === "confirm" ? { confirmCount: increment(1) } : { denyCount: increment(1) });
  try {
    await batch.commit();
    return true;
  } catch (err) {
    if (isPermissionDenied(err)) return false;
    throw err;
  }
}

export async function confirmAlert(alertId: string, uid: string): Promise<boolean> {
  return voteOnAlert(alertId, uid, "confirm");
}

// "Not here" vote -- the other half of the automatic proximity "Still here? / Not here" prompt
// (see MapScreen's AlertStillHereCard).
export async function denyAlert(alertId: string, uid: string): Promise<boolean> {
  return voteOnAlert(alertId, uid, "deny");
}

/**
 * The alert card's thumbs-up: once per user, never on your own report (both enforced by
 * firestore.rules -- the marker alerts/{id}/thanks/{uid} is create-only). False when the server
 * refused it (already thanked, or own report).
 */
export async function thankAlert(alertId: string, uid: string): Promise<boolean> {
  const batch = writeBatch(db);
  batch.set(doc(db, ALERTS_COLLECTION, alertId, "thanks", uid), { at: serverTimestamp() });
  batch.update(doc(db, ALERTS_COLLECTION, alertId), { thanksCount: increment(1) });
  try {
    await batch.commit();
    return true;
  } catch (err) {
    if (isPermissionDenied(err)) return false;
    throw err;
  }
}

/** Whether this user already thanked this alert (their own marker doc is readable to them). */
export async function hasThankedAlert(alertId: string, uid: string): Promise<boolean> {
  try {
    return (await getDoc(doc(db, ALERTS_COLLECTION, alertId, "thanks", uid))).exists();
  } catch {
    return false;
  }
}

function isPermissionDenied(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "permission-denied";
}
