// Fix pass 7 §1 (server): smart exit gates. The pure rules (siteExitsCore), the Firestore rules
// (drivers read, nobody writes directly) and the answerSiteExit / admin functions on the real
// emulators.
jest.setTimeout(30_000);
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");
const { initializeApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, signInAnonymously } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const admin = require("firebase-admin");
const core = require("../functions/siteExitsCore");

const PROJECT_ID = "demo-trackline-rules-test";
const T = Date.UTC(2026, 10, 24, 9);

describe("siteExitsCore", () => {
  test("answers are checked: an OSM gate node, open or closed, a known time bucket, a position", () => {
    const ok = core.parseAnswer({ gateId: "n123", siteId: "w456", open: false, bucket: "weekend-day", lat: -33.9, lng: 151, label: "Vanessa St" });
    expect(ok).toMatchObject({ gateId: "n123", siteId: "w456", open: false, bucket: "weekend-day" });
    expect(core.parseAnswer({ gateId: "../x", open: true, bucket: "weekday-day", lat: 0, lng: 0 }).error).toMatch(/exit/);
    expect(core.parseAnswer({ gateId: "n1", open: "yes", bucket: "weekday-day", lat: 0, lng: 0 }).error).toMatch(/open/);
    expect(core.parseAnswer({ gateId: "n1", open: true, bucket: "lunch", lat: 0, lng: 0 }).error).toMatch(/time/);
    expect(core.BUCKETS).toHaveLength(10);
  });

  test("buckets: weekday / weekend x night, morning, day, afternoon, evening (local time)", () => {
    expect(core.bucketFor(new Date(2026, 10, 24, 8))).toBe("weekday-morning"); // Tuesday 8 am
    expect(core.bucketFor(new Date(2026, 10, 28, 20))).toBe("weekend-evening"); // Saturday 8 pm
    expect(core.bucketFor(new Date(2026, 10, 25, 3))).toBe("weekday-night");
  });

  test("3 agreeing answers at that time make a pattern; the same driver counts once; old answers drop out", () => {
    const a = (voter, open, bucket = "weekend-day") => ({ gateId: "n1", siteId: "w1", lat: -33.9, lng: 151, label: null, voter, open, bucket });
    let d = core.applyAnswer(null, a("v1", false), T);
    d = core.applyAnswer(d, a("v2", false), T + 60_000);
    expect(d.patterns["weekend-day"].state).toBe("unknown");
    // The same driver again within 6 h: still one answer.
    d = core.applyAnswer(d, a("v2", false), T + 120_000);
    expect(d.answers).toHaveLength(2);
    d = core.applyAnswer(d, a("v3", false), T + 180_000);
    expect(d.patterns["weekend-day"]).toEqual({ state: "closed", open: 0, closed: 3 });
    expect(d.summary).toMatch(/Closed/);
    // Another time bucket is unaffected.
    expect(d.patterns["weekday-day"]).toBeUndefined();
    // Mixed answers: no pattern.
    let m = null;
    for (const [v, o] of [["a", true], ["b", false], ["c", true], ["d", false]]) m = core.applyAnswer(m, a(v, o, "weekday-evening"), T);
    expect(m.patterns["weekday-evening"].state).toBe("unknown");
    // 61 days later they no longer count.
    d = core.applyAnswer(d, a("v9", true, "weekday-morning"), T + core.WINDOW_MS + 200_000);
    expect(d.patterns["weekend-day"]).toBeUndefined();
  });

  test("whole weekends closed read as 'Closed weekends'", () => {
    const patterns = {};
    for (const b of ["night", "morning", "day", "afternoon", "evening"]) patterns[`weekend-${b}`] = { state: "closed", open: 0, closed: 3 };
    expect(core.summarise(patterns)).toBe("Closed weekends");
  });

  test("voters are anonymous: a hash, different per exit", () => {
    expect(core.voterKey("uid-1", "n1")).toMatch(/^[0-9a-f]{16}$/);
    expect(core.voterKey("uid-1", "n1")).not.toBe(core.voterKey("uid-1", "n2"));
    expect(core.voterKey("uid-1", "n1")).not.toContain("uid-1");
  });
});

describe("Firestore rules: siteExits", () => {
  let testEnv;
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
    });
  });
  afterAll(async () => {
    await testEnv.cleanup();
  });
  test("a signed-in driver can read an exit; nobody can write one directly", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "siteExits/n42"), { gateId: "n42", answers: [] });
    });
    const driver = testEnv.authenticatedContext("driver-1").firestore();
    await assertSucceeds(getDoc(doc(driver, "siteExits/n42")));
    await assertFails(setDoc(doc(driver, "siteExits/n42"), { patterns: { "weekday-day": { state: "closed" } } }));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "siteExits/n42")));
  });
});

describe("answerSiteExit / admin functions (emulator)", () => {
  let app;
  let auth;
  let functions;
  let adminApp;
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID, apiKey: "fake-api-key" }, "site-exits-client");
    auth = getAuth(app);
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
    functions = getFunctions(app);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    adminApp = admin.initializeApp({ projectId: PROJECT_ID }, "site-exits-admin");
  });
  afterAll(async () => {
    await adminApp.delete();
  });
  const answer = (open, extra = {}) => httpsCallable(functions, "answerSiteExit")({ gateId: "n9001", siteId: "w77", open, bucket: "weekday-evening", lat: -33.9, lng: 151.0, label: "Vanessa St", ...extra });

  test("signed out: refused", async () => {
    await auth.signOut();
    await expect(answer(false)).rejects.toMatchObject({ code: "functions/unauthenticated" });
  });

  test("three drivers say closed: stored anonymously, the pattern says closed", async () => {
    for (let i = 0; i < 3; i++) {
      await auth.signOut();
      await signInAnonymously(auth);
      const res = await answer(false);
      if (i === 2) expect(res.data.pattern).toEqual({ state: "closed", open: 0, closed: 3 });
    }
    const snap = await adminApp.firestore().doc("siteExits/n9001").get();
    const d = snap.data();
    expect(d.answers).toHaveLength(3);
    for (const a of d.answers) expect(Object.keys(a).sort()).toEqual(["atMs", "bucket", "open", "voter"]);
    expect(JSON.stringify(d)).not.toContain(auth.currentUser.uid);
  });

  test("a bad answer is refused", async () => {
    await signInAnonymously(auth);
    await expect(answer(true, { gateId: "abc" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });

  test("the dashboard list and hours are staff-only (adminModeration section)", async () => {
    await signInAnonymously(auth);
    await expect(httpsCallable(functions, "adminModeration")({ op: "siteExits" })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(httpsCallable(functions, "adminModeration")({ op: "setSiteExitHours", gateId: "n9001", hours: "Mon-Fri 6am-6pm", reason: "x" })).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
});
