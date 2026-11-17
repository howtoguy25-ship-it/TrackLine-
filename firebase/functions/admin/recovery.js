// Account recovery, server-enforced. These callables don't need a signed-in account (the user
// is locked out); every reply is the same whether or not an account exists.
//
//   A) Forgot password: email -> Firebase's own reset link; phone -> 6-digit code by SMS.
//   B) Can't sign in: identify by email/phone -> code -> new password. No access to that email
//      or phone any more -> a recovery ticket with a risk score, reviewed by owner/support.
//      An approved change of email/phone waits 24 h, with a notice (and cancel code) sent to the
//      OLD contact first.
//   Limits: 3 recovery requests a day per account and per device (and 30 per IP, loose because phones share carrier IPs).
const crypto = require("crypto");
const otp = require("./otp");
const notify = require("./notify");
const { maskEmail, maskPhone } = require("./mask");

const DAY = 24 * 60 * 60 * 1000;
const LIMITS = Object.freeze({ perAccountPerDay: 3, perDevicePerDay: 3, perIpPerDay: 30 });
const GRANT_TTL_MS = 15 * 60 * 1000;
const CONTACT_CHANGE_DELAY_MS = 24 * 60 * 60 * 1000;
const GENERIC = "If an account exists for that, we've sent it a code.";

class RecoveryError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

function normaliseEmail(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}
function normalisePhone(v) {
  const s = typeof v === "string" ? v.replace(/[\s()-]/g, "") : "";
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

/** Keeps the timestamps inside the last day and says whether one more is allowed. Pure. */
function underLimit(times, limit, nowMs) {
  const recent = (times || []).filter((t) => nowMs - t < DAY);
  return { ok: recent.length < limit, recent };
}

/** Counts a request against each key; throws when any is over. Keys never reveal an account. */
async function countRequest(db, keys, nowMs) {
  await db.runTransaction(async (tx) => {
    const refs = keys.map(([k, limit]) => [db.doc(`recoveryLimits/${otp.sha(k)}`), limit]);
    const snaps = await Promise.all(refs.map(([r]) => tx.get(r)));
    const results = snaps.map((s, i) => underLimit(s.exists ? s.data().times : [], refs[i][1], nowMs));
    if (results.some((r) => !r.ok)) throw new RecoveryError("resource-exhausted", "Too many recovery requests today. Try again tomorrow, or contact support from the Help screen.");
    refs.forEach(([r], i) => tx.set(r, { times: [...results[i].recent, nowMs] }));
  });
}

/**
 * Risk score 0-100 for assisted recovery (higher = riskier). Pure; each signal is listed so the
 * reviewer sees why. A score, not a pass/fail: the reviewer decides.
 */
function riskScore(s) {
  let score = 50;
  const reasons = [];
  const add = (n, why) => {
    score += n;
    reasons.push(`${n > 0 ? "+" : ""}${n} ${why}`);
  };
  if (s.sameDevice === true) add(-25, "request came from a device this account used before");
  else if (s.sameDevice === false) add(10, "new device");
  if (s.sameAppInstance === true) add(-10, "same app install as before");
  if (s.sameCountry === true) add(-10, "same country as usual");
  else if (s.sameCountry === false) add(20, "different country from usual");
  if (typeof s.accountAgeDays === "number") {
    if (s.accountAgeDays < 7) add(15, "account is less than a week old");
    else if (s.accountAgeDays > 180) add(-5, "account is over 6 months old");
  }
  if ((s.recentFailedAttempts || 0) >= 3) add(25, `${s.recentFailedAttempts} failed recovery attempts this week`);
  if (s.signupDateMatches === true) add(-10, "sign-up date matches");
  else if (s.signupDateMatches === false) add(10, "sign-up date doesn't match");
  if (s.deviceModelMatches === true) add(-5, "device model matches");
  if (s.purchasesMatch === true) add(-10, "purchases match");
  if (s.newContactVerified !== true) add(20, "new contact not verified");
  score = Math.max(0, Math.min(100, score));
  const level = score < 35 ? "low" : score < 65 ? "medium" : "high";
  // Nothing in assisted recovery is instant (the old contact wasn't proven); high risk is
  // flagged so it goes to the owner/support queue first. The instant path is a code sent to the
  // contact already on the account (start -> verifyCode -> resetWithGrant).
  return { score, level, reasons, mandatoryReview: level === "high" };
}

async function findUser(auth, { email, phone }) {
  try {
    if (email) return await auth.getUserByEmail(email);
    if (phone) return await auth.getUserByPhoneNumber(phone);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") return null;
    throw err;
  }
  return null;
}

function ipKey(ip) {
  return `ip|${ip || "unknown"}`;
}

/** Step 1: identify. Email -> Firebase reset link; phone -> SMS code. Same reply either way. */
async function start({ db, auth, data, ip, nowMs }) {
  const email = normaliseEmail(data.email);
  const phone = email ? null : normalisePhone(data.phone);
  if (!email && !phone) throw new RecoveryError("invalid-argument", "Enter the email or full phone number (with country code) you signed up with.");
  const deviceId = typeof data.deviceId === "string" ? data.deviceId.slice(0, 100) : "unknown";
  const contact = email || phone;
  await countRequest(db, [[`acct|${contact}`, LIMITS.perAccountPerDay], [`dev|${deviceId}`, LIMITS.perDevicePerDay], [ipKey(ip), LIMITS.perIpPerDay]], nowMs);
  const user = await findUser(auth, { email, phone });
  await db.collection("recoveryEvents").add({ kind: "start", uid: user ? user.uid : null, channel: email ? "email" : "sms", deviceId, ip: ip || null, atMs: nowMs });
  if (email) {
    if (user) await notify.firebaseResetEmail(email);
    return { ok: true, channel: "email", message: "If an account exists for that email, we've sent a link to reset your password.", challengeId: null };
  }
  const issued = await otp.issue(db, { purpose: "reset", uid: user ? user.uid : null, channel: "sms", to: phone, nowMs, extra: { deviceId } });
  if (!issued.sent) throw new RecoveryError("resource-exhausted", "Too many wrong codes. Try again in 15 minutes.", { until: issued.cooldownUntil });
  return { ok: true, channel: "sms", message: GENERIC, challengeId: issued.id, masked: maskPhone(phone) };
}

/** Step 2: the code. Right code -> a 15-minute grant to set a new password. */
async function verifyCode({ db, data, nowMs }) {
  const r = await otp.verify(db, { id: data.challengeId, code: data.code, nowMs });
  if (!r.ok) {
    await db.collection("recoveryEvents").add({ kind: "code_failed", reason: r.reason, atMs: nowMs });
    const msg = { invalid: "That code isn't right.", expired: "That code has expired. Ask for a new one.", used: "That code was already used.", locked: "Too many wrong codes. Try again in 15 minutes.", cooldown: "Too many wrong codes. Try again in 15 minutes." }[r.reason];
    throw new RecoveryError(r.reason === "locked" || r.reason === "cooldown" ? "resource-exhausted" : "invalid-argument", msg, { attemptsLeft: r.attemptsLeft });
  }
  const grant = crypto.randomBytes(24).toString("hex");
  await db.doc(`recoveryGrants/${otp.sha(grant)}`).set({ uid: r.rec.uid, purpose: r.rec.purpose, createdAtMs: nowMs, expiresAtMs: nowMs + GRANT_TTL_MS, used: false });
  return { ok: true, grant };
}

/** Sends "your password was changed" to every contact on the account. */
async function passwordChangedNotice(db, user, nowMs) {
  const text = "The password for your TrackLine account was just changed and every other device was signed out. Wasn't you? Open TrackLine > Sign in > Can't sign in? straight away, or reply to this message.";
  if (user.email) await notify.queueEmail(db, { to: user.email, subject: "Your TrackLine password was changed", text, kind: "password_changed", uid: user.uid, nowMs });
  if (user.phoneNumber) await notify.queueSms(db, { to: user.phoneNumber, body: text, kind: "password_changed", uid: user.uid, nowMs });
}

/** Step 3: new password with the grant. Signs out all other devices and sends the notice. */
async function resetWithGrant({ db, auth, data, nowMs }) {
  const grant = typeof data.grant === "string" ? data.grant : "";
  const password = typeof data.newPassword === "string" ? data.newPassword : "";
  if (password.length < 8) throw new RecoveryError("invalid-argument", "Use at least 8 characters.");
  const ref = db.doc(`recoveryGrants/${otp.sha(grant)}`);
  const uid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().used || snap.data().expiresAtMs < nowMs || snap.data().purpose !== "reset") {
      throw new RecoveryError("permission-denied", "This reset has expired. Start again.");
    }
    tx.update(ref, { used: true, usedAtMs: nowMs });
    return snap.data().uid;
  });
  const user = await auth.getUser(uid);
  await auth.updateUser(uid, { password });
  await auth.revokeRefreshTokens(uid);
  await passwordChangedNotice(db, user, nowMs);
  await db.collection("recoveryEvents").add({ kind: "password_reset", uid, atMs: nowMs });
  // An account with no email can't sign in with a password; hand back a sign-in token instead.
  let customToken = null;
  if (!user.email) customToken = await auth.createCustomToken(uid);
  return { ok: true, email: user.email ? maskEmail(user.email) : null, customToken };
}

/** "Can't sign in" without the old contact: first prove the NEW contact with a code. */
async function newContactStart({ db, data, ip, nowMs }) {
  const email = normaliseEmail(data.email);
  const phone = email ? null : normalisePhone(data.phone);
  if (!email && !phone) throw new RecoveryError("invalid-argument", "Enter the new email or phone number you can use now.");
  const deviceId = typeof data.deviceId === "string" ? data.deviceId.slice(0, 100) : "unknown";
  await countRequest(db, [[`new|${email || phone}`, LIMITS.perAccountPerDay], [`dev|${deviceId}`, LIMITS.perDevicePerDay], [ipKey(ip), LIMITS.perIpPerDay]], nowMs);
  // The new contact belongs to whoever is asking, so the code is really sent (uid "pending").
  const issued = await otp.issue(db, { purpose: "newContact", uid: "pending", channel: email ? "email" : "sms", to: email || phone, nowMs, extra: { contact: email || phone } });
  if (!issued.sent) throw new RecoveryError("resource-exhausted", "Too many wrong codes. Try again in 15 minutes.");
  return { ok: true, challengeId: issued.id };
}

async function newContactVerify({ db, data, nowMs }) {
  const r = await otp.verify(db, { id: data.challengeId, code: data.code, nowMs });
  if (!r.ok || r.rec.purpose !== "newContact") throw new RecoveryError("invalid-argument", r.reason === "expired" ? "That code has expired." : "That code isn't right.", { attemptsLeft: r.attemptsLeft });
  const proof = crypto.randomBytes(24).toString("hex");
  await db.doc(`contactProofs/${otp.sha(proof)}`).set({ contact: r.rec.contact, createdAtMs: nowMs, expiresAtMs: nowMs + 60 * 60 * 1000, used: false });
  return { ok: true, proof };
}

const MONTH = 31 * DAY;

/** Recovery ticket from the in-app chat: the details plus server-checked risk signals. */
async function createTicket({ db, auth, data, ip, nowMs }) {
  const deviceId = typeof data.deviceId === "string" ? data.deviceId.slice(0, 100) : "unknown";
  const signUpEmail = normaliseEmail(data.signUpEmail);
  const signUpPhone = normalisePhone(data.signUpPhone);
  if (!signUpEmail && !signUpPhone) throw new RecoveryError("invalid-argument", "Tell us the email or phone you signed up with.");
  await countRequest(db, [[`acct|${signUpEmail || signUpPhone}`, LIMITS.perAccountPerDay], [`dev|${deviceId}`, LIMITS.perDevicePerDay], [ipKey(ip), LIMITS.perIpPerDay]], nowMs);

  let newContact = null;
  if (typeof data.proof === "string" && data.proof) {
    const pRef = db.doc(`contactProofs/${otp.sha(data.proof)}`);
    const p = await pRef.get();
    if (p.exists && !p.data().used && p.data().expiresAtMs > nowMs) {
      newContact = p.data().contact;
      await pRef.update({ used: true });
    }
  }
  const user = await findUser(auth, { email: signUpEmail, phone: signUpPhone });
  const details = {
    approxSignupMonth: typeof data.approxSignupMonth === "string" ? data.approxSignupMonth.slice(0, 7) : null, // "2026-03"
    deviceModel: typeof data.deviceModel === "string" ? data.deviceModel.slice(0, 80) : null,
    lastPlaces: Array.isArray(data.lastPlaces) ? data.lastPlaces.slice(0, 5).map((s) => String(s).slice(0, 80)) : [],
    purchases: typeof data.purchases === "string" ? data.purchases.slice(0, 200) : null,
    country: typeof data.country === "string" ? data.country.slice(0, 2).toUpperCase() : null,
    message: typeof data.message === "string" ? data.message.slice(0, 2000) : "",
  };
  let signals = { newContactVerified: !!newContact };
  if (user) {
    const [session, devices, failures, purchases] = await Promise.all([
      db.doc(`deviceSessions/${user.uid}`).get(),
      db.collection(`deviceSessions/${user.uid}/devices`).limit(50).get(),
      db.collection("recoveryEvents").where("uid", "==", user.uid).where("atMs", ">", nowMs - 7 * DAY).get(),
      db.collection("vehicleCheckPurchases").where("uid", "==", user.uid).limit(5).get(),
    ]);
    const created = Date.parse(user.metadata.creationTime);
    const devIds = devices.docs.map((d) => d.id);
    const models = devices.docs.map((d) => d.data().model).filter(Boolean);
    let signupDateMatches = null;
    if (details.approxSignupMonth && /^\d{4}-\d{2}$/.test(details.approxSignupMonth)) {
      signupDateMatches = Math.abs(Date.parse(`${details.approxSignupMonth}-15`) - created) <= MONTH;
    }
    signals = {
      ...signals,
      sameDevice: devIds.includes(deviceId),
      sameAppInstance: devIds.includes(deviceId),
      sameCountry: details.country && session.exists && session.data().country ? details.country === session.data().country : null,
      accountAgeDays: Math.floor((nowMs - created) / DAY),
      recentFailedAttempts: failures.docs.filter((d) => d.data().kind === "code_failed" || d.data().kind === "start").length,
      signupDateMatches,
      deviceModelMatches: details.deviceModel ? models.some((m) => m.toLowerCase() === details.deviceModel.toLowerCase()) : null,
      purchasesMatch: details.purchases ? (purchases.size > 0) === /yes|check|bought|purchase/i.test(details.purchases) : null,
    };
  }
  const risk = riskScore(signals);
  // The ticket is created either way; with no matching account a reviewer simply finds none.
  const ref = await db.collection("supportTickets").add({
    kind: "recovery",
    status: "new",
    subject: "Account recovery",
    uid: user ? user.uid : null,
    accountFound: !!user,
    signUpEmail,
    signUpPhone,
    newContact,
    details,
    signals,
    risk,
    deviceId,
    ip: ip || null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    assignee: null,
  });
  await db.collection("recoveryEvents").add({ kind: "ticket", uid: user ? user.uid : null, ticketId: ref.id, deviceId, atMs: nowMs });
  return { ok: true, ticketId: ref.id, message: "Thanks. Our team will check this and reply to the contact you gave. This usually takes up to 2 days." };
}

/**
 * Staff decision on a recovery ticket. Approve -> the new contact is applied after 24 h, and the
 * OLD contact is told now with a cancel code. Returns the change record (or null on deny).
 */
async function reviewTicket(ctx, { ticketId, decision, reason }) {
  const { db, auth, nowMs } = ctx;
  const tRef = db.doc(`supportTickets/${ticketId}`);
  const t = await tRef.get();
  if (!t.exists || t.data().kind !== "recovery") throw new RecoveryError("not-found", "No such recovery ticket.");
  const ticket = t.data();
  if (decision !== "approve") {
    await tRef.update({ status: "solved", outcome: "denied", updatedAtMs: nowMs });
    await ctx.audit({ action: "recovery.review", target: ticket.uid || ticketId, before: { status: ticket.status }, after: { outcome: "denied", ticketId }, reason });
    return { ok: true, outcome: "denied" };
  }
  if (!ticket.uid) throw new RecoveryError("failed-precondition", "No account matched this request, so there is nothing to approve.");
  if (!ticket.newContact) throw new RecoveryError("failed-precondition", "The user hasn't verified a new email or phone with a code yet.");
  const user = await auth.getUser(ticket.uid);
  const isEmail = ticket.newContact.includes("@");
  const cancelCode = otp.newCode();
  const salt = crypto.randomBytes(8).toString("hex");
  const change = {
    uid: ticket.uid,
    ticketId,
    field: isEmail ? "email" : "phoneNumber",
    newValue: ticket.newContact,
    oldEmail: user.email || null,
    oldPhone: user.phoneNumber || null,
    executeAtMs: nowMs + CONTACT_CHANGE_DELAY_MS,
    status: "pending",
    cancelSalt: salt,
    cancelHash: otp.sha(`${salt}|${cancelCode}`),
    approvedBy: ctx.actor.uid,
    createdAtMs: nowMs,
  };
  const cRef = await db.collection("contactChanges").add(change);
  const text = `Someone asked to change the ${isEmail ? "email" : "phone number"} on your TrackLine account. If that was you, do nothing: it happens in 24 hours. If it wasn't you, open TrackLine > Sign in > Can't sign in? > "Cancel a change" and enter ${cancelCode} with reference ${cRef.id}.`;
  if (user.email) await notify.queueEmail(db, { to: user.email, subject: "A change to your TrackLine account", text, kind: "contact_change_notice", uid: user.uid, nowMs });
  if (user.phoneNumber) await notify.queueSms(db, { to: user.phoneNumber, body: text, kind: "contact_change_notice", uid: user.uid, nowMs });
  await tRef.update({ status: "waiting", outcome: "approved", contactChangeId: cRef.id, updatedAtMs: nowMs });
  await ctx.audit({ action: "recovery.review", target: ticket.uid, before: { email: user.email || null, phone: user.phoneNumber || null }, after: { outcome: "approved", field: change.field, newValue: change.newValue, executeAtMs: change.executeAtMs, ticketId }, reason });
  return { ok: true, outcome: "approved", changeId: cRef.id, executeAtMs: change.executeAtMs };
}

/**
 * Phone recovery through Firebase Phone Auth (Firebase sends the SMS): first count the request
 * against the same limits (3 a day per number and device), with no reply about the account.
 */
async function phoneStart({ db, data, ip, nowMs }) {
  const phone = normalisePhone(data.phone);
  if (!phone) throw new RecoveryError("invalid-argument", "Enter your full mobile number.");
  const deviceId = typeof data.deviceId === "string" ? data.deviceId.slice(0, 100) : "unknown";
  await countRequest(db, [[`acct|${phone}`, LIMITS.perAccountPerDay], [`dev|${deviceId}`, LIMITS.perDevicePerDay], [ipKey(ip), LIMITS.perIpPerDay]], nowMs);
  await db.collection("recoveryEvents").add({ kind: "phone_start", deviceId, ip: ip || null, atMs: nowMs });
  return { ok: true };
}

/**
 * After the user proved the number with Firebase's code (signed in by phone in the last 15
 * minutes) and maybe set a new password: sign out every other device, send the "password
 * changed" notice, and hand back a token so this phone stays signed in.
 */
async function afterPhoneReset({ db, auth, caller, nowMs }) {
  const t = caller && caller.token;
  if (!t || !t.firebase || t.firebase.sign_in_provider !== "phone") throw new RecoveryError("permission-denied", "Verify your number first.");
  if (typeof t.auth_time !== "number" || nowMs / 1000 - t.auth_time > 15 * 60) throw new RecoveryError("permission-denied", "That took too long. Start again.");
  const user = await auth.getUser(caller.uid);
  await auth.revokeRefreshTokens(caller.uid);
  await passwordChangedNotice(db, user, nowMs);
  await db.collection("recoveryEvents").add({ kind: "phone_reset", uid: caller.uid, atMs: nowMs });
  let customToken = null;
  try {
    customToken = await auth.createCustomToken(caller.uid);
  } catch (err) {
    console.error("afterPhoneReset: createCustomToken failed (needs the Service Account Token Creator role)", err);
  }
  return { ok: true, customToken };
}

/** The old contact cancels within 24 h with the code they were sent. */
async function cancelChange({ db, data, nowMs }) {
  const id = typeof data.changeId === "string" ? data.changeId : "";
  if (!id) throw new RecoveryError("invalid-argument", "Enter the reference from the message.");
  const ref = db.doc(`contactChanges/${id}`);
  const snap = await ref.get();
  const c = snap.exists ? snap.data() : null;
  const ok = c && c.status === "pending" && otp.sha(`${c.cancelSalt}|${String(data.code || "").trim()}`) === c.cancelHash;
  if (!ok) throw new RecoveryError("invalid-argument", "That reference and code don't match a change waiting to happen.");
  await ref.update({ status: "cancelled", cancelledAtMs: nowMs });
  await db.doc(`supportTickets/${c.ticketId}`).set({ status: "solved", outcome: "cancelled_by_old_contact", updatedAtMs: nowMs }, { merge: true });
  return { ok: true };
}

/** Runs due changes (scheduled): apply, sign out everywhere, then send a reset to the new contact. */
async function applyDueChanges(db, auth, nowMs) {
  const due = await db.collection("contactChanges").where("status", "==", "pending").where("executeAtMs", "<=", nowMs).limit(50).get();
  let applied = 0;
  for (const d of due.docs) {
    const c = d.data();
    const patch = c.field === "email" ? { email: c.newValue, emailVerified: true } : { phoneNumber: c.newValue };
    try {
      await auth.updateUser(c.uid, patch);
      await auth.revokeRefreshTokens(c.uid);
      if (c.field === "email") await notify.firebaseResetEmail(c.newValue);
      else await otp.issue(db, { purpose: "reset", uid: c.uid, channel: "sms", to: c.newValue, nowMs });
      await d.ref.update({ status: "applied", appliedAtMs: nowMs });
      await db.doc(`supportTickets/${c.ticketId}`).set({ status: "solved", updatedAtMs: nowMs }, { merge: true });
      applied++;
    } catch (err) {
      console.error("applyDueChanges failed", d.id, err);
      await d.ref.update({ status: "failed", error: String(err && err.message).slice(0, 200) });
    }
  }
  return applied;
}

module.exports = {
  LIMITS,
  GRANT_TTL_MS,
  CONTACT_CHANGE_DELAY_MS,
  GENERIC,
  RecoveryError,
  normaliseEmail,
  normalisePhone,
  underLimit,
  riskScore,
  start,
  verifyCode,
  resetWithGrant,
  newContactStart,
  newContactVerify,
  createTicket,
  reviewTicket,
  cancelChange,
  phoneStart,
  afterPhoneReset,
  applyDueChanges,
  passwordChangedNotice,
};
