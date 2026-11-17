import { callFn } from "@/services/callable";
import { installId } from "@/services/targeting";

// The app's half of account recovery. Every limit and check is on the server
// (firebase/functions/admin/recovery.js); this only carries the user's answers.
export type StartResult = { ok: true; channel: "email" | "sms"; message: string; challengeId: string | null; masked?: string };

/** "+61 412 345 678" -> "•••• ••5 678" for "is this the right number?". Pure. */
export function maskPhoneForDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return phone;
  return `•••• ••${d.slice(-4, -3)} ${d.slice(-3)}`;
}

/** What the user typed is an email, a full international phone number, or neither. Pure. */
export function contactKind(v: string): "email" | "phone" | null {
  const s = v.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "email";
  if (/^\+\d{8,15}$/.test(s.replace(/[\s()-]/g, ""))) return "phone";
  return null;
}

/** Australian mobile "0412 345 678" -> "+61412345678"; anything else unchanged. Pure. */
export function toInternational(v: string): string {
  const d = v.replace(/[\s()-]/g, "");
  if (/^04\d{8}$/.test(d)) return `+61${d.slice(1)}`;
  return d;
}

export async function startRecovery(contact: string): Promise<StartResult> {
  const kind = contactKind(contact);
  const deviceId = await installId();
  return callFn<StartResult>("accountRecovery", { op: "start", deviceId, ...(kind === "email" ? { email: contact.trim() } : { phone: toInternational(contact) }) });
}

export function verifyRecoveryCode(challengeId: string, code: string): Promise<{ ok: true; grant: string }> {
  return callFn("accountRecovery", { op: "verify", challengeId, code });
}

export function setNewPassword(grant: string, newPassword: string): Promise<{ ok: true; email: string | null; customToken: string | null }> {
  return callFn("accountRecovery", { op: "reset", grant, newPassword });
}

export async function startNewContact(contact: string): Promise<{ ok: true; challengeId: string }> {
  const kind = contactKind(contact);
  const deviceId = await installId();
  return callFn("accountRecovery", { op: "newContactStart", deviceId, ...(kind === "email" ? { email: contact.trim() } : { phone: toInternational(contact) }) });
}

export function verifyNewContact(challengeId: string, code: string): Promise<{ ok: true; proof: string }> {
  return callFn("accountRecovery", { op: "newContactVerify", challengeId, code });
}

export interface TicketDetails {
  signUpContact: string;
  approxSignupMonth: string | null;
  deviceModel: string | null;
  lastPlaces: string[];
  purchases: string | null;
  message: string;
  proof: string | null;
  country: string | null;
}

export async function sendRecoveryTicket(d: TicketDetails): Promise<{ ok: true; ticketId: string; message: string }> {
  const kind = contactKind(d.signUpContact);
  const deviceId = await installId();
  return callFn("accountRecovery", {
    op: "ticket",
    deviceId,
    ...(kind === "email" ? { signUpEmail: d.signUpContact.trim() } : { signUpPhone: toInternational(d.signUpContact) }),
    approxSignupMonth: d.approxSignupMonth,
    deviceModel: d.deviceModel,
    lastPlaces: d.lastPlaces,
    purchases: d.purchases,
    message: d.message,
    proof: d.proof,
    country: d.country,
  });
}

export function cancelContactChange(changeId: string, code: string): Promise<{ ok: true }> {
  return callFn("accountRecovery", { op: "cancelChange", changeId: changeId.trim(), code: code.trim() });
}

/** The guided "Can't sign in?" chat: one question at a time, then the ticket. Pure. */
export const RECOVERY_CHAT = [
  { key: "signUpContact", ask: "What email or phone number did you sign up with?", required: true },
  { key: "approxSignupMonth", ask: "Roughly when did you sign up? (for example 2025-03)", required: false },
  { key: "deviceModel", ask: "Which phone did you use TrackLine on? (for example iPhone 15 or Pixel 8)", required: false },
  { key: "lastPlaces", ask: "Name one or two places you saved or drove to recently.", required: false },
  { key: "purchases", ask: "Did you buy anything in the app, like a Vehicle Full Check?", required: false },
  { key: "message", ask: "Anything else we should know?", required: false },
] as const;

/** Month answers like "March 2025", "03/2025" or "2025-3" -> "2025-03"; else null. Pure. */
export function parseMonth(v: string): string | null {
  const s = v.trim().toLowerCase();
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  let m = /^(\d{4})[-/.](\d{1,2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${m[1].padStart(2, "0")}`;
  const idx = months.findIndex((mo) => s.startsWith(mo));
  const y = /(\d{4})/.exec(s);
  if (idx >= 0 && y) return `${y[1]}-${String(idx + 1).padStart(2, "0")}`;
  return null;
}
