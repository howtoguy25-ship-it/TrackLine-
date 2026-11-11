// Real Cloud Functions tests for the presence/Ghost-mode system (Part 2/3), run against the
// actual compiled firebase/functions/index.js via the real Functions + Firestore + Auth
// emulators -- not mocks. Seeding/verification uses the Admin SDK (pointed at the emulator via
// FIRESTORE_EMULATOR_HOST, set by jest.setup.js / the emulators:exec wrapper), and the calls
// themselves go through the real `firebase/functions` client SDK signed in against the real
// Auth emulator, exactly how the mobile app itself calls these functions.
const { initializeApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, signInAnonymously } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const admin = require("firebase-admin");

const PROJECT_ID = "demo-trackline-rules-test";

let app;
let auth;
let functions;
let adminApp;
let adminDb;

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID, apiKey: "fake-api-key" });
  auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  functions = getFunctions(app);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  adminApp = admin.initializeApp({ projectId: PROJECT_ID }, "admin-test-app");
  adminDb = adminApp.firestore();
});

afterAll(async () => {
  await adminApp.delete();
});

async function signInNewAnonymousUser() {
  // signInAnonymously returns the SAME user if one is already signed in anonymously -- sign out
  // first so every test really does get its own driver (the server correctly refuses points
  // older than ones it has already buffered for a uid, so shared state breaks later tests).
  await auth.signOut();
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}

// Two real fixes ~60m apart, taken `olderAgeMs` and `newerAgeMs` ago -- the shape the mobile
// client actually sends (see MapScreen.tsx's 15s sampler).
function samplesAged(olderAgeMs, newerAgeMs, base = { lat: -33.8688, lng: 151.2093 }) {
  return [
    { lat: base.lat, lng: base.lng, ageMs: olderAgeMs },
    { lat: base.lat - 0.0003, lng: base.lng + 0.0006, ageMs: newerAgeMs },
  ];
}

describe("updatePresence", () => {
  test("rejects an unauthenticated call", async () => {
    await auth.signOut();
    const call = httpsCallable(functions, "updatePresence");
    await expect(call({ samples: samplesAged(90000, 75000), speedKmh: 30 })).rejects.toBeTruthy();
  });

  test("rejects a batch with fewer than 2 samples", async () => {
    await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    await expect(call({ samples: [{ lat: -33.87, lng: 151.21, ageMs: 0 }], speedKmh: 30 })).rejects.toBeTruthy();
  });

  test("withdraws presence AND the pending buffer, and returns not_driving, below 15km/h", async () => {
    const uid = await signInNewAnonymousUser();
    await adminDb.doc(`presence/${uid}`).set({ lat: -33.87, lng: 151.21, headingDeg: 0, mood: "happy", updatedAt: new Date() });
    await adminDb.doc(`presencePending/${uid}`).set({ points: [{ lat: -33.87, lng: 151.21, t: Date.now() }] });

    const call = httpsCallable(functions, "updatePresence");
    const res = await call({ samples: samplesAged(15000, 0), speedKmh: 5, mood: "happy", allowName: false });

    expect(res.data.outcome).toBe("not_driving");
    expect((await adminDb.doc(`presence/${uid}`).get()).exists).toBe(false);
    expect((await adminDb.doc(`presencePending/${uid}`).get()).exists).toBe(false);
  });

  test("PRIVACY DELAY: fresh samples are buffered privately and NOT published", async () => {
    const uid = await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    const res = await call({ samples: samplesAged(15000, 0), speedKmh: 42, mood: "happy", allowName: false });

    expect(res.data.outcome).toBe("buffering");
    // Nothing readable by other drivers exists yet...
    expect((await adminDb.doc(`presence/${uid}`).get()).exists).toBe(false);
    // ...but the points are really being held server-side, not dropped.
    const pending = await adminDb.doc(`presencePending/${uid}`).get();
    expect(pending.exists).toBe(true);
    expect(pending.data().points.length).toBeGreaterThanOrEqual(2);
  });

  test("PRIVACY DELAY: only points at least 60s old are ever published", async () => {
    const uid = await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    const before = Date.now();
    // One sample 90s old (publishable) and one taken just now (must stay private).
    const res = await call({
      samples: samplesAged(90000, 0),
      headingDeg: 180,
      speedKmh: 42,
      mood: "excited",
      allowName: true,
    });

    expect(res.data.outcome).toBe("success");
    const snap = await adminDb.doc(`presence/${uid}`).get();
    expect(snap.exists).toBe(true);
    const data = snap.data();
    expect(Array.isArray(data.path)).toBe(true);
    expect(data.path.length).toBeGreaterThanOrEqual(1);
    for (const p of data.path) {
      expect(p.t).toBeLessThanOrEqual(before - 60000 + 2000);
    }
    expect(data.lat).toBe(data.path[data.path.length - 1].lat);
    expect(data.mood).toBe("excited");
    expect(typeof data.w).toBe("number");
    // allowName:true but an anonymous sign-in has no `name` claim on its auth token --
    // displayName must be omitted entirely, never written as an empty string.
    expect(data.displayName).toBeUndefined();
    expect(data.expireAt).toBeTruthy();

    // The just-now sample is still held back in the private buffer.
    const pending = await adminDb.doc(`presencePending/${uid}`).get();
    expect(pending.data().points.some((p) => p.t > before - 60000)).toBe(true);
  });

  test("a second call a moment later extends the published path instead of replacing it", async () => {
    const uid = await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    await call({ samples: samplesAged(150000, 135000), speedKmh: 42, mood: "happy", allowName: false });
    const first = (await adminDb.doc(`presence/${uid}`).get()).data().path.length;
    await call({
      samples: samplesAged(105000, 90000, { lat: -33.8694, lng: 151.2105 }),
      speedKmh: 42,
      mood: "happy",
      allowName: false,
    });
    const second = (await adminDb.doc(`presence/${uid}`).get()).data().path;
    expect(second.length).toBeGreaterThan(first);
    // Strictly time-ordered -- viewers interpolate along this.
    for (let i = 1; i < second.length; i++) expect(second[i].t).toBeGreaterThan(second[i - 1].t);
  });

  test("an unknown mood key is replaced with 'happy'", async () => {
    const uid = await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    await call({ samples: samplesAged(90000, 75000), speedKmh: 42, mood: "not-a-real-mood", allowName: false });
    expect((await adminDb.doc(`presence/${uid}`).get()).data().mood).toBe("happy");
  });

  test("a custom Tracky look is whitelisted field by field before other drivers can see it", async () => {
    const uid = await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    await call({
      samples: samplesAged(90000, 75000),
      speedKmh: 42,
      mood: "happy",
      allowName: false,
      look: {
        color: "#2DD4BF",
        eyeStyle: "heart",
        mouthStyle: "grin",
        accessory: "cap",
        accessoryColor: "javascript:alert(1)",
        trail: "<script>",
        somethingElse: "should never be stored",
      },
    });
    const look = (await adminDb.doc(`presence/${uid}`).get()).data().look;
    expect(look).toEqual({ color: "#2DD4BF", eyeStyle: "heart", mouthStyle: "grin", accessory: "cap", trail: "none" });
  });

  test("a look with an invalid core field is dropped entirely", async () => {
    const uid = await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    await call({
      samples: samplesAged(90000, 75000),
      speedKmh: 42,
      mood: "happy",
      allowName: false,
      look: { color: "red", eyeStyle: "normal", mouthStyle: "smile", trail: "dots" },
    });
    expect((await adminDb.doc(`presence/${uid}`).get()).data().look).toBeUndefined();
  });

  test("suppresses presence (and withdraws doc + pending buffer) within 500m of the trip destination", async () => {
    const uid = await signInNewAnonymousUser();
    await adminDb.doc(`presence/${uid}`).set({ lat: -33.87, lng: 151.21, headingDeg: 0, mood: "happy", updatedAt: new Date() });
    await adminDb.doc(`presencePending/${uid}`).set({ points: [{ lat: -33.87, lng: 151.21, t: Date.now() }] });

    const call = httpsCallable(functions, "updatePresence");
    const destLat = -33.8688;
    const destLng = 151.2093;
    const res = await call({
      samples: samplesAged(90000, 0, { lat: destLat, lng: destLng }),
      speedKmh: 42,
      mood: "happy",
      allowName: false,
      tripContext: { destLat, destLng },
    });

    expect(res.data.outcome).toBe("suppressed_near_sensitive_location");
    expect((await adminDb.doc(`presence/${uid}`).get()).exists).toBe(false);
    expect((await adminDb.doc(`presencePending/${uid}`).get()).exists).toBe(false);
  });

  test("points that passed through an exclusion zone earlier in the batch are never published", async () => {
    const uid = await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    const sourceLat = -33.8688;
    const sourceLng = 151.2093;
    // Older sample sits right at the trip start (inside the zone); the newer one is ~1.1km away.
    const res = await call({
      samples: [
        { lat: sourceLat, lng: sourceLng, ageMs: 100000 },
        { lat: sourceLat - 0.01, lng: sourceLng, ageMs: 90000 },
      ],
      speedKmh: 42,
      mood: "happy",
      allowName: false,
      tripContext: { sourceLat, sourceLng },
    });
    expect(res.data.outcome).toBe("success");
    const path = (await adminDb.doc(`presence/${uid}`).get()).data().path;
    for (const p of path) {
      const metersFromStart = Math.abs(p.lat - sourceLat) * 111320;
      expect(metersFromStart).toBeGreaterThan(500);
    }
  });
});

describe("clearPresence", () => {
  test("rejects an unauthenticated call", async () => {
    await auth.signOut();
    const call = httpsCallable(functions, "clearPresence");
    await expect(call({})).rejects.toBeTruthy();
  });

  test("deletes the caller's own presence doc and private pending buffer", async () => {
    const uid = await signInNewAnonymousUser();
    await adminDb.doc(`presence/${uid}`).set({ lat: 0, lng: 0, headingDeg: 0, mood: "happy", updatedAt: new Date() });
    await adminDb.doc(`presencePending/${uid}`).set({ points: [{ lat: 0, lng: 0, t: Date.now() }] });

    const call = httpsCallable(functions, "clearPresence");
    const res = await call({});
    expect(res.data.outcome).toBe("success");

    expect((await adminDb.doc(`presence/${uid}`).get()).exists).toBe(false);
    expect((await adminDb.doc(`presencePending/${uid}`).get()).exists).toBe(false);
  });
});

describe("sendWave", () => {
  test("rejects waving at yourself", async () => {
    const uid = await signInNewAnonymousUser();
    const call = httpsCallable(functions, "sendWave");
    await expect(call({ targetUid: uid })).rejects.toBeTruthy();
  });

  test("returns target_not_visible when the target has no presence doc", async () => {
    await signInNewAnonymousUser();
    const call = httpsCallable(functions, "sendWave");
    const res = await call({ targetUid: "some-driver-with-no-presence-doc" });
    expect(res.data.outcome).toBe("target_not_visible");
  });

  test("returns no_token when the target is visible but has no registered push token", async () => {
    await signInNewAnonymousUser();
    const targetUid = "visible-driver-no-token";
    await adminDb.doc(`presence/${targetUid}`).set({ lat: 0, lng: 0, headingDeg: 0, mood: "happy", updatedAt: new Date() });

    const call = httpsCallable(functions, "sendWave");
    const res = await call({ targetUid });
    expect(res.data.outcome).toBe("no_token");
  });

  test("rate-limits a second wave at the same target within 10 minutes", async () => {
    await signInNewAnonymousUser();
    const targetUid = "visible-driver-rate-limit-test";
    await adminDb.doc(`presence/${targetUid}`).set({ lat: 0, lng: 0, headingDeg: 0, mood: "happy", updatedAt: new Date() });

    const call = httpsCallable(functions, "sendWave");
    const first = await call({ targetUid });
    expect(first.data.outcome).toBe("no_token");
    const second = await call({ targetUid });
    expect(second.data.outcome).toBe("rate_limited");
  });

  test("never reveals a block to the sender -- reports 'success' even though delivery is withheld", async () => {
    const senderUid = await signInNewAnonymousUser();
    const targetUid = "visible-driver-blocked-sender";
    await adminDb.doc(`presence/${targetUid}`).set({ lat: 0, lng: 0, headingDeg: 0, mood: "happy", updatedAt: new Date() });
    await adminDb.doc(`blocks/${targetUid}`).set({ blockedUids: [senderUid] });
    // Give the target a real-looking token so a non-blocked sender WOULD have reached the
    // "attempt delivery" branch -- proving the block check (not just a missing token) is what
    // actually short-circuits this call.
    await adminDb.doc(`deviceSessions/${targetUid}`).set({ expoPushToken: "ExponentPushToken[fake-for-test]" });

    const call = httpsCallable(functions, "sendWave");
    const res = await call({ targetUid });
    expect(res.data.outcome).toBe("success");
  });
});

// Character voices. The emulator's ELEVENLABS_API_KEY is the deploy workflow's own "unset"
// placeholder (firebase/functions/.secret.local), so these exercise exactly the state a real
// project is in before its owner provides a key: locked, said plainly, nothing synthesized.
describe("personaVoicesStatus", () => {
  test("rejects an unauthenticated call", async () => {
    await auth.signOut();
    await expect(httpsCallable(functions, "personaVoicesStatus")({})).rejects.toBeTruthy();
  });

  test("reports NOT available while the key is only the placeholder", async () => {
    await signInNewAnonymousUser();
    const result = await httpsCallable(functions, "personaVoicesStatus")({});
    expect(result.data).toEqual({ available: false });
  });
});

describe("synthesizePersonaSpeech", () => {
  test("rejects an unauthenticated call", async () => {
    await auth.signOut();
    const call = httpsCallable(functions, "synthesizePersonaSpeech");
    await expect(call({ personaId: "matilda", text: "Turn left" })).rejects.toBeTruthy();
  });

  test("rejects an unknown character", async () => {
    await signInNewAnonymousUser();
    const call = httpsCallable(functions, "synthesizePersonaSpeech");
    await expect(call({ personaId: "not_a_voice", text: "Turn left" })).rejects.toBeTruthy();
  });

  test("rejects text far longer than any navigation sentence", async () => {
    await signInNewAnonymousUser();
    const call = httpsCallable(functions, "synthesizePersonaSpeech");
    await expect(call({ personaId: "matilda", text: "a".repeat(2000) })).rejects.toBeTruthy();
  });

  test("returns not_configured -- and charges nothing to the daily allowance -- without a real key", async () => {
    const uid = await signInNewAnonymousUser();
    const result = await httpsCallable(functions, "synthesizePersonaSpeech")({
      personaId: "matilda",
      text: "Turn left onto George St",
    });
    expect(result.data).toEqual({ status: "not_configured" });
    const usage = await adminDb.doc(`personaUsage/${uid}`).get();
    expect(usage.exists).toBe(false);
  });
});

// Live Traffic NSW. As with the character voices, the emulator's TFNSW_API_KEY is the "unset"
// placeholder -- the state a project is in before a key is provided.
describe("refreshNswTrafficNow", () => {
  const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = require("firebase/auth");

  test("rejects an unauthenticated call", async () => {
    await auth.signOut();
    await expect(httpsCallable(functions, "refreshNswTrafficNow")({})).rejects.toBeTruthy();
  });

  test("rejects an ordinary signed-in driver -- owner only", async () => {
    await signInNewAnonymousUser();
    await expect(httpsCallable(functions, "refreshNswTrafficNow")({})).rejects.toBeTruthy();
  });

  test("without a real key: writes { configured: false } once and fetches nothing", async () => {
    await auth.signOut();
    // One of the owner addresses index.js's ADMIN_EMAILS already names; the Auth EMULATOR lets
    // a test account be created with it. No real account or network is involved.
    const email = "support@tracklinemaps.com";
    const password = "emulator-only-password";
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch {
      await signInWithEmailAndPassword(auth, email, password);
    }
    await adminDb.doc("trafficNsw/current").delete();

    const result = await httpsCallable(functions, "refreshNswTrafficNow")({});
    expect(result.data).toEqual({ configured: false, count: 0, failedKinds: [] });

    const first = await adminDb.doc("trafficNsw/current").get();
    expect(first.data().configured).toBe(false);
    expect(first.data().incidents).toEqual([]);

    // A second run must leave the document untouched rather than rewriting it every time.
    await httpsCallable(functions, "refreshNswTrafficNow")({});
    const second = await adminDb.doc("trafficNsw/current").get();
    expect(second.updateTime.isEqual(first.updateTime)).toBe(true);
  });
});
