// Where the full check keeps things (Admin SDK only; clients can read just their own reports
// and credit count -- firestore.rules):
//   users/{uid}/vehicleChecks/{reportId}  the report (the app watches it fill in, section by section)
//   vehicleCheckPurchases/{key}           one doc per verified purchase: which report it paid for
//   vehicleCheckCredits/{uid}             free re-checks owed ({ count, history[] })
//   vehicleCheckCache/{hash}              a complete result for 24 h (no owner data, just the car)
//   providerUsage/{autoId}                what each check cost

const crypto = require("crypto");

function cacheId(queryKey) {
  return crypto.createHash("sha256").update(queryKey).digest("hex");
}

/** `FieldValue` must come from the same firebase-admin copy as `db`. */
function firestoreStore(db, FieldValue) {
  const report = (uid, id) => db.doc(`users/${uid}/vehicleChecks/${id}`);
  return {
    async claimPurchase(key, data) {
      const ref = db.doc(`vehicleCheckPurchases/${key}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const v = snap.data();
          return { status: "used", reportId: v.reportId, uid: v.uid, outcome: v.outcome ?? null };
        }
        tx.create(ref, { ...data, outcome: null });
        return { status: "new" };
      });
    },
    async finishPurchase(key, patch) {
      await db.doc(`vehicleCheckPurchases/${key}`).set(patch, { merge: true });
    },
    async useCredit(uid, reportId) {
      const ref = db.doc(`vehicleCheckCredits/${uid}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = snap.exists ? snap.data().count ?? 0 : 0;
        if (count < 1) return false;
        tx.set(ref, { count: count - 1, history: FieldValue.arrayUnion({ used: reportId, at: Date.now() }) }, { merge: true });
        return true;
      });
    },
    async addCredit(uid, entry) {
      await db.doc(`vehicleCheckCredits/${uid}`).set({ count: FieldValue.increment(1), history: FieldValue.arrayUnion(entry) }, { merge: true });
    },
    async getCredits(uid) {
      const snap = await db.doc(`vehicleCheckCredits/${uid}`).get();
      return snap.exists ? snap.data().count ?? 0 : 0;
    },
    async getCache(queryKey, notBefore) {
      const snap = await db.doc(`vehicleCheckCache/${cacheId(queryKey)}`).get();
      if (!snap.exists) return null;
      const v = snap.data();
      return v.at >= notBefore ? v : null;
    },
    async setCache(queryKey, value) {
      await db.doc(`vehicleCheckCache/${cacheId(queryKey)}`).set(value);
    },
    async createReport(uid, id, doc) {
      await report(uid, id).set(doc);
    },
    async updateSection(uid, id, key, value) {
      await report(uid, id).update({ [`sections.${key}`]: value });
    },
    async finishReport(uid, id, patch) {
      await report(uid, id).set(patch, { merge: true });
    },
    async getReport(uid, id) {
      const snap = await report(uid, id).get();
      return snap.exists ? snap.data() : null;
    },
    async logUsage(entry) {
      await db.collection("providerUsage").add(entry);
    },
  };
}

module.exports = { firestoreStore, cacheId };
