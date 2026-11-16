// Vehicle full check, server side: the real modules in firebase/functions/vehicleCheck/, with
// provider HTTP answered from fixtures (see fixtures/vehicleCheck/README.md for where each one
// comes from) and an in-memory store. The last block runs the real Firestore store against
// the emulator when one is running.
const fs = require("fs");
const path = require("path");
const core = require("../functions/vehicleCheck/core");
const { availability } = require("../functions/vehicleCheck/providers");
const { mergeConfig } = require("../functions/vehicleCheck/config");
const { parseQuery } = require("../functions/vehicleCheck/query");
const { analyseOdometer } = require("../functions/vehicleCheck/grade");
const { parseCarJamXml } = require("../functions/vehicleCheck/carjamAu");

const FIX = path.join(__dirname, "fixtures", "vehicleCheck");
const fixture = (name) => fs.readFileSync(path.join(FIX, name), "utf8");

// ---- fakes ------------------------------------------------------------------------------------

function memoryStore() {
  const s = { purchases: {}, credits: {}, cache: {}, reports: {}, usage: [] };
  const rk = (uid, id) => `${uid}/${id}`;
  return {
    s,
    async claimPurchase(key, data) {
      if (s.purchases[key]) return { status: "used", ...s.purchases[key] };
      s.purchases[key] = { ...data, outcome: null };
      return { status: "new" };
    },
    async finishPurchase(key, patch) {
      Object.assign(s.purchases[key], patch);
    },
    async useCredit(uid) {
      if ((s.credits[uid] ?? 0) < 1) return false;
      s.credits[uid] -= 1;
      return true;
    },
    async addCredit(uid) {
      s.credits[uid] = (s.credits[uid] ?? 0) + 1;
    },
    async getCredits(uid) {
      return s.credits[uid] ?? 0;
    },
    async getCache(key, notBefore) {
      const v = s.cache[key];
      return v && v.at >= notBefore ? JSON.parse(JSON.stringify(v)) : null;
    },
    async setCache(key, v) {
      s.cache[key] = JSON.parse(JSON.stringify(v));
    },
    async createReport(uid, id, doc) {
      s.reports[rk(uid, id)] = JSON.parse(JSON.stringify(doc));
    },
    async updateSection(uid, id, key, value) {
      s.reports[rk(uid, id)].sections[key] = JSON.parse(JSON.stringify(value));
    },
    async finishReport(uid, id, patch) {
      Object.assign(s.reports[rk(uid, id)], patch);
    },
    async getReport(uid, id) {
      const r = s.reports[rk(uid, id)];
      return r ? JSON.parse(JSON.stringify(r)) : null;
    },
    async logUsage(e) {
      s.usage.push(e);
    },
  };
}

/** CarJam + BusinessAPI over fake HTTP. `carjam(queryType, params)` -> fixture name | number (HTTP status) | "throw". */
function fakeFetch({ carjam, ppsr = () => "ppsr_clean.json" }) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ host: u.host, path: u.pathname, params: Object.fromEntries(u.searchParams), method: init.method || "GET" });
    if (u.pathname.startsWith("/api/car-au")) {
      const r = carjam(u.searchParams.get("query_type"), Object.fromEntries(u.searchParams));
      if (r === "throw") throw new Error("ECONNRESET");
      if (typeof r === "number") return { ok: false, status: r, text: async () => "" };
      return { ok: true, status: 200, text: async () => fixture(r) };
    }
    if (u.host === "businessapi.com.au") {
      if (init.method === "POST") return { ok: true, status: 200, json: async () => ({ requestId: 77 }) };
      const r = ppsr();
      if (typeof r === "number") return { ok: false, status: r, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => JSON.parse(fixture(r)) };
    }
    throw new Error(`unexpected URL ${url}`);
  };
  fn.calls = calls;
  return fn;
}

const carjamFor = (vehicle) => (type, p) => {
  if (type === "VIND") return 404; // decoder not in the fixtures: the section must stand without it
  return `carjam_${vehicle}_${type}.xml`;
};

/** Readings for the in-test odometer adapter (no real odometer provider yet). */
function odometerAdapter(readings) {
  return () => ({
    name: "Test odometer source",
    costs: [{ provider: "Test odometer source", item: "odometer", amount: 0, currency: "AUD" }],
    async odometerHistory() {
      return { source: "Test odometer source", asAt: "2022-06-01", data: { readings } };
    },
  });
}

const CLEAN_READINGS = [
  { date: "2019-05-01", km: 21000 },
  { date: "2020-05-03", km: 34500 },
  { date: "2021-05-10", km: 47210 },
];

let verifyCalls;
function verifier({ sandbox = false, fail = false, key = "ios_2000000123" } = {}) {
  verifyCalls = 0;
  return async ({ platform, productIds }) => {
    verifyCalls++;
    if (fail) throw new Error("Apple purchase couldn't be verified (INVALID_JWT_FORMAT).");
    // Both price tiers pay for a check.
    expect(productIds).toEqual(["full_check", "full_check_2499"]);
    return { platform, key, transactionId: key.split("_")[1], productId: "full_check", sandbox };
  };
}

function deps(over = {}) {
  const fetchImpl = over.fetchImpl || fakeFetch({ carjam: carjamFor("TEST00") });
  return {
    store: over.store || memoryStore(),
    keys: { CARJAM_API_KEY: "test-key", PPSR_BUSINESSAPI_KEY: "test-key" },
    fetchImpl,
    verifyPurchase: over.verifyPurchase || verifier(),
    sleep: async () => {},
    now: over.now || (() => new Date("2022-06-01T02:00:00Z")),
    // PPSR via the integrated BusinessAPI adapter; odometer from the in-test adapter.
    configOverride: { ppsr: "businessapi", odometer: "testodo", ...(over.configOverride || {}) },
    extraAdapters: { testodo: odometerAdapter(over.readings || CLEAN_READINGS), ...(over.extraAdapters || {}) },
  };
}

const PLATE = { country: "AU", plate: "TEST00", state: "VIC" };
const BUY = { type: "purchase", platform: "ios", token: "eyJhbGciOiJFUzI1NiJ9.fake.jws" };
const run = (d, extra = {}) => core.runFullCheck({ uid: "u1", input: PLATE, payment: BUY, requestId: "req_000001", ...extra }, d);
const report = (d, id = "req_000001", uid = "u1") => d.store.s.reports[`${uid}/${id}`];
const carjamCalls = (d) => d.fetchImpl.calls.filter((c) => c.path.startsWith("/api/car-au")).length;

// ---- the recorded scenarios -------------------------------------------------------------------

describe("full check scenarios", () => {
  test("clean car: every section green, with source and data-as-at", async () => {
    const d = deps();
    const r = await run(d);
    expect(r).toEqual({ outcome: "complete", reportId: "req_000001" });
    const rep = report(d);
    expect(rep.status).toBe("complete");
    expect(rep.sections.vehicle).toMatchObject({ status: "ok", grade: "green", source: "CarJam", asAt: "2022-06-01" });
    expect(rep.sections.vehicle.data).toMatchObject({ make: "HYUNDAI", model: "I30", vin: "KMHH351EMKU00TEST" });
    expect(rep.sections.registration).toMatchObject({ grade: "green", data: { status: "REGISTERED", expiry: "2023-01-16", state: "VIC" } });
    expect(rep.sections.writtenOff).toMatchObject({ grade: "green", data: { writtenOff: false, records: [] } });
    expect(rep.sections.stolen).toMatchObject({ grade: "green", data: { stolen: false } });
    expect(rep.sections.ppsr).toMatchObject({ grade: "green", source: "PPSR via BusinessAPI", data: { securedInterests: 0, certificateUrl: "https://example.invalid/ppsr-certificate.pdf" } });
    expect(rep.sections.odometer).toMatchObject({ grade: "green", summary: "Latest reading 47,210 km (2021-05-10)" });
    expect(rep.sections.recalls).toMatchObject({ grade: "green", data: { recalls: [] } });
    expect(rep.sections.ppsr.recalls).toBeUndefined();
    // No owner names or addresses anywhere in the report.
    expect(JSON.stringify(rep)).not.toMatch(/owner|address|grantor|secured_party/i);
  });

  test("written-off + stolen (CarJam's TEST80): red, statutory, with date and reason; police ref not shown", async () => {
    const d = deps({ fetchImpl: fakeFetch({ carjam: carjamFor("TEST80") }) });
    await run(d, { input: { country: "AU", plate: "TEST80", state: "VIC" } });
    const rep = report(d);
    expect(rep.sections.writtenOff).toMatchObject({
      grade: "red",
      summary: "Statutory write-off recorded",
      data: { writtenOff: true, records: [{ category: "statutory", incident: "Statutory Write-off", reason: "Storm, Flood, Other Write-off", date: "2021-03-02", jurisdiction: "VIC" }] },
    });
    expect(rep.sections.stolen).toMatchObject({ grade: "red", data: { stolen: true, records: [{ type: "Plate", jurisdiction: "VIC", reportedDate: "2021-02-21" }] } });
    expect(JSON.stringify(rep)).not.toContain("REF-00789042100033645052");
    // TEST80 has no registration status in the docs -> amber, never guessed.
    expect(rep.sections.registration.grade).toBe("amber");
  });

  test("finance owing: PPSR security interests are red, with the certificate PDF", async () => {
    const d = deps({ fetchImpl: fakeFetch({ carjam: carjamFor("TEST00"), ppsr: () => "ppsr_finance_owing.json" }) });
    await run(d);
    expect(report(d).sections.ppsr).toMatchObject({ grade: "red", data: { securedInterests: 2, certificateUrl: "https://example.invalid/ppsr-certificate.pdf" } });
    // That provider sent no recalls: no recalls section rather than an empty "none".
    expect(report(d).sections.recalls).toBeUndefined();
  });

  test("odometer rollback: red, with the readings in date order and the latest one", async () => {
    const readings = [
      { date: "2021-05-10", km: 87210 },
      { date: "2019-05-01", km: 61000 },
      { date: "2022-04-02", km: 52340 },
    ];
    const d = deps({ readings });
    await run(d);
    expect(report(d).sections.odometer).toMatchObject({ grade: "red", summary: "Odometer went backwards: possible rollback" });
    const a = analyseOdometer(readings);
    expect(a.readings.map((r) => r.date)).toEqual(["2019-05-01", "2021-05-10", "2022-04-02"]);
    expect(a.latest).toMatchObject({ date: "2022-04-02", km: 52340 });
    expect(a.issues).toEqual([{ kind: "rollback", date: "2022-04-02", km: 52340, earlierKm: 87210, earlierDate: "2021-05-10" }]);
    expect(analyseOdometer([{ date: "2020-01-01", km: 1000 }, { date: "2020-01-02", km: 9000 }]).issues[0].kind).toBe("implausible");
    expect(analyseOdometer([]).latest).toBeNull();
  });

  test("not found: no report charged -- a free re-check credit, and the user is told", async () => {
    const d = deps({ fetchImpl: fakeFetch({ carjam: () => "carjam_not_found.xml" }) });
    const r = await run(d);
    expect(r.outcome).toBe("credited");
    expect(r.message).toMatch(/couldn't find that vehicle.*free re-check/i);
    expect(d.store.s.credits.u1).toBe(1);
    expect(report(d)).toMatchObject({ status: "credited", notFound: true });
    expect(d.store.s.purchases.ios_2000000123.outcome).toBe("credited");
    // Not found isn't retried (it isn't temporary), and nothing else is looked up after it.
    expect(carjamCalls(d)).toBe(1);
    expect(d.fetchImpl.calls).toHaveLength(1);
  });

  test("provider down: each section retried once, then the core failing gives a credit", async () => {
    const d = deps({ fetchImpl: fakeFetch({ carjam: () => 503, ppsr: () => 503 }) });
    const r = await run(d);
    expect(r.outcome).toBe("credited");
    expect(r.message).toMatch(/aren't answering.*free re-check/i);
    expect(d.store.s.credits.u1).toBe(1);
    // VDRSBC (shared by vehicle + registration), SC, WO: each tried, then retried once.
    const byType = {};
    for (const c of d.fetchImpl.calls.filter((c) => c.path.startsWith("/api/car-au"))) byType[c.params.query_type] = (byType[c.params.query_type] || 0) + 1;
    expect(byType.SC).toBe(2);
    expect(byType.WO).toBe(2);
    expect(byType.VDRSBC).toBeGreaterThanOrEqual(2);
  });

  test("a network error on one section: that section 'Couldn't load', retry is free and fixes it", async () => {
    let ppsrUp = false;
    const d = deps({ fetchImpl: fakeFetch({ carjam: carjamFor("TEST00"), ppsr: () => (ppsrUp ? "ppsr_clean.json" : 503) }) });
    expect((await run(d)).outcome).toBe("partial");
    expect(report(d).sections.ppsr).toMatchObject({ status: "failed", error: "Couldn't load", retries: 0 });
    // A partial report is never cached.
    expect(Object.keys(d.store.s.cache)).toHaveLength(0);

    const verifyBefore = verifyCalls;
    expect((await core.retrySection({ uid: "u1", reportId: "req_000001", section: "ppsr" }, d)).outcome).toBe("failed");
    ppsrUp = true;
    expect((await core.retrySection({ uid: "u1", reportId: "req_000001", section: "ppsr" }, d)).outcome).toBe("ok");
    expect(report(d).sections.ppsr.grade).toBe("green");
    expect(report(d).status).toBe("complete");
    // Free: no purchase verified, no credit used.
    expect(verifyCalls).toBe(verifyBefore);
    // Another user can't retry someone else's report.
    expect((await core.retrySection({ uid: "u2", reportId: "req_000001", section: "ppsr" }, d)).outcome).toBe("not_found");
  });

  test("retries are capped", async () => {
    const d = deps({ fetchImpl: fakeFetch({ carjam: carjamFor("TEST00"), ppsr: () => 503 }) });
    await run(d);
    for (let i = 0; i < 3; i++) expect((await core.retrySection({ uid: "u1", reportId: "req_000001", section: "ppsr" }, d)).outcome).toBe("failed");
    expect((await core.retrySection({ uid: "u1", reportId: "req_000001", section: "ppsr" }, d)).outcome).toBe("limit");
  });

  test("CarJam's error reply (no key) shows the section as BLOCKED, never as 'clear'", async () => {
    const d = deps({ fetchImpl: fakeFetch({ carjam: (t) => (t === "SC" ? "carjam_error.xml" : carjamFor("TEST00")(t)) }) });
    await run(d);
    expect(report(d).sections.stolen).toMatchObject({ status: "blocked" });
    expect(() => parseCarJamXml(fixture("carjam_error.xml"))).toThrow("Requires an API key");
  });
});

// ---- payment ----------------------------------------------------------------------------------

describe("receipt verification and no double charge", () => {
  test("an unverifiable purchase stops before any provider is called", async () => {
    const d = deps({ verifyPurchase: verifier({ fail: true }) });
    const r = await run(d);
    expect(r.outcome).toBe("invalid_purchase");
    expect(d.fetchImpl.calls).toHaveLength(0);
    expect(Object.keys(d.store.s.reports)).toHaveLength(0);
  });

  test("a sandbox (TestFlight) purchase runs only for the owner's admin account", async () => {
    const d = deps({ verifyPurchase: verifier({ sandbox: true }) });
    expect((await run(d)).outcome).toBe("invalid_purchase");
    expect(d.fetchImpl.calls).toHaveLength(0);
    expect((await run(d, { isAdmin: true })).outcome).toBe("complete");
  });

  test("the same purchase twice returns the same report: no second set of provider calls", async () => {
    const d = deps();
    const first = await run(d);
    const callsAfterFirst = d.fetchImpl.calls.length;
    const second = await run(d, { requestId: "req_000002" });
    expect(second).toEqual({ outcome: "complete", reportId: first.reportId });
    expect(d.fetchImpl.calls.length).toBe(callsAfterFirst);
    expect(Object.keys(d.store.s.reports)).toEqual(["u1/req_000001"]);
  });

  test("someone else's purchase can't be reused", async () => {
    const d = deps();
    await run(d);
    const r = await core.runFullCheck({ uid: "u2", input: PLATE, payment: BUY, requestId: "req_000009" }, d);
    expect(r.outcome).toBe("invalid_purchase");
  });

  test("a credit pays for exactly one re-check", async () => {
    const d = deps({ fetchImpl: fakeFetch({ carjam: () => "carjam_not_found.xml" }) });
    await run(d);
    expect(d.store.s.credits.u1).toBe(1);
    d.fetchImpl = fakeFetch({ carjam: carjamFor("TEST00") });
    const r = await core.runFullCheck({ uid: "u1", input: PLATE, payment: { type: "credit" }, requestId: "req_000003" }, d);
    expect(r.outcome).toBe("complete");
    expect(d.store.s.credits.u1).toBe(0);
    const again = await core.runFullCheck({ uid: "u1", input: PLATE, payment: { type: "credit" }, requestId: "req_000004" }, d);
    expect(again.outcome).toBe("no_credit");
  });
});

// ---- cache, cost log, country, availability ---------------------------------------------------

describe("cache, cost log, countries, availability", () => {
  test("a complete result is reused for 24 h (no provider cost), then fetched again", async () => {
    const d = deps();
    await run(d);
    const calls = d.fetchImpl.calls.length;
    d.verifyPurchase = verifier({ key: "ios_2000000999" });
    await run(d, { requestId: "req_000005" });
    expect(d.fetchImpl.calls.length).toBe(calls);
    expect(report(d, "req_000005")).toMatchObject({ status: "complete", fromCache: true });
    expect(d.store.s.usage[1]).toMatchObject({ fromCache: true, costs: [] });

    d.now = () => new Date("2022-06-02T03:00:00Z");
    d.verifyPurchase = verifier({ key: "ios_2000001000" });
    await run(d, { requestId: "req_000006" });
    expect(d.fetchImpl.calls.length).toBeGreaterThan(calls);
  });

  test("every check logs what it cost", async () => {
    const d = deps();
    await run(d);
    const items = d.store.s.usage[0].costs.map((c) => `${c.provider}:${c.item}:${c.amount}`);
    expect(items).toEqual(expect.arrayContaining(["CarJam:au_vdrsbc:5.35", "CarJam:au_sc:3.41", "CarJam:au_wo:3.41", "PPSR via BusinessAPI:ppsr_search:null"]));
    expect(d.store.s.usage[0]).toMatchObject({ uid: "u1", outcome: "complete", queryKey: "AU:plate:VIC:TEST00" });
  });

  test("outside Australia nothing is looked up; plates, states and VINs are validated", async () => {
    const d = deps();
    expect(await run(d, { input: { country: "NZ", plate: "ABC123", state: "VIC" } })).toEqual({ outcome: "invalid", reason: "not_available_in_country" });
    expect(verifyCalls).toBe(0);
    expect(d.fetchImpl.calls).toHaveLength(0);
    expect(parseQuery({ country: "AU", plate: "abc 123", state: "nsw" })).toMatchObject({ ok: true, query: { plate: "ABC123", state: "NSW" } });
    expect(parseQuery({ country: "AU", plate: "ABC123", state: "XX" }).reason).toBe("invalid_state");
    expect(parseQuery({ country: "AU", vin: "WAUZZZ8X4GB00TEST" }).ok).toBe(true);
    expect(parseQuery({ country: "AU", vin: "WAUZZZ8X4GB00TES" }).reason).toBe("invalid_vin");
    expect(parseQuery({ country: "AU", vin: "WAUZZZ8X4GB00TESO" }).reason).toBe("invalid_vin");
  });

  test("routing config: defaults, flat keys, price tiers, the on/off switch", () => {
    const defaults = mergeConfig(null);
    expect(defaults).toMatchObject({ enabled: false, priceTier: "19.99", productId: "full_check", priceAud: 19.99 });
    expect(defaults.providers).toEqual({ vehicleDetails: "carjam", rego: "carjam", stolen: "carjam", writtenOff: "carjam", ppsr: "aucn", odometerHistory: "aucn" });
    const c = mergeConfig({ details: "carjam", rego: "motorweb", ppsr: "PPSR", odometer: "equifax", priceTier: "24.99", enabled: true });
    expect(c).toMatchObject({ enabled: true, productId: "full_check_2499", priceAud: 24.99 });
    expect(c.providers).toMatchObject({ rego: "motorweb", ppsr: "ppsr", odometerHistory: "equifax" });
    // Unknown tier -> the default; enabled must be exactly true.
    expect(mergeConfig({ priceTier: "9.99", enabled: "yes" })).toMatchObject({ priceTier: "19.99", enabled: false });
  });

  test("not sold until switched on AND every section is real and keyed; BLOCKED reasons are exact", () => {
    const keys = { CARJAM_API_KEY: "k" };
    const off = availability(mergeConfig(null), keys);
    expect(off.available).toBe(false);
    expect(off.missing).toEqual([
      "switched off (config/vehicleCheck enabled is false)",
      "ppsr: AUCN_API_KEY not set",
      "odometer: AUCN_API_KEY not set",
    ]);
    expect(off.sections.vehicle).toEqual({ provider: "carjam", status: "ready" });
    // Key present but no adapter built yet: still BLOCKED.
    const aucnKeyed = availability(mergeConfig({ enabled: true }), { CARJAM_API_KEY: "k", AUCN_API_KEY: "k" });
    expect(aucnKeyed.sections.ppsr.status).toBe("BLOCKED: aucn adapter not built yet (needs their API docs)");
    expect(aucnKeyed.available).toBe(false);
    // A provider that doesn't cover a section can't be routed to it.
    expect(availability(mergeConfig({ details: "ppsr" }), {}).sections.vehicle.status).toBe("BLOCKED: ppsr doesn't cover vehicle");
    expect(availability(mergeConfig({ rego: "nope" }), {}).sections.registration.status).toBe('BLOCKED: unknown provider "nope"');
    // Placeholder values count as unset.
    expect(availability(mergeConfig(null), { CARJAM_API_KEY: "unset" }).sections.vehicle.status).toBe("BLOCKED: CARJAM_API_KEY not set");
    // Everything real + keyed + switched on: on sale.
    const ready = availability(mergeConfig({ enabled: true, ppsr: "businessapi", odometer: "carjam" }), { CARJAM_API_KEY: "k", PPSR_BUSINESSAPI_KEY: "k" });
    expect(ready.sections.odometer.status).toBe("BLOCKED: carjam doesn't cover odometer");
  });

  test("a section routed to a provider without its key answers BLOCKED with the reason, never data", async () => {
    const d = deps({ configOverride: { odometer: "equifax", ppsr: "aucn" } });
    await run(d);
    expect(report(d).sections.odometer).toEqual({ status: "blocked", reason: "Waiting for Equifax CarHistory: EQUIFAX_API_KEY isn't set." });
    expect(report(d).sections.ppsr).toEqual({ status: "blocked", reason: "Waiting for AUCN: AUCN_API_KEY isn't set." });
    expect(report(d).status).toBe("partial");
  });
});

// ---- the real Firestore store (emulator) ------------------------------------------------------

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
(onEmulator ? describe : describe.skip)("Firestore store (emulator)", () => {
  const admin = require("firebase-admin");
  const { firestoreStore } = require("../functions/vehicleCheck/store");
  let app;
  let db;
  beforeAll(() => {
    app = admin.initializeApp({ projectId: "demo-trackline-rules-test" }, "vehicle-check-store");
    db = app.firestore();
  });
  afterAll(() => app.delete());

  test("two simultaneous calls with one purchase: exactly one report, one set of provider calls", async () => {
    const store = firestoreStore(db, admin.firestore.FieldValue);
    const key = `ios_${Date.now()}`;
    const d = deps({ store, verifyPurchase: verifier({ key }) });
    const [a, b] = await Promise.all([
      core.runFullCheck({ uid: "fs-u1", input: PLATE, payment: BUY, requestId: "fsreq_000001" }, d),
      core.runFullCheck({ uid: "fs-u1", input: PLATE, payment: BUY, requestId: "fsreq_000002" }, d),
    ]);
    const ids = [a.reportId, b.reportId];
    expect(new Set(ids).size).toBe(1);
    const purchase = (await db.doc(`vehicleCheckPurchases/${key}`).get()).data();
    expect(purchase.reportId).toBe(ids[0]);
    const rep = (await db.doc(`users/fs-u1/vehicleChecks/${ids[0]}`).get()).data();
    expect(rep.sections.vehicle.data.make).toBe("HYUNDAI");
    const usage = await db.collection("providerUsage").where("reportId", "==", ids[0]).get();
    expect(usage.size).toBe(1);
  }, 30_000);

  test("credits are taken atomically", async () => {
    const store = firestoreStore(db, admin.firestore.FieldValue);
    await db.doc("vehicleCheckCredits/fs-u2").set({ count: 1 });
    const results = await Promise.all([store.useCredit("fs-u2", "r1"), store.useCredit("fs-u2", "r2")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.doc("vehicleCheckCredits/fs-u2").get()).data().count).toBe(0);
  }, 30_000);
});
