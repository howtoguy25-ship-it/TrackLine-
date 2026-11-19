import * as WebBrowser from "expo-web-browser";
import { PhoneAuthProvider, linkWithCredential, signInWithCredential, getAdditionalUserInfo, type User, type AuthCredential } from "firebase/auth";
import { auth } from "@/services/firebase";
import { env } from "@/config/env";
import { toInternational } from "@/account/recovery";

// Sign in with a phone number: Firebase Phone Authentication sends the 6-digit SMS itself.
// Its reCAPTCHA step only runs in a browser, so the app opens TrackLine's own page
// (web/public/phone-verify.html on Firebase Hosting) for a moment; it returns a verification
// ID, and the code is entered back in the app.
export const PHONE_RETURN = "trackline://phone-auth";

export function verifyPageUrl(phoneE164: string, projectId: string = env.firebase.projectId): string {
  return `https://${projectId}.web.app/phone-verify.html?phone=${encodeURIComponent(phoneE164)}&return=${encodeURIComponent(PHONE_RETURN)}`;
}

/** What the verification page handed back. Pure. */
export function parsePhoneReturn(url: string): { vid: string } | { error: string } {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const params = new URLSearchParams(q);
  const vid = params.get("vid");
  if (vid) return { vid };
  return { error: params.get("error") || "cancelled" };
}

export const PHONE_ERRORS: Record<string, string> = {
  "invalid-phone-number": "That number doesn't look right. Use your full mobile number.",
  "too-many-requests": "Too many tries from this phone. Wait a while and try again.",
  "quota-exceeded": "We can't send codes right now. Try again later.",
  "captcha-check-failed": "The robot check didn't complete. Try again.",
  cancelled: "Cancelled.",
  "invalid-verification-code": "That code isn't right.",
  "code-expired": "That code has expired. Send a new one.",
  "session-expired": "That code has expired. Send a new one.",
  "operation-not-allowed": "Phone sign-in isn't turned on for TrackLine yet.",
};
export const phoneErrorText = (code: string) => PHONE_ERRORS[code.replace(/^auth\//, "")] ?? "Something went wrong. Try again.";

/** Opens the verification page and returns the verification ID (Firebase sends the SMS). */
export async function sendPhoneCode(phone: string): Promise<string> {
  const e164 = toInternational(phone);
  const result = await WebBrowser.openAuthSessionAsync(verifyPageUrl(e164), PHONE_RETURN);
  if (result.type !== "success") throw new Error(PHONE_ERRORS.cancelled);
  const r = parsePhoneReturn(result.url);
  if ("error" in r) throw new Error(phoneErrorText(r.error));
  return r.vid;
}

function codeOf(err: unknown): string {
  return err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
}

/**
 * Sign in with the code. A guest's account becomes this phone account (same uid, nothing
 * lost); if the number already has an account, that account is signed into instead.
 */
export async function confirmPhoneCode(vid: string, code: string): Promise<{ user: User; isNewUser: boolean }> {
  const credential = PhoneAuthProvider.credential(vid, code.trim());
  const current = auth.currentUser;
  try {
    if (current?.isAnonymous) {
      const r = await linkWithCredential(current, credential);
      return { user: r.user, isNewUser: false };
    }
    const r = await signInWithCredential(auth, credential);
    return { user: r.user, isNewUser: !!getAdditionalUserInfo(r)?.isNewUser };
  } catch (err) {
    if (codeOf(err) === "auth/credential-already-in-use") {
      // The number belongs to another account: Firebase hands back a fresh credential for it.
      const again = PhoneAuthProvider.credentialFromError(err as never) as AuthCredential | null;
      if (again) {
        const r = await signInWithCredential(auth, again);
        return { user: r.user, isNewUser: false };
      }
    }
    throw new Error(phoneErrorText(codeOf(err)));
  }
}

/** Recovery: sign into the account that owns this number; never create one. */
export async function signInExistingPhone(vid: string, code: string): Promise<User | null> {
  const r = await signInWithCredential(auth, PhoneAuthProvider.credential(vid, code.trim())).catch((err) => {
    throw new Error(phoneErrorText(codeOf(err)));
  });
  if (getAdditionalUserInfo(r)?.isNewUser) {
    // No account had this number: remove the one Firebase just made, same reply as always.
    await r.user.delete().catch(() => {});
    return null;
  }
  return r.user;
}
