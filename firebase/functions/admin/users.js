// Dashboard > Users: search, profile, and the actions staff can take on an account. Every
// action needs a reason and is written to the audit log with before/after. Staff never see or
// set a password: a reset is always a link or code the user completes themselves.
const { requireReason, str, BadInput } = require("./staff");
const { maskEmail, maskPhone, maskRecord } = require("./mask");
const notify = require("./notify");
const otp = require("./otp");

const DAY = 24 * 60 * 60 * 1000;
const BAN_MS = { "1h": 60 * 60 * 1000, "24h": DAY, "7d": 7 * DAY };
const DELETE_UNDO_MS = 7 * DAY;
const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null);

function looksLikeEmail(q) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q);
}
function looksLikePhone(q) {
  return /^\+\d{8,15}$/.test(q.replace(/[\s-]/g, ""));
}

async function authUserOrNull(auth, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.code === "auth/user-not-found") return null;
    throw err;
  }
}

function accountRow(user, session, reporter) {
  const banUntil = reporter?.reportBanUntil || 0;
  return {
    uid: user?.uid || session?.uid,
    email: maskEmail(user?.email || null),
    phone: maskPhone(user?.phoneNumber || null),
    displayName: user?.displayName || null,
    guest: user ? user.providerData.length === 0 : !!session?.isAnonymous,
    disabled: !!user?.disabled,
    platform: session?.platform || null,
    country: session?.country || null,
    appVersion: session?.appVersion || null,
    createdAtMs: user ? Date.parse(user.metadata.creationTime) : ms(session?.firstOpenAt),
    lastActiveMs: ms(session?.lastActiveAt),
    trust: reporter?.trust ?? null,
    reportBanned: !!reporter?.reportBanPermanent || banUntil > Date.now(),
  };
}

/** Filters for the list view; pure so the tests can check each one. */
function matchesFilter(row, f = {}) {
  if (f.guest === true && !row.guest) return false;
  if (f.guest === false && row.guest) return false;
  if (f.platform && row.platform !== f.platform) return false;
  if (f.country && row.country !== f.country) return false;
  if (f.banned === true && !row.reportBanned) return false;
  if (typeof f.createdAfterMs === "number" && !(row.createdAtMs >= f.createdAfterMs)) return false;
  if (typeof f.createdBeforeMs === "number" && !(row.createdAtMs < f.createdBeforeMs)) return false;
  if (typeof f.minTrust === "number" && !(row.trust != null && row.trust >= f.minTrust)) return false;
  if (typeof f.maxTrust === "number" && !(row.trust != null && row.trust <= f.maxTrust)) return false;
  return true;
}

async function rowFor(ctx, uid) {
  const [user, session, reporter] = await Promise.all([
    authUserOrNull(ctx.auth, () => ctx.auth.getUser(uid)),
    ctx.db.doc(`deviceSessions/${uid}`).get(),
    ctx.db.doc(`reporterState/${uid}`).get(),
  ]);
  if (!user && !session.exists) return null;
  return accountRow(user, session.exists ? { uid, ...session.data() } : null, reporter.exists ? reporter.data() : null);
}

async function search(ctx) {
  const q = typeof ctx.data.q === "string" ? ctx.data.q.trim() : "";
  const filter = ctx.data.filter || {};
  const uids = new Set();
  if (q) {
    if (looksLikeEmail(q)) {
      const u = await authUserOrNull(ctx.auth, () => ctx.auth.getUserByEmail(q.toLowerCase()));
      if (u) uids.add(u.uid);
    } else if (looksLikePhone(q)) {
      const u = await authUserOrNull(ctx.auth, () => ctx.auth.getUserByPhoneNumber(q.replace(/[\s-]/g, "")));
      if (u) uids.add(u.uid);
    } else {
      if (/^[A-Za-z0-9]{20,40}$/.test(q)) {
        const u = await authUserOrNull(ctx.auth, () => ctx.auth.getUser(q));
        if (u) uids.add(u.uid);
      }
      // Display name (users/{uid}) or Tracky name (the name drivers see, presence/{uid}).
      const [byName, byTracky] = await Promise.all([
        ctx.db.collection("users").where("displayName", "==", q).limit(20).get(),
        ctx.db.collection("presence").where("displayName", "==", q).limit(20).get(),
      ]);
      byName.docs.forEach((d) => uids.add(d.id));
      byTracky.docs.forEach((d) => uids.add(d.id));
    }
    await ctx.audit({ action: "users.search", target: null, after: { query: looksLikeEmail(q) ? maskEmail(q) : looksLikePhone(q) ? maskPhone(q) : q.slice(0, 40) }, reason: "search" });
  } else {
    const snap = await ctx.db.collection("deviceSessions").orderBy("lastActiveAt", "desc").limit(300).get();
    snap.docs.forEach((d) => uids.add(d.id));
  }
  const rows = (await Promise.all([...uids].map((uid) => rowFor(ctx, uid)))).filter(Boolean).filter((r) => matchesFilter(r, filter));
  return { rows: rows.slice(0, 50), total: rows.length };
}

async function profile(ctx) {
  const uid = str(ctx.data, "uid");
  const user = await authUserOrNull(ctx.auth, () => ctx.auth.getUser(uid));
  const [session, devices, reporter, alerts, purchases, credits, checks, tickets, history, pendingDelete] = await Promise.all([
    ctx.db.doc(`deviceSessions/${uid}`).get(),
    ctx.db.collection(`deviceSessions/${uid}/devices`).orderBy("lastSeenAt", "desc").limit(20).get(),
    ctx.db.doc(`reporterState/${uid}`).get(),
    ctx.db.collection("alerts").where("createdBy", "==", uid).limit(100).get(),
    ctx.db.collection("vehicleCheckPurchases").where("uid", "==", uid).limit(50).get(),
    ctx.db.doc(`vehicleCheckCredits/${uid}`).get(),
    ctx.db.collection(`users/${uid}/vehicleChecks`).limit(50).get(),
    ctx.db.collection("supportTickets").where("uid", "==", uid).limit(50).get(),
    ctx.db.collection("auditLog").where("target", "==", uid).limit(100).get(),
    ctx.db.doc(`pendingDeletions/${uid}`).get(),
  ]);
  if (!user && !session.exists) throw new BadInput("No such user.", "not-found");
  const rep = reporter.exists ? reporter.data() : null;
  const reports = alerts.docs.map((d) => ({ id: d.id, type: d.data().type, item: d.data().item || null, confirmCount: d.data().confirmCount || 0, notThere: d.data().notThere || 0, createdAtMs: ms(d.data().createdAt) }));
  const confirmed = reports.filter((r) => r.confirmCount > 0).length;
  return {
    account: accountRow(user, session.exists ? { uid, ...session.data() } : null, rep),
    signInMethods: user ? user.providerData.map((p) => p.providerId) : ["anonymous"],
    role: user?.customClaims?.role || null,
    lastSignInMs: user?.metadata?.lastSignInTime ? Date.parse(user.metadata.lastSignInTime) : null,
    devices: devices.docs.map((d) => ({ id: d.id, model: d.data().model || null, os: d.data().os || null, appVersion: d.data().appVersion || null, lastSeenMs: ms(d.data().lastSeenAt) })),
    trust: rep?.trust ?? null,
    reportBan: rep ? { until: rep.reportBanUntil || 0, permanent: !!rep.reportBanPermanent } : null,
    reports: { total: reports.length, confirmed, accuracy: reports.length ? Math.round((confirmed / reports.length) * 100) : null, recent: reports.slice(0, 20) },
    purchases: purchases.docs.map((d) => ({ id: d.id, platform: d.data().platform, sandbox: !!d.data().sandbox, atMs: d.data().at || null, outcome: d.data().outcome || null })),
    vehicleChecks: checks.size,
    credits: credits.exists ? credits.data().count || 0 : 0,
    tickets: tickets.docs.map((d) => ({ id: d.id, subject: d.data().subject, status: d.data().status, kind: d.data().kind, createdAtMs: d.data().createdAtMs })),
    auditHistory: history.docs.map((d) => ({ id: d.id, at: d.data().at, action: d.data().action, actorEmail: d.data().actorEmail, reason: d.data().reason })).sort((a, b) => b.at - a.at),
    pendingDeletion: pendingDelete.exists ? { executeAtMs: pendingDelete.data().executeAtMs } : null,
  };
}

async function reveal(ctx) {
  const uid = str(ctx.data, "uid");
  const field = ctx.data.field === "phone" ? "phone" : "email";
  const reason = requireReason(ctx.data);
  const user = await ctx.auth.getUser(uid);
  await ctx.audit({ action: "users.reveal", target: uid, after: { field }, reason });
  return { value: field === "phone" ? user.phoneNumber || null : user.email || null };
}

async function passwordReset(ctx) {
  const uid = str(ctx.data, "uid");
  const reason = requireReason(ctx.data);
  const channel = ctx.data.channel === "sms" ? "sms" : "email";
  const user = await ctx.auth.getUser(uid);
  if (channel === "email") {
    if (!user.email) throw new BadInput("This account has no email address.");
    await notify.firebaseResetEmail(user.email);
  } else {
    if (!user.phoneNumber) throw new BadInput("This account has no phone number.");
    await otp.issue(ctx.db, { purpose: "reset", uid, channel: "sms", to: user.phoneNumber, nowMs: ctx.nowMs, ignoreCooldown: false });
  }
  await ctx.audit({ action: "users.passwordReset", target: uid, after: { channel }, reason });
  return { ok: true, message: channel === "email" ? "Reset link sent by Firebase to the account's email." : "Reset code sent by SMS." };
}

async function signOutAll(ctx) {
  const uid = str(ctx.data, "uid");
  const reason = requireReason(ctx.data);
  await ctx.auth.revokeRefreshTokens(uid);
  await ctx.audit({ action: "users.signOut", target: uid, after: { revoked: true }, reason });
  return { ok: true };
}

async function setDisabled(ctx) {
  const uid = str(ctx.data, "uid");
  const reason = requireReason(ctx.data);
  const disabled = !!ctx.data.disabled;
  const before = await ctx.auth.getUser(uid);
  await ctx.auth.updateUser(uid, { disabled });
  if (disabled) await ctx.auth.revokeRefreshTokens(uid);
  await ctx.audit({ action: "users.disable", target: uid, before: { disabled: before.disabled }, after: { disabled }, reason });
  return { ok: true, disabled };
}

/** The reporterState patch for a ban choice. Pure. */
function banPatch(duration, nowMs) {
  if (duration === "none") return { reportBanUntil: 0, reportBanPermanent: false };
  if (duration === "permanent") return { reportBanUntil: 0, reportBanPermanent: true };
  if (!BAN_MS[duration]) throw new BadInput("Ban length must be 1h, 24h, 7d, permanent, or none.");
  return { reportBanUntil: nowMs + BAN_MS[duration], reportBanPermanent: false };
}

async function reportBan(ctx) {
  const uid = str(ctx.data, "uid");
  const reason = requireReason(ctx.data);
  const patch = banPatch(ctx.data.duration, ctx.nowMs);
  const ref = ctx.db.doc(`reporterState/${uid}`);
  const before = await ref.get();
  await ref.set(patch, { merge: true });
  const b = before.exists ? before.data() : {};
  await ctx.audit({ action: "users.reportBan", target: uid, before: { reportBanUntil: b.reportBanUntil || 0, reportBanPermanent: !!b.reportBanPermanent }, after: patch, reason });
  return { ok: true, ...patch };
}

async function resetTrust(ctx, POLICY) {
  const uid = str(ctx.data, "uid");
  const reason = requireReason(ctx.data);
  const ref = ctx.db.doc(`reporterState/${uid}`);
  const before = await ref.get();
  await ref.set({ trust: POLICY.trust.start }, { merge: true });
  await ctx.audit({ action: "users.resetTrust", target: uid, before: { trust: before.exists ? before.data().trust ?? null : null }, after: { trust: POLICY.trust.start }, reason });
  return { ok: true, trust: POLICY.trust.start };
}

async function removeReport(ctx) {
  const alertId = str(ctx.data, "alertId");
  const reason = requireReason(ctx.data);
  const ref = ctx.db.doc(`alerts/${alertId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new BadInput("That report is already gone.", "not-found");
  await ref.delete();
  const a = snap.data();
  await ctx.audit({ action: "users.removeReport", target: a.createdBy || alertId, before: { alertId, type: a.type, item: a.item || null, lat: a.lat, lng: a.lng }, after: { removed: true }, reason });
  return { ok: true };
}

async function grantCredit(ctx, FieldValue) {
  const uid = str(ctx.data, "uid");
  const reason = requireReason(ctx.data);
  const count = Number(ctx.data.count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new BadInput("Grant 1 to 5 credits at a time.");
  const note = typeof ctx.data.note === "string" ? ctx.data.note.trim().slice(0, 300) : "";
  const ref = ctx.db.doc(`vehicleCheckCredits/${uid}`);
  const before = await ref.get();
  await ref.set({ count: FieldValue.increment(count), history: FieldValue.arrayUnion({ at: ctx.nowMs, reason: "staff_grant", by: ctx.actor.uid, count, note }) }, { merge: true });
  if (note) await ctx.db.collection("refundNotes").add({ uid, note, by: ctx.actor.uid, atMs: ctx.nowMs });
  const prior = before.exists ? before.data().count || 0 : 0;
  await ctx.audit({ action: "users.grantCredit", target: uid, before: { credits: prior }, after: { credits: prior + count, note }, reason });
  return { ok: true, credits: prior + count };
}

/** Which of `from`'s users/{uid} fields move to `into`: only ones `into` doesn't have. Pure. */
function mergeProfileFields(from = {}, into = {}) {
  const out = {};
  for (const [k, v] of Object.entries(from)) {
    if (["email", "phoneNumber", "provider", "mergedInto"].includes(k)) continue;
    if (into[k] === undefined) out[k] = v;
  }
  return out;
}

async function mergeAccounts(ctx, FieldValue) {
  const fromUid = str(ctx.data, "fromUid");
  const intoUid = str(ctx.data, "intoUid");
  const reason = requireReason(ctx.data);
  if (fromUid === intoUid) throw new BadInput("Pick two different accounts.");
  await Promise.all([ctx.auth.getUser(fromUid), ctx.auth.getUser(intoUid)]);
  const [fromDoc, intoDoc, fromCredits, checks] = await Promise.all([
    ctx.db.doc(`users/${fromUid}`).get(),
    ctx.db.doc(`users/${intoUid}`).get(),
    ctx.db.doc(`vehicleCheckCredits/${fromUid}`).get(),
    ctx.db.collection(`users/${fromUid}/vehicleChecks`).get(),
  ]);
  const moved = mergeProfileFields(fromDoc.exists ? fromDoc.data() : {}, intoDoc.exists ? intoDoc.data() : {});
  const batch = ctx.db.batch();
  batch.set(ctx.db.doc(`users/${intoUid}`), moved, { merge: true });
  checks.docs.forEach((d) => batch.set(ctx.db.doc(`users/${intoUid}/vehicleChecks/${d.id}`), d.data()));
  const credits = fromCredits.exists ? fromCredits.data().count || 0 : 0;
  if (credits > 0) {
    batch.set(ctx.db.doc(`vehicleCheckCredits/${intoUid}`), { count: FieldValue.increment(credits) }, { merge: true });
    batch.set(ctx.db.doc(`vehicleCheckCredits/${fromUid}`), { count: 0 }, { merge: true });
  }
  batch.set(ctx.db.doc(`users/${fromUid}`), { mergedInto: intoUid, mergedAtMs: ctx.nowMs }, { merge: true });
  await batch.commit();
  await ctx.auth.updateUser(fromUid, { disabled: true });
  await ctx.auth.revokeRefreshTokens(fromUid);
  await ctx.audit({ action: "users.merge", target: intoUid, before: { fromUid }, after: { movedFields: Object.keys(moved), vehicleChecks: checks.size, credits, fromDisabled: true }, reason });
  return { ok: true, movedFields: Object.keys(moved), vehicleChecks: checks.size, credits };
}

/** Everything stored about one user, for a privacy request. */
async function collectUserData(db, auth, uid) {
  const user = await authUserOrNull(auth, () => auth.getUser(uid));
  const read = async (path) => {
    const s = await db.doc(path).get();
    return s.exists ? maskRecord({ ...s.data(), expoPushToken: undefined }) : null;
  };
  const list = async (q) => (await q.get()).docs.map((d) => ({ id: d.id, ...maskRecord(d.data()) }));
  return {
    exportedAtMs: Date.now(),
    account: user
      ? { uid, email: user.email || null, phoneNumber: user.phoneNumber || null, displayName: user.displayName || null, providers: user.providerData.map((p) => p.providerId), created: user.metadata.creationTime }
      : { uid, guest: true },
    profile: await read(`users/${uid}`),
    device: await read(`deviceSessions/${uid}`),
    reporting: await read(`reporterState/${uid}`),
    vehicleCheckCredits: await read(`vehicleCheckCredits/${uid}`),
    vehicleChecks: await list(db.collection(`users/${uid}/vehicleChecks`)),
    inbox: await list(db.collection(`users/${uid}/inbox`)),
    reports: await list(db.collection("alerts").where("createdBy", "==", uid)),
    purchases: await list(db.collection("vehicleCheckPurchases").where("uid", "==", uid)),
    supportTickets: await list(db.collection("supportTickets").where("uid", "==", uid)),
  };
}

async function exportData(ctx) {
  const uid = str(ctx.data, "uid");
  const reason = requireReason(ctx.data);
  const data = await collectUserData(ctx.db, ctx.auth, uid);
  const req = await ctx.db.collection("dataRequests").add({ uid, kind: "export", status: "completed", requestedAtMs: ctx.nowMs, completedAtMs: Date.now(), by: ctx.actor.uid });
  await ctx.audit({ action: "users.exportData", target: uid, after: { dataRequest: req.id }, reason });
  return { ok: true, data };
}

async function scheduleDelete(ctx) {
  const uid = str(ctx.data, "uid");
  const reason = requireReason(ctx.data);
  const executeAtMs = ctx.nowMs + DELETE_UNDO_MS;
  const user = await authUserOrNull(ctx.auth, () => ctx.auth.getUser(uid));
  await ctx.db.doc(`pendingDeletions/${uid}`).set({ uid, executeAtMs, requestedAtMs: ctx.nowMs, by: ctx.actor.uid, wasDisabled: !!user?.disabled });
  if (user) {
    await ctx.auth.updateUser(uid, { disabled: true });
    await ctx.auth.revokeRefreshTokens(uid);
  }
  await ctx.db.collection("dataRequests").add({ uid, kind: "delete", status: "scheduled", requestedAtMs: ctx.nowMs, executeAtMs, by: ctx.actor.uid });
  await ctx.audit({ action: "users.delete", target: uid, before: { disabled: !!user?.disabled }, after: { scheduled: true, executeAtMs }, reason });
  return { ok: true, executeAtMs };
}

async function cancelDelete(ctx) {
  const uid = str(ctx.data, "uid");
  const reason = requireReason(ctx.data);
  const ref = ctx.db.doc(`pendingDeletions/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new BadInput("No deletion is scheduled for this account.", "not-found");
  await ref.delete();
  if (!snap.data().wasDisabled) await authUserOrNull(ctx.auth, () => ctx.auth.updateUser(uid, { disabled: false }));
  await ctx.audit({ action: "users.delete", target: uid, before: { scheduled: true, executeAtMs: snap.data().executeAtMs }, after: { scheduled: false, cancelled: true }, reason });
  return { ok: true };
}

/** Deletes one user's data and account (run by runPendingDeletions after the 7 days). */
async function deleteUserNow(db, auth, uid) {
  const deleteQuery = async (q) => {
    const snap = await q.get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = db.batch();
      snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  };
  await deleteQuery(db.collection(`users/${uid}/vehicleChecks`));
  await deleteQuery(db.collection(`users/${uid}/inbox`));
  await deleteQuery(db.collection(`deviceSessions/${uid}/devices`));
  await deleteQuery(db.collection("alerts").where("createdBy", "==", uid));
  for (const p of [`users/${uid}`, `deviceSessions/${uid}`, `reporterState/${uid}`, `vehicleCheckCredits/${uid}`, `presence/${uid}`, `presencePending/${uid}`, `userData/${uid}`]) {
    await db.doc(p).delete();
  }
  await authUserOrNull(auth, () => auth.deleteUser(uid));
}

function usersOps({ FieldValue, POLICY, deliverToUser }) {
  return {
    search: { perm: "users.read", run: search },
    profile: { perm: "users.read", run: profile },
    reveal: { perm: "users.reveal", run: reveal },
    passwordReset: { perm: "users.passwordReset", run: passwordReset },
    signOut: { perm: "users.signOut", run: signOutAll },
    setDisabled: { perm: "users.disable", run: setDisabled },
    reportBan: { perm: "users.reportBan", run: reportBan },
    resetTrust: { perm: "users.resetTrust", run: (ctx) => resetTrust(ctx, POLICY) },
    removeReport: { perm: "users.removeReport", run: removeReport },
    grantCredit: { perm: "users.grantCredit", run: (ctx) => grantCredit(ctx, FieldValue) },
    merge: { perm: "users.merge", run: (ctx) => mergeAccounts(ctx, FieldValue) },
    exportData: { perm: "users.exportData", run: exportData },
    delete: { perm: "users.delete", run: scheduleDelete },
    cancelDelete: { perm: "users.delete", run: cancelDelete },
    message: {
      perm: "users.message",
      run: async (ctx) => {
        const uid = str(ctx.data, "uid");
        const reason = requireReason(ctx.data);
        const title = str(ctx.data, "title", { max: 80 });
        const body = str(ctx.data, "body", { max: 600 });
        const id = await deliverToUser(ctx.db, uid, { title, body, channel: "inbox", category: "account", from: "support", nowMs: ctx.nowMs });
        await ctx.audit({ action: "users.message", target: uid, after: { title, inboxId: id }, reason });
        return { ok: true, id };
      },
    },
  };
}

module.exports = { usersOps, matchesFilter, banPatch, mergeProfileFields, collectUserData, deleteUserNow, DELETE_UNDO_MS, BAN_MS };
