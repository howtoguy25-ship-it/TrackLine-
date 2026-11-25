// Firestore side of reports/core.js. FieldValue/Timestamp are passed in so the tests can use
// their own firebase-admin copy (see vehicleCheck/store.js for why).
const { alertFromPending, applyVote, clampTrust, newReporterState, moderate } = require("./core");

const STATE = "reporterState";
const PENDING = "pendingReports";
const ALERTS = "alerts";
const SCORES_COL = "scores";
const { applyScore } = require("./scores");

const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : 0);

function firestoreReportStore(db, { FieldValue, Timestamp }) {
  const ts = (m) => Timestamp.fromMillis(m);
  return {
    async transact(uid, fn) {
      const ref = db.collection(STATE).doc(uid);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const result = fn(snap.exists ? snap.data() : newReporterState());
        tx.set(ref, result.state);
        return result;
      });
    },
    async nearby(at, type) {
      const { encodeGeohash } = require("./core");
      const prefix = encodeGeohash(at.lat, at.lng, 5);
      const snap = await db.collection(ALERTS).where("geohash", ">=", prefix).where("geohash", "<", `${prefix}~`).limit(300).get();
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.type === type)
        .map((a) => ({ id: a.id, type: a.type, item: a.item, lat: a.lat, lng: a.lng, createdBy: a.createdBy, expiresAtMs: ms(a.expiresAt) }));
    },
    async createPending(p) {
      const ref = await db.collection(PENDING).add({ ...p, publishAt: ts(p.publishAtMs) });
      return ref.id;
    },
    async getPending(id) {
      if (typeof id !== "string" || !id) return null;
      const snap = await db.collection(PENDING).doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async deletePending(id) {
      await db.collection(PENDING).doc(id).delete();
    },
    /** A second report of the same thing counts as that driver saying "Still here". */
    async mergeInto(alertId, uid, nowMs) {
      const alertRef = db.collection(ALERTS).doc(alertId);
      const voteRef = alertRef.collection("votes").doc(uid);
      await db.runTransaction(async (tx) => {
        const v = await tx.get(voteRef);
        if (v.exists) return;
        tx.set(voteRef, { vote: "confirm", at: ts(nowMs) });
        tx.update(alertRef, { confirmCount: FieldValue.increment(1) });
      });
    },
    /** After the undo window: the pending report becomes a live alert (same id), unless undone. */
    async publish(pendingId) {
      const pendingRef = db.collection(PENDING).doc(pendingId);
      const alertRef = db.collection(ALERTS).doc(pendingId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(pendingRef);
        if (!snap.exists) return false;
        const p = snap.data();
        // Points for the reporter (reports/scores.js): read before any write, as transactions need.
        const scoreRef = db.collection(SCORES_COL).doc(p.uid);
        const scoreSnap = await tx.get(scoreRef);
        const a = alertFromPending(p);
        const { createdAtMs, expiresAtMs, lastConfirmedAtMs, ...rest } = a;
        tx.set(alertRef, { ...rest, createdAt: ts(createdAtMs), expiresAt: ts(expiresAtMs), lastConfirmedAt: ts(lastConfirmedAtMs) });
        tx.delete(pendingRef);
        tx.set(scoreRef, applyScore(scoreSnap.exists ? scoreSnap.data() : null, "reportPublished", p.publishAtMs || Date.now(), p.reporterName || null));
        return true;
      });
    },
    /** A vote doc was written: extend / count / remove, and adjust the reporter's trust. */
    async applyVote(alertId, voterUid, vote, nowMs) {
      const alertRef = db.collection(ALERTS).doc(alertId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(alertRef);
        if (!snap.exists) return "gone";
        const d = snap.data();
        if (d.createdBy === voterUid) return "own";
        const stateRef = db.collection(STATE).doc(d.createdBy);
        const stateSnap = await tx.get(stateRef);
        const reporterScoreRef = db.collection(SCORES_COL).doc(d.createdBy);
        const voterScoreRef = db.collection(SCORES_COL).doc(voterUid);
        const [reporterScore, voterScore] = await Promise.all([tx.get(reporterScoreRef), tx.get(voterScoreRef)]);
        const alert = { type: d.type, item: d.item, permanent: !!d.permanent, confirmCount: d.confirmCount || 0, createdAtMs: ms(d.createdAt), expiresAtMs: ms(d.expiresAt), notThere: d.notThere || 0 };
        const r = applyVote(alert, vote, nowMs);
        if (r.action === "delete") tx.delete(alertRef);
        else if (r.action === "update") {
          const { expiresAtMs, lastConfirmedAtMs, approvedAtMs: _a, ...plain } = r.patch;
          tx.update(alertRef, {
            ...plain,
            ...(expiresAtMs ? { expiresAt: ts(expiresAtMs) } : {}),
            ...(lastConfirmedAtMs ? { lastConfirmedAt: ts(lastConfirmedAtMs) } : {}),
          });
        }
        const state = stateSnap.exists ? stateSnap.data() : newReporterState();
        tx.set(stateRef, { ...state, trust: clampTrust((state.trust ?? 50) + r.trustDelta) });
        // Points: the voter for helping, the reporter when confirmed (or less when it's removed).
        tx.set(voterScoreRef, applyScore(voterScore.exists ? voterScore.data() : null, "vote", nowMs));
        const reporterEvent = vote === "confirm" ? "confirmedByOther" : r.action === "delete" ? "reportRemoved" : null;
        if (reporterEvent) tx.set(reporterScoreRef, applyScore(reporterScore.exists ? reporterScore.data() : null, reporterEvent, nowMs));
        return r.action;
      });
    },
    /** Fixed cameras / road features still waiting for confirmations (the admin queue). */
    async moderationQueue(limit = 100) {
      const snap = await db.collection(ALERTS).where("awaitingApproval", "==", true).limit(limit).get();
      return snap.docs
        .map((d) => {
          const a = d.data();
          return { id: d.id, type: a.type, item: a.item, lat: a.lat, lng: a.lng, comment: a.comment || null, confirmCount: a.confirmCount || 0, denyCount: a.denyCount || 0, createdAtMs: ms(a.createdAt) };
        })
        .sort((a, b) => a.createdAtMs - b.createdAtMs);
    },
    async moderate(alertId, approve, adminUid, nowMs) {
      const ref = db.collection(ALERTS).doc(alertId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return "gone";
        const d = snap.data();
        const r = moderate({ type: d.type, item: d.item }, approve, nowMs);
        if (r.action === "delete") tx.delete(ref);
        else if (r.action === "update") {
          tx.update(ref, { permanent: true, awaitingApproval: false, expiresAt: ts(r.patch.expiresAtMs), approvedAt: ts(nowMs), approvedBy: adminUid });
        }
        tx.set(db.collection("moderationLog").doc(), { alertId, item: d.item || null, approve: !!approve, by: adminUid, at: ts(nowMs) });
        return r.action;
      });
    },
  };
}

module.exports = { firestoreReportStore };
