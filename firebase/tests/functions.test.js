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
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}

describe("updatePresence", () => {
  test("rejects an unauthenticated call", async () => {
    await auth.signOut();
    const call = httpsCallable(functions, "updatePresence");
    await expect(call({ trace: [{ lat: -33.87, lng: 151.21 }, { lat: -33.871, lng: 151.211 }], speedKmh: 30 })).rejects.toBeTruthy();
  });

  test("rejects a trace with fewer than 2 points", async () => {
    await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    await expect(call({ trace: [{ lat: -33.87, lng: 151.21 }], speedKmh: 30 })).rejects.toBeTruthy();
  });

  test("withdraws presence and returns not_driving when speed is below 15km/h", async () => {
    const uid = await signInNewAnonymousUser();
    await adminDb.doc(`presence/${uid}`).set({ lat: -33.87, lng: 151.21, headingDeg: 0, mood: "happy", updatedAt: new Date() });

    const call = httpsCallable(functions, "updatePresence");
    const res = await call({
      trace: [{ lat: -33.87, lng: 151.21 }, { lat: -33.871, lng: 151.211 }],
      speedKmh: 5,
      mood: "happy",
      allowName: false,
    });

    expect(res.data.outcome).toBe("not_driving");
    const snap = await adminDb.doc(`presence/${uid}`).get();
    expect(snap.exists).toBe(false);
  });

  test("writes a rounded, road-snap-attempted presence doc when actually driving", async () => {
    await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    const res = await call({
      trace: [{ lat: -33.8688, lng: 151.2093 }, { lat: -33.8691, lng: 151.2099 }],
      headingDeg: 180,
      speedKmh: 42,
      mood: "excited",
      allowName: true,
    });

    expect(res.data.outcome).toBe("success");
    const uid = auth.currentUser.uid;
    const snap = await adminDb.doc(`presence/${uid}`).get();
    expect(snap.exists).toBe(true);
    const data = snap.data();
    expect(typeof data.lat).toBe("number");
    expect(typeof data.lng).toBe("number");
    expect(data.mood).toBe("excited");
    expect(data.headingDeg).toBe(180);
    // allowName:true but an anonymous sign-in has no `name` claim on its auth token --
    // displayName must be omitted entirely, never written as an empty string.
    expect(data.displayName).toBeUndefined();
    expect(data.expireAt).toBeTruthy();
  });

  test("falls back to an unknown mood key being replaced with 'happy'", async () => {
    await signInNewAnonymousUser();
    const call = httpsCallable(functions, "updatePresence");
    await call({
      trace: [{ lat: -33.8688, lng: 151.2093 }, { lat: -33.8691, lng: 151.2099 }],
      speedKmh: 42,
      mood: "not-a-real-mood",
      allowName: false,
    });
    const uid = auth.currentUser.uid;
    const snap = await adminDb.doc(`presence/${uid}`).get();
    expect(snap.data().mood).toBe("happy");
  });

  test("suppresses presence (and withdraws any existing doc) within 500m of the trip destination", async () => {
    const uid = await signInNewAnonymousUser();
    await adminDb.doc(`presence/${uid}`).set({ lat: -33.87, lng: 151.21, headingDeg: 0, mood: "happy", updatedAt: new Date() });

    const call = httpsCallable(functions, "updatePresence");
    const destLat = -33.8688;
    const destLng = 151.2093;
    const res = await call({
      // A 2-point trace right next to the destination -- well inside the 500m exclusion radius.
      trace: [{ lat: destLat, lng: destLng }, { lat: destLat + 0.0003, lng: destLng + 0.0003 }],
      speedKmh: 42,
      mood: "happy",
      allowName: false,
      tripContext: { destLat, destLng },
    });

    expect(res.data.outcome).toBe("suppressed_near_sensitive_location");
    const snap = await adminDb.doc(`presence/${uid}`).get();
    expect(snap.exists).toBe(false);
  });
});

describe("clearPresence", () => {
  test("rejects an unauthenticated call", async () => {
    await auth.signOut();
    const call = httpsCallable(functions, "clearPresence");
    await expect(call({})).rejects.toBeTruthy();
  });

  test("deletes the caller's own presence doc", async () => {
    const uid = await signInNewAnonymousUser();
    await adminDb.doc(`presence/${uid}`).set({ lat: 0, lng: 0, headingDeg: 0, mood: "happy", updatedAt: new Date() });

    const call = httpsCallable(functions, "clearPresence");
    const res = await call({});
    expect(res.data.outcome).toBe("success");

    const snap = await adminDb.doc(`presence/${uid}`).get();
    expect(snap.exists).toBe(false);
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
