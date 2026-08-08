import { initializeApp, getApps, getApp } from "firebase/app";
// NOTE: imported from "@firebase/auth" (not the "firebase/auth" wrapper) because only
// @firebase/auth's package.json declares a legacy "react-native" field pointing at a
// build that includes getReactNativePersistence; the "firebase" wrapper's exports map
// doesn't route that helper to any platform target, RN included, so `firebase/auth`
// silently resolves to a build missing it.
import {
  initializeAuth,
  getReactNativePersistence,
  onAuthStateChanged,
  signInAnonymously,
  linkWithCredential,
  signInWithCredential,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
  reauthenticateWithCredential,
  GoogleAuthProvider,
  OAuthProvider,
  EmailAuthProvider,
  type AuthCredential,
  type User,
} from "@firebase/auth";
import { getFirestore } from "firebase/firestore";
// From "@firebase/functions" (not the "firebase/functions" wrapper) -- this repo's OWN Cloud
// Functions source lives at ./firebase/functions (see firebase.json), which collides with that
// wrapper subpath under this project's own baseUrl-relative module resolution (tsconfig.json
// sets baseUrl to the repo root for the "@/*" alias): `firebase/functions` resolves to our own
// ./firebase/functions/index.js instead of the npm package, since TS tries baseUrl-relative
// paths before node_modules. Confirmed via --traceResolution. Same class of fix (and the same
// reasoning) as the "@firebase/auth" import above, just a different, unrelated cause.
import { getFunctions } from "@firebase/functions";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { env } from "@/config/env";

const firebaseConfig = {
  apiKey: env.firebase.apiKey,
  authDomain: env.firebase.authDomain,
  projectId: env.firebase.projectId,
  storageBucket: env.firebase.storageBucket,
  messagingSenderId: env.firebase.messagingSenderId,
  appId: env.firebase.appId,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

// DIAGNOSTIC BUILD -- AsyncStorage-backed persistence temporarily removed. Sentry's native
// layer and the entire ad SDK (App Open + Banner, including mobileAds().initialize() and the
// ATT prompt) are now BOTH conclusively ruled out (build 25: everything from both subsystems
// off, identical crash persisted). Next candidate with real structural evidence, read directly
// from the installed package: node_modules/@react-native-async-storage/async-storage's
// NativeAsyncStorageModuleSpecJSI (ios/RNCAsyncStorage.mm line ~901, under
// RCT_NEW_ARCH_ENABLED) bridges through ObjCTurboModule exactly like the ad SDK did, and every
// exported method (multiGet/multiSet/multiMerge/getAllKeys/clear -- see
// src/NativeAsyncStorageModule.ts's Spec) is typed `=> void` with a plain callback param, the
// identical performVoidMethodInvocation pattern as appOpenLoad/BannerAd's Commands.load. Unlike
// ads/Sentry, AsyncStorage was NEVER disabled in any build tested so far (20-25) -- it fires
// unconditionally on every single cold launch via this persistence call (before first render)
// and via SettingsContext's loadSettings()/getVoiceEnabled() (see App.tsx/SettingsContext.tsx
// for that half of this same test). Falling back to in-memory-only auth persistence here
// isolates whether Firebase's AsyncStorage reads specifically are involved.
const DIAGNOSTIC_DISABLE_ASYNC_STORAGE_PERSISTENCE = false;

export const auth = DIAGNOSTIC_DISABLE_ASYNC_STORAGE_PERSISTENCE
  ? initializeAuth(firebaseApp)
  : initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });

export const db = getFirestore(firebaseApp);
// Backs runRevCheck (see src/services/revCheck.ts) -- the real PPSR provider key lives only in
// firebase/functions/index.js's own Admin SDK read, never shipped to or reachable from this
// client at all.
export const functions = getFunctions(firebaseApp);

/**
 * Alerts are attributed to a uid but the app has no account/login screen in v1,
 * so every device signs in anonymously. This still gives each installer a stable
 * uid for the createdBy / hiddenBy ownership rules.
 */
export function ensureSignedIn(): Promise<User> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        if (user) {
          resolve(user);
          return;
        }
        signInAnonymously(auth)
          .then((cred) => resolve(cred.user))
          .catch(reject);
      },
      reject
    );
  });
}

// --- Real sign-in (Google / Apple / Email) -- optional, upgrades the anonymous session ---
//
// The app still opens straight into ensureSignedIn()'s anonymous account above with zero
// friction -- these are only reached if the user chooses to sign in from Settings. Mirrors
// web/src/services/firebase.ts's linkOrSignIn: links the given credential to the current
// (usually anonymous) session so existing alerts/reports carry over under the same uid,
// instead of starting a brand-new account. Unlike the web version (which gets an AuthProvider
// and uses a browser popup), mobile builds a real AuthCredential itself from the native
// Google/Apple SDK's token first -- see signInWithGoogleCredential/signInWithAppleCredential.
async function linkOrSignIn(credential: AuthCredential): Promise<User> {
  const current = auth.currentUser;
  try {
    if (current?.isAnonymous) {
      const result = await linkWithCredential(current, credential);
      return result.user;
    }
    const result = await signInWithCredential(auth, credential);
    return result.user;
  } catch (err) {
    const code = err instanceof Object && "code" in err ? String((err as any).code) : null;
    if (code === "auth/credential-already-in-use") {
      // This identity already belongs to a different account (e.g. signed in before on
      // another device) -- sign straight into that existing account instead of failing.
      const result = await signInWithCredential(auth, credential);
      return result.user;
    }
    if (code === "auth/email-already-in-use") {
      throw new Error(
        "That email is already used by a different sign-in method on this account. Try signing in with the original method instead."
      );
    }
    throw err;
  }
}

export function signInWithGoogleCredential(idToken: string): Promise<User> {
  return linkOrSignIn(GoogleAuthProvider.credential(idToken));
}

// rawNonce is only present when the native Apple Sign In request included one (recommended,
// for replay protection) -- Firebase's Apple credential accepts it as optional.
export function signInWithAppleCredential(idToken: string, rawNonce?: string): Promise<User> {
  const provider = new OAuthProvider("apple.com");
  return linkOrSignIn(provider.credential({ idToken, rawNonce }));
}

// Which real identity provider the current signed-in user last authenticated with -- lets a
// caller (deleteAccount's auth/requires-recent-login recovery in SettingsScreen) pick the right
// native reauth flow (Apple vs Google) without asking the driver which one they used. null for
// no user, an anonymous-only session, or (in principle) a provider this app doesn't offer.
export function currentUserProviderId(): string | null {
  return auth.currentUser?.providerData[0]?.providerId ?? null;
}

// Firebase requires a RECENT sign-in for certain sensitive ops (deleteUser, most notably) --
// see deleteAccount below for the real, confirmed case this exists for. Re-running the exact
// same native Apple/Google sign-in flow the driver already used, then handing the fresh
// credential to Firebase's own reauthenticateWithCredential, is the standard fix: it proves
// "this is really you, right now" without forcing an actual sign-out/sign-in round trip.
export async function reauthenticateWithAppleCredential(idToken: string, rawNonce?: string): Promise<void> {
  const current = auth.currentUser;
  if (!current) throw new Error("No signed-in account to reauthenticate.");
  const provider = new OAuthProvider("apple.com");
  await reauthenticateWithCredential(current, provider.credential({ idToken, rawNonce }));
}

export async function reauthenticateWithGoogleCredential(idToken: string): Promise<void> {
  const current = auth.currentUser;
  if (!current) throw new Error("No signed-in account to reauthenticate.");
  await reauthenticateWithCredential(current, GoogleAuthProvider.credential(idToken));
}

export async function signUpWithEmail(email: string, password: string): Promise<User> {
  const current = auth.currentUser;
  if (current?.isAnonymous) {
    const result = await linkWithCredential(current, EmailAuthProvider.credential(email, password));
    return result.user;
  }
  const result = await createUserWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
  // This app is designed to always have at least an anonymous session -- every device gets a
  // stable uid for alert/report ownership (see ensureSignedIn above), and plenty of other code
  // (nearby alerts, reporting, etc) simply checks for a truthy `user` without distinguishing
  // anonymous from real. Signing out of a real identity shouldn't leave the rest of the app
  // broken until the next full restart happens to re-trigger ensureSignedIn -- immediately
  // re-establishing a fresh anonymous session here keeps everything else working exactly the
  // way it already did before the user ever signed in.
  await signInAnonymously(auth);
}

// Real account deletion (Firebase Auth), per explicit request that this "work" -- not a
// disguised sign-out. Firebase requires a RECENT sign-in for deleteUser to succeed; a session
// that's been open a while throws auth/requires-recent-login instead of silently doing nothing,
// which the caller (SettingsScreen) surfaces by asking the driver to sign out and back in first
// rather than failing with a raw Firebase error code. This only ever removes the Firebase Auth
// identity itself -- it does not attempt to delete this uid's past alert reports (no dedicated
// cleanup path exists for that; they remain exactly as any other expired/eventually-pruned
// report would) and does not touch App Store/Google Play purchase history, which lives with the
// platform account, not this one.
export async function deleteAccount(): Promise<void> {
  const current = auth.currentUser;
  if (!current || current.isAnonymous) {
    throw new Error("No signed-in account to delete.");
  }
  await deleteUser(current);
  // Same reasoning as signOutUser above -- keep the app usable immediately with a fresh
  // anonymous session instead of leaving it in a signed-out-with-no-session limbo.
  await signInAnonymously(auth);
}
