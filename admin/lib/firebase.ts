"use client";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

// Same Firebase project as the phone app. Public web config only (no secrets) -- set in
// admin/.env.local or the deploy workflow (ADMIN.md).
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const app = getApps().length ? getApp() : initializeApp(config);

// App Check (reCAPTCHA Enterprise). Needs the site key registered for the admin domain; the
// server enforces it once ADMIN_ENFORCE_APP_CHECK=true (ADMIN.md).
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_KEY) {
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_KEY), isTokenAutoRefreshEnabled: true });
}

export const auth = getAuth(app);
export const functions = getFunctions(app, process.env.NEXT_PUBLIC_FUNCTIONS_REGION || "us-central1");
