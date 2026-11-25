// How the server reaches a user outside the app.
//
//  - Password reset email: Firebase Auth's own email (Identity Toolkit sendOobCode, called with
//    the functions' service account). Works as soon as the functions are deployed; the wording
//    is the Firebase console's "Password reset" template.
//  - Any other email (codes, "your password was changed", 24 h contact-change notices): a doc in
//    `mail`, the format of the "Trigger Email from Firestore" extension. Sent once that
//    extension is installed with an SMTP provider (ADMIN.md); until then it waits there.
//  - SMS: a doc in `smsOutbox`, sent by deliverSms through Twilio once TWILIO_* secrets exist.
const { GoogleAuth } = require("google-auth-library");

function projectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    return JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId;
  } catch {
    return undefined;
  }
}

async function firebaseResetEmail(email) {
  const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const pid = projectId();
  const base = emu ? `http://${emu}/identitytoolkit.googleapis.com` : "https://identitytoolkit.googleapis.com";
  let authHeader = "Bearer owner"; // what the Auth emulator accepts as an admin call
  if (!emu) {
    const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
    const t = await client.getAccessToken();
    authHeader = `Bearer ${t.token}`;
  }
  const res = await fetch(`${base}/v1/projects/${pid}/accounts:sendOobCode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
  });
  if (!res.ok) throw new Error(`sendOobCode HTTP ${res.status}`);
  return true;
}

async function queueEmail(db, { to, subject, text, kind, uid = null, nowMs = Date.now() }) {
  if (!to) return null;
  const ref = await db.collection("mail").add({ to, message: { subject, text }, kind, uid, createdAtMs: nowMs });
  return ref.id;
}

async function queueSms(db, { to, body, kind, uid = null, nowMs = Date.now() }) {
  if (!to) return null;
  const ref = await db.collection("smsOutbox").add({ to, body, kind, uid, createdAtMs: nowMs, status: "queued" });
  return ref.id;
}

/** Twilio send for one smsOutbox doc. Returns the status to store. */
async function sendTwilio({ sid, token, from }, { to, body }) {
  if (!sid || !token || !from || sid === "unset" || token === "unset" || from === "unset") return { status: "not_set_up" };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  return res.ok ? { status: "sent" } : { status: "failed", httpStatus: res.status };
}

module.exports = { firebaseResetEmail, queueEmail, queueSms, sendTwilio, projectId };
