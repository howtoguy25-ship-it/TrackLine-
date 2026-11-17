import { httpsCallable } from "firebase/functions";
import { EmailAuthProvider, linkWithCredential, signInWithEmailAndPassword, type User } from "firebase/auth";
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { auth, db, functions } from "@/services/firebase";

// The web side of accounts, help and messages -- the same Cloud Functions as the phone app
// (firebase/functions/admin): recovery limits, no account fishing, tickets, inbox counts.
export async function call<T>(name: string, data: Record<string, unknown>): Promise<T> {
  try {
    return (await httpsCallable(functions, name)(data)).data as T;
  } catch (err) {
    const e = err as { message?: string; details?: { attemptsLeft?: number } };
    const left = typeof e.details?.attemptsLeft === "number" ? ` ${e.details.attemptsLeft} tries left.` : "";
    throw new Error(`${e.message || "Something went wrong."}${left}`);
  }
}

const DEVICE_KEY = "trackline.installId";
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "web-unknown";
  }
}

export function contactKind(v: string): "email" | "phone" | null {
  const s = v.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "email";
  if (/^\+\d{8,15}$/.test(s.replace(/[\s()-]/g, ""))) return "phone";
  return null;
}
export function toInternational(v: string): string {
  const d = v.replace(/[\s()-]/g, "");
  return /^04\d{8}$/.test(d) ? `+61${d.slice(1)}` : d;
}

/** Email sign-up keeps a guest's data (links to the same account); sign-in switches to it. */
export async function emailSignUp(email: string, password: string): Promise<User> {
  const current = auth.currentUser;
  const cred = EmailAuthProvider.credential(email.trim(), password);
  if (current?.isAnonymous) return (await linkWithCredential(current, cred)).user;
  throw new Error("Sign out first.");
}
export async function emailSignIn(email: string, password: string): Promise<User> {
  return (await signInWithEmailAndPassword(auth, email.trim(), password)).user;
}
export function authErrorText(err: unknown): string {
  const code = (err as { code?: string }).code || "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code)) return "Wrong email or password.";
  if (code === "auth/email-already-in-use") return "That email already has an account. Sign in instead.";
  if (code === "auth/weak-password") return "Use at least 8 characters.";
  if (code === "auth/invalid-email") return "That email address doesn't look right.";
  return err instanceof Error ? err.message : "Something went wrong.";
}

// ---- Recovery (email link by Firebase; assisted ticket; cancel a change) ----
export const recoverByEmail = (email: string) => call<{ message: string }>("accountRecovery", { op: "start", email: email.trim(), deviceId: deviceId() });
export const newContactStart = (contact: string) =>
  call<{ challengeId: string }>("accountRecovery", { op: "newContactStart", deviceId: deviceId(), ...(contactKind(contact) === "email" ? { email: contact.trim() } : { phone: toInternational(contact) }) });
export const newContactVerify = (challengeId: string, code: string) => call<{ proof: string }>("accountRecovery", { op: "newContactVerify", challengeId, code });
export const recoveryTicket = (d: { signUpContact: string; approxSignupMonth: string; deviceModel: string; message: string; proof: string }) =>
  call<{ message: string }>("accountRecovery", {
    op: "ticket",
    deviceId: deviceId(),
    ...(contactKind(d.signUpContact) === "email" ? { signUpEmail: d.signUpContact.trim() } : { signUpPhone: toInternational(d.signUpContact) }),
    approxSignupMonth: /^\d{4}-\d{2}$/.test(d.approxSignupMonth) ? d.approxSignupMonth : null,
    deviceModel: d.deviceModel || null,
    message: d.message,
    proof: d.proof,
    country: (navigator.language.split("-")[1] || "").toUpperCase() || null,
  });
export const cancelChange = (changeId: string, code: string) => call<{ ok: true }>("accountRecovery", { op: "cancelChange", changeId: changeId.trim(), code: code.trim() });

// ---- Help ----
export type Ticket = { id: string; subject: string; status: "new" | "waiting" | "solved"; updatedAtMs: number };
export const createTicket = (subject: string, text: string) => call<{ id: string }>("helpTicket", { op: "create", subject, text, platform: "web" });
export const myTickets = async () => (await call<{ tickets: Ticket[] }>("helpTicket", { op: "list" })).tickets;
export const ticketThread = (id: string) => call<{ ticket: Ticket; messages: { from: string; text: string; atMs: number }[] }>("helpTicket", { op: "get", id });
export const replyTicket = (id: string, text: string) => call<{ ticket: Ticket; messages: { from: string; text: string; atMs: number }[] }>("helpTicket", { op: "reply", id, text });
export const statusLabel = (s: Ticket["status"]) => (s === "new" ? "Sent" : s === "waiting" ? "We replied" : "Solved");

// ---- Messages (inbox, banner, full screen) ----
export type InboxMessage = { id: string; title: string; body: string; channels: string[]; button: { label: string; deepLink: string } | null; translations: Record<string, { title: string; body: string }>; from: string; createdAtMs: number; openedAtMs: number | null; dismissedAtMs: number | null };
export function subscribeInbox(uid: string, cb: (m: InboxMessage[]) => void): () => void {
  return onSnapshot(query(collection(db, "users", uid, "inbox"), orderBy("createdAtMs", "desc"), limit(50)), (s) => cb(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InboxMessage, "id">) }))), () => cb([]));
}
export const inboxEvent = (id: string, event: "opened" | "clicked" | "dismissed") => call("inboxEvent", { id, event }).catch(() => null);
export function localised(m: InboxMessage): { title: string; body: string } {
  const t = m.translations?.[navigator.language.split("-")[0]];
  return { title: t?.title || m.title, body: t?.body || m.body };
}

// ---- Notification settings (which kinds of TrackLine messages this browser gets) ----
export async function saveNotificationPrefs(uid: string, prefs: { fun: boolean; news: boolean; traffic: boolean }): Promise<void> {
  await setDoc(doc(db, "deviceSessions", uid), { notificationPrefs: prefs, platform: "web" }, { merge: true });
}

// ---- Remote config + legal ----
export type RemoteConfig = { flags?: Record<string, { enabled: boolean; percent: number; countries: string[] }>; maintenance?: { mode: "off" | "banner" | "block"; message: string } };
export function subscribeConfig(cb: (c: RemoteConfig) => void): () => void {
  return onSnapshot(doc(db, "appConfig", "current"), (s) => cb((s.exists() ? s.data() : {}) as RemoteConfig), () => cb({}));
}
function bucket(uid: string, key: string): number {
  let h = 2166136261;
  for (const ch of `${key}:${uid}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 100;
}
/** Same rule as the app (src/remote/appConfig.ts). */
export function featureOn(cfg: RemoteConfig, key: string, uid: string | null): boolean {
  const f = cfg.flags?.[key];
  if (!f) return true;
  if (f.enabled === false) return false;
  const country = (navigator.language.split("-")[1] || "").toUpperCase();
  if (f.countries?.length && !f.countries.includes(country)) return false;
  const pct = typeof f.percent === "number" ? f.percent : 100;
  return pct >= 100 ? true : pct <= 0 ? false : bucket(uid || "anon", key) < pct;
}
export type LegalDoc = { version: number; lastMajorVersion: number | null; text: string };
export function subscribeLegal(kind: "privacy" | "terms", cb: (d: LegalDoc | null) => void): () => void {
  return onSnapshot(doc(db, "legalDocs", kind), (s) => cb(s.exists() ? (s.data() as LegalDoc) : null), () => cb(null));
}
export async function acceptLegal(uid: string, accepted: Record<string, number>): Promise<void> {
  await setDoc(doc(db, "users", uid), { acceptedLegal: accepted }, { merge: true });
}
export const GUEST_WARNING = "If you clear this browser's data or change devices, your saved places and settings will be lost unless you create an account.";
