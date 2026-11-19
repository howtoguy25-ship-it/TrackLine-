// Six-digit one-time codes, enforced on the server: valid 10 minutes, at most 5 tries, then a
// 15-minute cooldown for that contact. Codes are stored only as salted hashes.
//
//   otpCodes/{id}        one code: purpose, uid (null for a decoy), hashes, expiry, attempts
//   otpThrottle/{key}    per-contact cooldown (key = hash of the contact)
const crypto = require("crypto");
const notify = require("./notify");

const OTP = Object.freeze({ ttlMs: 10 * 60 * 1000, maxAttempts: 5, cooldownMs: 15 * 60 * 1000, digits: 6 });

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const contactKey = (to) => sha(`contact|${String(to).trim().toLowerCase()}`);

function newCode() {
  return String(crypto.randomInt(0, 10 ** OTP.digits)).padStart(OTP.digits, "0");
}

/**
 * The outcome of one try at a code. Pure.
 *   { ok: true } | { ok: false, reason: "invalid"|"expired"|"used"|"locked"|"cooldown", patch?, lockContact? }
 */
function checkAttempt(rec, code, throttle, nowMs) {
  if (!rec) return { ok: false, reason: "invalid" };
  if (throttle && (throttle.cooldownUntil || 0) > nowMs) return { ok: false, reason: "cooldown", until: throttle.cooldownUntil };
  if (rec.used) return { ok: false, reason: "used" };
  if (rec.attempts >= OTP.maxAttempts) return { ok: false, reason: "locked" };
  if (nowMs > rec.expiresAtMs) return { ok: false, reason: "expired" };
  const given = Buffer.from(sha(`${rec.salt}|${String(code || "").trim()}`), "hex");
  const want = Buffer.from(rec.codeHash, "hex");
  const match = rec.uid != null && given.length === want.length && crypto.timingSafeEqual(given, want);
  if (match) return { ok: true, patch: { used: true, usedAtMs: nowMs } };
  const attempts = rec.attempts + 1;
  if (attempts >= OTP.maxAttempts) return { ok: false, reason: "locked", patch: { attempts }, lockContact: true };
  return { ok: false, reason: "invalid", patch: { attempts }, attemptsLeft: OTP.maxAttempts - attempts };
}

function messageFor(purpose, code) {
  const what = { reset: "reset your TrackLine password", newContact: "confirm this contact for your TrackLine account", cancel: "cancel the change" }[purpose] || "continue";
  return `Your TrackLine code is ${code}. Use it to ${what}. It expires in 10 minutes. TrackLine staff will never ask you for this code.`;
}

/**
 * Creates a code and sends it. With uid null it's a decoy: stored and answered exactly like a
 * real one, but it can never verify (so "is there an account?" can't be learnt from the reply).
 * Returns { id, sent, cooldownUntil? }.
 */
async function issue(db, { purpose, uid, channel, to, nowMs, extra = {} }) {
  const key = contactKey(to);
  const throttle = await db.doc(`otpThrottle/${key}`).get();
  if (throttle.exists && (throttle.data().cooldownUntil || 0) > nowMs) {
    return { id: null, sent: false, cooldownUntil: throttle.data().cooldownUntil };
  }
  const code = newCode();
  const salt = crypto.randomBytes(16).toString("hex");
  const ref = db.collection("otpCodes").doc();
  await ref.set({
    purpose,
    uid: uid || null,
    channel,
    contactKey: key,
    salt,
    codeHash: sha(`${salt}|${code}`),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + OTP.ttlMs,
    attempts: 0,
    used: false,
    ...extra,
  });
  if (uid) {
    if (channel === "sms") await notify.queueSms(db, { to, body: messageFor(purpose, code), kind: `otp_${purpose}`, uid, nowMs });
    else await notify.queueEmail(db, { to, subject: "Your TrackLine code", text: messageFor(purpose, code), kind: `otp_${purpose}`, uid, nowMs });
  }
  return { id: ref.id, sent: true };
}

/** One try. Returns { ok, reason?, rec? } and stores attempts / cooldown. */
async function verify(db, { id, code, nowMs }) {
  if (typeof id !== "string" || !id) return { ok: false, reason: "invalid" };
  const ref = db.doc(`otpCodes/${id}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "invalid" };
    const rec = snap.data();
    const tRef = db.doc(`otpThrottle/${rec.contactKey}`);
    const t = await tx.get(tRef);
    const result = checkAttempt(rec, code, t.exists ? t.data() : null, nowMs);
    if (result.patch) tx.update(ref, result.patch);
    if (result.lockContact) tx.set(tRef, { cooldownUntil: nowMs + OTP.cooldownMs, lockedAtMs: nowMs }, { merge: true });
    return { ...result, rec: result.ok ? rec : undefined };
  });
}

module.exports = { OTP, checkAttempt, issue, verify, contactKey, newCode, sha, messageFor };
