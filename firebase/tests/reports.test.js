// Driver reports, server side (functions/reports/): anti-spam, duplicate merge, trust, the 3 s
// undo window, and "Still here" / "Not there" votes. Pure rules with an in-memory store first,
// then the real Firestore store against the emulator when one is running.
const core = require("../functions/reports/core");
const { POLICY } = core;

const MIN = 60_000;
const SYD = { lat: -33.8688, lng: 151.2093 };
const near = (m) => ({ lat: SYD.lat + m / 111_320, lng: SYD.lng });
const input = (over = {}) => ({ type: "police", at: near(100), from: SYD, region: "NSW", ...over });

function memoryStore() {
  const s = { states: {}, pending: {}, alerts: {}, votes: {}, next: 1 };
  return {
    s,
    async transact(uid, fn) {
      const r = fn(s.states[uid]);
      s.states[uid] = r.state;
      return r;
    },
    async nearby(at, type) {
      return Object.entries(s.alerts).filter(([, a]) => a.type === type).map(([id, a]) => ({ id, ...a }));
    },
    async createPending(p) {
      const id = `p${s.next++}`;
      s.pending[id] = p;
      return id;
    },
    async getPending(id) {
      return s.pending[id] ?? null;
    },
    async deletePending(id) {
      delete s.pending[id];
    },
    async mergeInto(alertId, uid) {
      s.votes[`${alertId}/${uid}`] = "confirm";
    },
  };
}

describe("anti-spam", () => {
  test("a report must be within 1 km of where the driver is", async () => {
    const store = memoryStore();
    await expect(core.submit(store, { uid: "u", data: input({ at: near(1500) }), nowMs: 0 })).rejects.toMatchObject({ code: "too-far" });
    await expect(core.submit(store, { uid: "u", data: input({ at: near(900) }), nowMs: 0 })).resolves.toMatchObject({ merged: false });
  });

  test("bad type, bad region, missing position are refused", async () => {
    const store = memoryStore();
    await expect(core.submit(store, { uid: "u", data: input({ type: "aliens" }), nowMs: 0 })).rejects.toMatchObject({ code: "bad-type" });
    await expect(core.submit(store, { uid: "u", data: input({ region: "XX" }), nowMs: 0 })).rejects.toMatchObject({ code: "bad-region" });
    await expect(core.submit(store, { uid: "u", data: input({ from: null }), nowMs: 0 })).rejects.toMatchObject({ code: "bad-position" });
  });

  test("10 an hour", () => {
    let state;
    const out = [];
    for (let i = 0; i < 11; i++) {
      // spaced 3 min apart so the burst rule doesn't fire
      const r = core.decide({ uid: "u", input: input({ at: near(i * 50) }), state, nearby: [], nowMs: i * 3 * MIN });
      state = r.state;
      out.push(r.decision.action === "reject" ? r.decision.code : "ok");
    }
    expect(out.slice(0, 10).every((x) => x === "ok")).toBe(true);
    expect(out[10]).toBe("hourly-limit");
  });

  test("30 a day", () => {
    let state;
    let last;
    for (let i = 0; i < 31; i++) {
      const r = core.decide({ uid: "u", input: input(), state, nearby: [], nowMs: i * 7 * MIN });
      state = r.state;
      last = r.decision;
    }
    expect(last).toMatchObject({ action: "reject", code: "daily-limit" });
  });

  test("a burst blocks for 15 minutes, a second burst within a day for 24 hours", () => {
    let state;
    let d;
    for (let i = 0; i < POLICY.burst.count; i++) ({ state, decision: d } = core.decide({ uid: "u", input: input(), state, nearby: [], nowMs: i * 10_000 }));
    expect(d).toMatchObject({ code: "blocked" });
    expect(d.until).toBe(3 * 10_000 + 15 * MIN);
    // still blocked 14 min later
    expect(core.decide({ uid: "u", input: input(), state, nearby: [], nowMs: 14 * MIN }).decision.code).toBe("blocked");
    // after the block: allowed again; a new burst -> 24 h
    let t = 20 * MIN;
    for (let i = 0; i < POLICY.burst.count; i++) ({ state, decision: d } = core.decide({ uid: "u", input: input(), state, nearby: [], nowMs: (t += 5_000) }));
    expect(d.code).toBe("blocked");
    expect(d.until - t).toBe(24 * 60 * MIN);
  });

  test("the same thing already on the map is merged (counts as Still here), not duplicated", async () => {
    const store = memoryStore();
    store.s.alerts.a1 = { type: "police", ...near(150), createdBy: "other", expiresAtMs: 10 * MIN };
    const r = await core.submit(store, { uid: "u", data: input({ at: near(120) }), nowMs: 0 });
    expect(r).toEqual({ merged: true, alertId: "a1" });
    expect(store.s.votes["a1/u"]).toBe("confirm");
    expect(Object.keys(store.s.pending)).toHaveLength(0);
  });

  test("your own duplicate is refused; a different type or an expired one is a new report", async () => {
    const store = memoryStore();
    store.s.alerts.a1 = { type: "police", ...near(100), createdBy: "u", expiresAtMs: 10 * MIN };
    await expect(core.submit(store, { uid: "u", data: input(), nowMs: 0 })).rejects.toMatchObject({ code: "duplicate" });
    await expect(core.submit(store, { uid: "u", data: input({ type: "hazard" }), nowMs: 1 })).resolves.toMatchObject({ merged: false });
    await expect(core.submit(store, { uid: "u", data: input(), nowMs: 11 * MIN })).resolves.toMatchObject({ merged: false });
  });

  test("a low-trust reporter's report needs confirmation", () => {
    const low = { ...core.newReporterState(), trust: POLICY.trust.needsConfirmationBelow - 1 };
    expect(core.decide({ uid: "u", input: input(), state: low, nearby: [], nowMs: 0 }).decision).toEqual({ action: "create", needsConfirmation: true });
    expect(core.decide({ uid: "u", input: input(), state: undefined, nearby: [], nowMs: 0 }).decision).toEqual({ action: "create", needsConfirmation: false });
  });

  test("the server computes the map cell itself", () => {
    const v = core.validateInput({ ...input(), geohash: "zzzzzzzzz" });
    expect(v.geohash).toBe(core.encodeGeohash(near(100).lat, near(100).lng, 9));
    expect(core.encodeGeohash(-33.8688, 151.2093, 5)).toBe("r3gx2");
  });
});

describe("3 s undo", () => {
  test("held as pending for 3 s, undone inside it; it doesn't count towards the limits", async () => {
    const store = memoryStore();
    const r = await core.submit(store, { uid: "u", data: input(), nowMs: 1000 });
    expect(r.publishAtMs).toBe(1000 + POLICY.undoSeconds * 1000);
    await expect(core.undo(store, { uid: "u", pendingId: r.pendingId, nowMs: 3000 })).resolves.toEqual({ undone: true });
    expect(store.s.pending[r.pendingId]).toBeUndefined();
    expect(store.s.states.u.log).toEqual([]);
  });

  test("too late after 3 s; someone else's can't be undone", async () => {
    const store = memoryStore();
    const r = await core.submit(store, { uid: "u", data: input(), nowMs: 0 });
    await expect(core.undo(store, { uid: "x", pendingId: r.pendingId, nowMs: 1000 })).rejects.toMatchObject({ code: "not-found" });
    await expect(core.undo(store, { uid: "u", pendingId: r.pendingId, nowMs: 3001 })).rejects.toMatchObject({ code: "too-late" });
  });

  test("at most 2 undos in a rolling hour", async () => {
    const store = memoryStore();
    const results = [];
    for (let i = 0; i < 3; i++) {
      const t = i * 10 * MIN;
      const r = await core.submit(store, { uid: "u", data: input({ type: ["police", "hazard", "crash"][i] }), nowMs: t });
      results.push(await core.undo(store, { uid: "u", pendingId: r.pendingId, nowMs: t + 1000 }).then(() => "undone", (e) => e.code));
    }
    expect(results).toEqual(["undone", "undone", "undo-limit"]);
    // an hour after the first: allowed again
    const r = await core.submit(store, { uid: "u", data: input({ type: "camera" }), nowMs: 61 * MIN });
    await expect(core.undo(store, { uid: "u", pendingId: r.pendingId, nowMs: 61 * MIN + 500 })).resolves.toEqual({ undone: true });
  });

  test("published alert: the type's lifetime, a custom lifetime capped at the type's maximum", () => {
    const p = { uid: "u", type: "police", lat: 1, lng: 2, geohash: "g", region: "NSW", publishAtMs: 1000, needsConfirmation: false };
    expect(core.alertFromPending(p).expiresAtMs).toBe(1000 + 45 * MIN);
    expect(core.alertFromPending({ ...p, customTtlMs: 10 * 24 * 60 * MIN }).expiresAtMs).toBe(1000 + 180 * MIN);
    expect(core.alertFromPending(p)).toMatchObject({ createdBy: "u", confirmCount: 0, denyCount: 0, notThere: 0 });
  });
});

describe("Still here / Not there", () => {
  const alert = { type: "police", createdAtMs: 0, expiresAtMs: 45 * MIN, notThere: 0 };
  test("Still here extends by the type's time, never past its maximum life", () => {
    expect(core.applyVote(alert, "confirm", 40 * MIN).patch.expiresAtMs).toBe(60 * MIN);
    expect(core.applyVote({ ...alert, expiresAtMs: 175 * MIN }, "confirm", 170 * MIN).patch.expiresAtMs).toBe(180 * MIN);
    expect(core.applyVote(alert, "confirm", 1).patch).toMatchObject({ needsConfirmation: false, notThere: 0 });
  });
  test("removed after 2 Not there in a row; a Still here in between resets the run", () => {
    const one = core.applyVote(alert, "deny", 1);
    expect(one).toMatchObject({ action: "update", patch: { notThere: 1 } });
    expect(core.applyVote({ ...alert, notThere: 1 }, "deny", 2).action).toBe("delete");
    const reset = core.applyVote({ ...alert, notThere: 1 }, "confirm", 3);
    expect(reset.patch.notThere).toBe(0);
  });
  test("trust moves with the votes and stays in range", () => {
    expect(core.applyVote(alert, "confirm", 1).trustDelta).toBe(POLICY.trust.confirmed);
    expect(core.applyVote(alert, "deny", 1).trustDelta).toBe(POLICY.trust.notThere);
    expect(core.applyVote({ ...alert, notThere: 1 }, "deny", 1).trustDelta).toBe(POLICY.trust.removed);
    expect(core.clampTrust(150)).toBe(100);
    expect(core.clampTrust(-5)).toBe(0);
  });
  test("every type has a window, an extension and a maximum life", () => {
    for (const [type, t] of Object.entries(POLICY.types)) {
      expect([type, t.askAfterMinutes > 0 && t.extendMinutes > 0 && t.maxLifeMinutes >= t.lifetimeMinutes]).toEqual([type, true]);
    }
  });
});

// ---- the real Firestore store (emulator) ------------------------------------------------------

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
(onEmulator ? describe : describe.skip)("report store (emulator)", () => {
  const admin = require("firebase-admin");
  const { firestoreReportStore } = require("../functions/reports/store");
  let app;
  let db;
  let store;
  beforeAll(() => {
    app = admin.initializeApp({ projectId: "demo-trackline-rules-test" }, "report-store");
    db = app.firestore();
    store = firestoreReportStore(db, { FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp });
  });
  afterAll(() => app.delete());

  test("submit -> pending -> publish puts the alert on the map under the same id", async () => {
    const r = await core.submit(store, { uid: "rs-u1", data: input(), nowMs: Date.now() });
    expect((await db.doc(`pendingReports/${r.pendingId}`).get()).exists).toBe(true);
    expect(await store.publish(r.pendingId)).toBe(true);
    const a = (await db.doc(`alerts/${r.pendingId}`).get()).data();
    expect(a).toMatchObject({ type: "police", createdBy: "rs-u1", region: "NSW", confirmCount: 0 });
    expect(a.expiresAt.toMillis() - a.createdAt.toMillis()).toBe(45 * MIN);
    expect((await db.doc(`pendingReports/${r.pendingId}`).get()).exists).toBe(false);
  }, 30_000);

  test("an undone report is never published", async () => {
    const now = Date.now();
    const r = await core.submit(store, { uid: "rs-u2", data: input({ type: "hazard" }), nowMs: now });
    await core.undo(store, { uid: "rs-u2", pendingId: r.pendingId, nowMs: now + 1000 });
    expect(await store.publish(r.pendingId)).toBe(false);
    expect((await db.doc(`alerts/${r.pendingId}`).get()).exists).toBe(false);
  }, 30_000);

  test("a second driver's report of the same thing merges; two Not there remove it; trust moves", async () => {
    const now = Date.now();
    const r = await core.submit(store, { uid: "rs-u3", data: input({ type: "crash", at: near(300) }), nowMs: now });
    await store.publish(r.pendingId);
    const merged = await core.submit(store, { uid: "rs-u4", data: input({ type: "crash", at: near(320) }), nowMs: now + 5000 });
    expect(merged).toEqual({ merged: true, alertId: r.pendingId });
    expect((await db.doc(`alerts/${r.pendingId}/votes/rs-u4`).get()).data().vote).toBe("confirm");
    expect(await store.applyVote(r.pendingId, "rs-u4", "confirm", now + 5000)).toBe("update");
    expect(await store.applyVote(r.pendingId, "rs-u3", "deny", now + 6000)).toBe("own"); // never the reporter
    expect(await store.applyVote(r.pendingId, "rs-u5", "deny", now + 7000)).toBe("update");
    expect(await store.applyVote(r.pendingId, "rs-u6", "deny", now + 8000)).toBe("delete");
    expect((await db.doc(`alerts/${r.pendingId}`).get()).exists).toBe(false);
    const trust = (await db.doc("reporterState/rs-u3").get()).data().trust;
    expect(trust).toBe(POLICY.trust.start + POLICY.trust.confirmed + POLICY.trust.notThere + POLICY.trust.removed);
  }, 30_000);

  test("limits hold under concurrent submits (transaction)", async () => {
    const now = Date.now();
    const types = ["police", "hazard", "crash", "camera", "traffic_light", "emergency_vehicle"];
    const results = await Promise.allSettled(types.map((type, i) => core.submit(store, { uid: "rs-u7", data: input({ type, at: near(i * 100) }), nowMs: now + i })));
    // a burst of 6 inside 2 min: the first 3 go through, then the burst block
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(POLICY.burst.count - 1);
    const state = (await db.doc("reporterState/rs-u7").get()).data();
    expect(state.blockUntil).toBeGreaterThan(now);
  }, 30_000);
});

// ---- every item reportable; fixed features become permanent ------------------------------------

describe("items", () => {
  test("every item is filed under its base type; a mismatched or unknown item is refused", () => {
    for (const [item, p] of Object.entries(POLICY.items)) {
      const d = core.decide({ uid: "u", input: { ...input({ type: p.type }), item, comment: "words here" }, state: undefined, nearby: [], nowMs: 0 }).decision;
      expect([item, d.action]).toEqual([item, "create"]);
    }
    expect(core.decide({ uid: "u", input: { ...input({ type: "police" }), item: "speedBump" }, state: undefined, nearby: [], nowMs: 0 }).decision.code).toBe("bad-type");
    expect(core.decide({ uid: "u", input: { ...input(), item: "nonsense" }, state: undefined, nearby: [], nowMs: 0 }).decision.code).toBe("bad-type");
  });

  test("a map chat needs words", () => {
    expect(core.decide({ uid: "u", input: { ...input({ type: "hazard" }), item: "mapChats" }, state: undefined, nearby: [], nowMs: 0 }).decision.code).toBe("needs-comment");
  });

  test("duplicates are per item: a speed bump next to a pothole report is its own report", () => {
    const nearby = [{ id: "a1", type: "hazard", item: "otherHazards", ...near(110), createdBy: "x", expiresAtMs: 10 * MIN }];
    expect(core.decide({ uid: "u", input: { ...input({ type: "hazard" }), item: "speedBump" }, state: undefined, nearby, nowMs: 0 }).decision.action).toBe("create");
    expect(core.decide({ uid: "u", input: { ...input({ type: "hazard" }), item: "otherHazards" }, state: undefined, nearby, nowMs: 0 }).decision).toEqual({ action: "merge", alertId: "a1" });
  });

  test("temporary items use their own lifetime; fixed ones wait 30 days for confirmation", () => {
    const p = { uid: "u", type: "hazard", lat: 1, lng: 2, geohash: "g", region: "NSW", publishAtMs: 0 };
    expect(core.alertFromPending({ ...p, item: "roadwork" }).expiresAtMs).toBe(720 * MIN);
    expect(core.alertFromPending({ ...p, item: "animals" }).expiresAtMs).toBe(60 * MIN);
    const bump = core.alertFromPending({ ...p, item: "speedBump", customTtlMs: 5 * MIN });
    expect(bump).toMatchObject({ item: "speedBump", awaitingApproval: true, permanent: false, expiresAtMs: POLICY.fixed.pendingLifetimeMinutes * MIN });
    expect(core.alertFromPending({ ...p, type: "police" })).toMatchObject({ item: "police", awaitingApproval: false });
  });

  test("a fixed feature becomes permanent at 3 confirmations, not before", () => {
    const a = { type: "camera", item: "stopSignCamera", createdAtMs: 0, expiresAtMs: 30 * 24 * 60 * MIN, notThere: 0, permanent: false };
    expect(core.applyVote({ ...a, confirmCount: 2 }, "confirm", 1000).patch.permanent).toBeUndefined();
    const r = core.applyVote({ ...a, confirmCount: 3 }, "confirm", 1000);
    expect(r.patch).toMatchObject({ permanent: true, awaitingApproval: false });
    expect(r.patch.expiresAtMs).toBeGreaterThan(1000 + 19 * 365 * 24 * 60 * MIN);
    // a permanent one removed after two Not there in a row (the camera was taken down)
    expect(core.applyVote({ ...a, permanent: true, notThere: 1 }, "deny", 2000).action).toBe("delete");
  });

  test("admin approval makes it permanent; rejection removes it; temporary items aren't moderated", () => {
    expect(core.moderate({ type: "hazard", item: "narrowBridge" }, true, 5).patch).toMatchObject({ permanent: true, awaitingApproval: false, approvedAtMs: 5 });
    expect(core.moderate({ type: "hazard", item: "narrowBridge" }, false, 5).action).toBe("delete");
    expect(core.moderate({ type: "police", item: "police" }, true, 5).action).toBe("none");
  });
});

describe("crash history records", () => {
  const crashRecords = require("../functions/crashRecords");
  test("official crash incidents become records; other incidents don't", () => {
    const r = crashRecords.recordsFromIncidents(
      [
        { id: "1", kind: "incident", category: "Crash", headline: "Crash - two cars", lat: -33.8, lng: 151.1 },
        { id: "2", kind: "incident", category: "Breakdown", headline: "Broken down vehicle", lat: -33.8, lng: 151.1 },
        { id: "3", kind: "roadwork", category: "Roadwork", headline: "Roadwork", lat: -33.8, lng: 151.1 },
      ],
      0
    );
    expect(r.map((x) => x.id)).toEqual(["ltn_1"]);
    expect(r[0]).toMatchObject({ source: "liveTrafficNsw", geohash: core.encodeGeohash(-33.8, 151.1, 7) });
  });
  test("a driver's crash report is kept only if someone else confirmed it", () => {
    expect(crashRecords.recordFromAlert("a", { type: "crash", lat: 1, lng: 2, confirmCount: 1 }, 0)).toMatchObject({ id: "drv_a", source: "drivers" });
    expect(crashRecords.recordFromAlert("a", { type: "crash", lat: 1, lng: 2, confirmCount: 0 }, 0)).toBeNull();
    expect(crashRecords.recordFromAlert("a", { type: "police", lat: 1, lng: 2, confirmCount: 5 }, 0)).toBeNull();
  });
});

(onEmulator ? describe : describe.skip)("moderation store (emulator)", () => {
  const admin = require("firebase-admin");
  const { firestoreReportStore } = require("../functions/reports/store");
  let app;
  let db;
  let store;
  beforeAll(() => {
    app = admin.initializeApp({ projectId: "demo-trackline-rules-test" }, "moderation-store");
    db = app.firestore();
    store = firestoreReportStore(db, { FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp });
  });
  afterAll(() => app.delete());

  test("a reported fixed feature is in the queue until approved, then stays", async () => {
    const now = Date.now();
    const r = await core.submit(store, { uid: "mq-u1", data: { ...input({ type: "camera", at: near(600) }), item: "busLaneCamera" }, nowMs: now });
    await store.publish(r.pendingId);
    const queue = await store.moderationQueue();
    expect(queue.find((q) => q.id === r.pendingId)).toMatchObject({ item: "busLaneCamera", type: "camera" });
    expect(await store.moderate(r.pendingId, true, "admin-1", now + 1000)).toBe("update");
    const a = (await db.doc(`alerts/${r.pendingId}`).get()).data();
    expect(a).toMatchObject({ permanent: true, awaitingApproval: false, approvedBy: "admin-1" });
    expect((await store.moderationQueue()).find((q) => q.id === r.pendingId)).toBeUndefined();
    const log = await db.collection("moderationLog").where("alertId", "==", r.pendingId).get();
    expect(log.size).toBe(1);
  }, 30_000);
});
