// Owner dashboard + account recovery + guest data: every Cloud Function, wired up.
// index.js does Object.assign(exports, require("./admin").register(deps)).
//
// Dashboard sections (callable, staff only, role-checked per op, audited):
//   adminUsers adminMessages adminConfig adminModeration adminSupport adminInsights adminGovernance
// App-facing (any user, guests included; recovery works signed out):
//   accountRecovery helpTicket inboxEvent recordTrip
// Background: deliverSms, sendScheduledCampaigns, applyContactChanges, runPendingDeletions,
//   snapshotDailyStats, countNewAccount (guest -> account links: deviceSessions.linkedAt, set by the app)
const { makeStaffSection, BadInput } = require("./staff");
const { usersOps, deleteUserNow } = require("./users");
const { messagesOps, sendCampaign, recordInboxEvent, deliverToUser } = require("./messages");
const { configOps } = require("./appConfig");
const { moderationOps } = require("./moderation");
const { supportOps } = require("./support");
const { insightsOps, dayKey } = require("./insights");
const { governanceOps } = require("./governance");
const recovery = require("./recovery");
const notify = require("./notify");
const { flagText } = require("./profanity");

const BUSINESS_INFO = Object.freeze({ businessName: "TrackLine Maps", abn: "32 866 987 843" }); // web/src/config/business.ts

async function logOpsError(db, fn, err) {
  try {
    await db.collection("opsErrors").add({ fn, message: String((err && err.message) || err).slice(0, 300), atMs: Date.now() });
  } catch {
    /* logging must never throw */
  }
}

function register(deps) {
  const { onCall, onSchedule, onDocumentCreated, HttpsError, getFirestore, getAuth, FieldValue, defineSecret, reportStore, POLICY, jobs, TFNSW_API_KEY, authV1 } = deps;
  const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
  const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
  const TWILIO_FROM_NUMBER = defineSecret("TWILIO_FROM_NUMBER");
  const SENTRY_AUTH_TOKEN = defineSecret("SENTRY_AUTH_TOKEN");

  const section = makeStaffSection({ onCall, HttpsError, getFirestore, getAuth });
  const out = {};

  out.adminUsers = section(usersOps({ FieldValue, POLICY, deliverToUser }));
  out.adminMessages = section(messagesOps(), { timeoutSeconds: 300 });
  out.adminConfig = section(configOps());
  out.adminModeration = section(moderationOps({ reportStore, POLICY, encodeGeohash: require("../reports/core").encodeGeohash }));
  out.adminSupport = section(
    supportOps({
      anthropicKey: () => ANTHROPIC_API_KEY.value(),
      makeClient: (apiKey) => {
        const Anthropic = require("@anthropic-ai/sdk").default;
        return new Anthropic({ apiKey });
      },
    }),
    { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 }
  );
  out.adminInsights = section(
    insightsOps({
      sentry: () => ({ token: SENTRY_AUTH_TOKEN.value(), org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT }),
      jobs,
    }),
    { secrets: [SENTRY_AUTH_TOKEN, TFNSW_API_KEY], timeoutSeconds: 540 }
  );
  out.adminGovernance = section(governanceOps({ businessInfo: BUSINESS_INFO }));

  // ---- Account recovery (works signed out; same answer whether or not an account exists) ----
  const recoveryOps = {
    start: recovery.start,
    verify: recovery.verifyCode,
    reset: recovery.resetWithGrant,
    newContactStart: recovery.newContactStart,
    newContactVerify: recovery.newContactVerify,
    ticket: recovery.createTicket,
    cancelChange: recovery.cancelChange,
    phoneStart: recovery.phoneStart,
    afterPhoneReset: recovery.afterPhoneReset,
  };
  out.accountRecovery = onCall(async (request) => {
    const data = request.data || {};
    const fn = recoveryOps[data.op];
    if (!fn) throw new HttpsError("invalid-argument", "Unknown recovery step.");
    const { clientIp } = require("./audit");
    try {
      return await fn({ db: getFirestore(), auth: getAuth(), data, caller: request.auth || null, ip: clientIp(request.rawRequest), nowMs: Date.now() });
    } catch (err) {
      if (err instanceof recovery.RecoveryError) throw new HttpsError(err.code, err.message, { attemptsLeft: err.attemptsLeft ?? null, until: err.until ?? null });
      await logOpsError(getFirestore(), "accountRecovery", err);
      throw new HttpsError("internal", "Something went wrong. Try again in a minute.");
    }
  });

  // ---- Help tickets from the app (guests too) ----
  out.helpTicket = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Open the app again and retry.");
    const db = getFirestore();
    const uid = request.auth.uid;
    const data = request.data || {};
    const nowMs = Date.now();
    if (data.op === "create") {
      const subject = typeof data.subject === "string" ? data.subject.trim().slice(0, 120) : "";
      const text = typeof data.text === "string" ? data.text.trim().slice(0, 4000) : "";
      if (!subject || !text) throw new HttpsError("invalid-argument", "Add a subject and a message.");
      const recent = await db.collection("supportTickets").where("uid", "==", uid).where("createdAtMs", ">", nowMs - 24 * 60 * 60 * 1000).count().get();
      if (recent.data().count >= 5) throw new HttpsError("resource-exhausted", "You've sent 5 requests today. We'll reply to those first.");
      const ref = await db.collection("supportTickets").add({ kind: "help", status: "new", subject, firstText: text.slice(0, 300), uid, guest: request.auth.token.firebase?.sign_in_provider === "anonymous", flagged: flagText(text), appVersion: String(data.appVersion || "").slice(0, 20) || null, platform: String(data.platform || "").slice(0, 10) || null, createdAtMs: nowMs, updatedAtMs: nowMs, assignee: null });
      await db.collection(`supportTickets/${ref.id}/messages`).add({ from: "user", text, atMs: nowMs });
      return { ok: true, id: ref.id };
    }
    if (data.op === "list") {
      const snap = await db.collection("supportTickets").where("uid", "==", uid).limit(50).get();
      return { tickets: snap.docs.map((d) => ({ id: d.id, subject: d.data().subject, status: d.data().status, updatedAtMs: d.data().updatedAtMs })).sort((a, b) => b.updatedAtMs - a.updatedAtMs) };
    }
    if (data.op === "get" || data.op === "reply") {
      const id = typeof data.id === "string" ? data.id : "";
      const snap = id ? await db.doc(`supportTickets/${id}`).get() : null;
      if (!snap || !snap.exists || snap.data().uid !== uid) throw new HttpsError("not-found", "No such request.");
      if (data.op === "reply") {
        const text = typeof data.text === "string" ? data.text.trim().slice(0, 4000) : "";
        if (!text) throw new HttpsError("invalid-argument", "Write a message.");
        await db.collection(`supportTickets/${id}/messages`).add({ from: "user", text, atMs: nowMs });
        await snap.ref.update({ status: "new", updatedAtMs: nowMs });
      }
      const msgs = await db.collection(`supportTickets/${id}/messages`).orderBy("atMs").limit(200).get();
      return { ticket: { id, subject: snap.data().subject, status: snap.data().status }, messages: msgs.docs.map((d) => ({ from: d.data().from, text: d.data().text, atMs: d.data().atMs })) };
    }
    throw new HttpsError("invalid-argument", "Unknown help request.");
  });

  out.inboxEvent = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    try {
      return await recordInboxEvent(getFirestore(), FieldValue, request.auth.uid, request.data || {}, Date.now());
    } catch (err) {
      if (err instanceof BadInput) throw new HttpsError(err.code, err.message);
      throw err;
    }
  });

  // A finished drive, counted for the Overview (no route or place is sent).
  out.recordTrip = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const db = getFirestore();
    const nowMs = Date.now();
    const markRef = db.doc(`tripMarks/${request.auth.uid}`);
    const mark = await markRef.get();
    if (mark.exists && nowMs - mark.data().atMs < 2 * 60 * 1000) return { counted: false }; // one per 2 min
    await markRef.set({ atMs: nowMs });
    await db.doc(`statsDaily/${dayKey(nowMs)}`).set({ day: dayKey(nowMs), trips: FieldValue.increment(1) }, { merge: true });
    return { counted: true };
  });

  // ---- Background ----
  out.deliverSms = onDocumentCreated({ document: "smsOutbox/{id}", secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER] }, async (event) => {
    const data = event.data && event.data.data();
    if (!data || data.status !== "queued" || process.env.FUNCTIONS_EMULATOR === "true") return;
    const r = await notify.sendTwilio({ sid: TWILIO_ACCOUNT_SID.value(), token: TWILIO_AUTH_TOKEN.value(), from: TWILIO_FROM_NUMBER.value() }, data);
    await event.data.ref.update({ ...r, sentAtMs: Date.now(), body: r.status === "sent" ? "[sent]" : data.body });
  });

  out.sendScheduledCampaigns = onSchedule({ schedule: "every 5 minutes", timeoutSeconds: 300 }, async () => {
    const db = getFirestore();
    const nowMs = Date.now();
    const due = await db.collection("campaigns").where("status", "==", "scheduled").where("sendAtMs", "<=", nowMs).limit(10).get();
    for (const d of due.docs) {
      try {
        await sendCampaign(db, d.id, nowMs);
      } catch (err) {
        await logOpsError(db, "sendScheduledCampaigns", err);
        await d.ref.update({ status: "failed" });
      }
    }
  });

  out.applyContactChanges = onSchedule("every 15 minutes", async () => {
    try {
      await recovery.applyDueChanges(getFirestore(), getAuth(), Date.now());
    } catch (err) {
      await logOpsError(getFirestore(), "applyContactChanges", err);
    }
  });

  out.runPendingDeletions = onSchedule({ schedule: "every day 04:07", timeZone: "Australia/Sydney", timeoutSeconds: 540 }, async () => {
    const db = getFirestore();
    const due = await db.collection("pendingDeletions").where("executeAtMs", "<=", Date.now()).limit(50).get();
    for (const d of due.docs) {
      try {
        await deleteUserNow(db, getAuth(), d.id);
        await d.ref.delete();
        const reqs = await db.collection("dataRequests").where("uid", "==", d.id).where("kind", "==", "delete").get();
        for (const r of reqs.docs) await r.ref.update({ status: "completed", completedAtMs: Date.now() });
      } catch (err) {
        await logOpsError(db, "runPendingDeletions", err);
      }
    }
  });

  out.snapshotDailyStats = onSchedule({ schedule: "every day 23:50", timeZone: "Australia/Sydney" }, async () => {
    const db = getFirestore();
    const nowMs = Date.now();
    const sessions = db.collection("deviceSessions");
    const c = async (q) => (await q.count().get()).data().count;
    const day = dayKey(nowMs);
    const [active, guests, signedIn, reports, checks] = await Promise.all([
      c(sessions.where("lastActiveAt", ">", new Date(nowMs - 24 * 60 * 60 * 1000))),
      c(sessions.where("isAnonymous", "==", true)),
      c(sessions.where("isAnonymous", "==", false)),
      c(db.collection("alerts").where("createdAt", ">", new Date(nowMs - 24 * 60 * 60 * 1000))),
      c(db.collection("vehicleCheckPurchases").where("at", ">", nowMs - 24 * 60 * 60 * 1000)),
    ]);
    await db.doc(`statsDaily/${day}`).set({ day, active, guests, signedIn, reports, vehicleChecks: checks }, { merge: true });
  });

  if (authV1) {
    out.countNewAccount = authV1.user().onCreate(async (user) => {
      const db = getFirestore();
      const day = dayKey(Date.now());
      const field = user.providerData && user.providerData.length ? "newAccounts" : "newGuests";
      await db.doc(`statsDaily/${day}`).set({ day, [field]: FieldValue.increment(1) }, { merge: true });
    });
  }

  return out;
}

module.exports = { register, logOpsError, BUSINESS_INFO };
