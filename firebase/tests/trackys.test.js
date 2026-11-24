// Startup §2-3 against the real emulators: the private zone (400 m) and ghost mode are enforced on
// the server, and "Trackys around you" is a rounded count computed on the server.
jest.setTimeout(30_000);
const { initializeApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, signInAnonymously } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const admin = require("firebase-admin");

const PROJECT_ID = "demo-trackline-rules-test";
let auth;
let functions;
let adminApp;
let adminDb;

beforeAll(() => {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: "fake-api-key" }, "trackys-test");
  auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  functions = getFunctions(app);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  adminApp = admin.initializeApp({ projectId: PROJECT_ID }, "trackys-admin");
  adminDb = adminApp.firestore();
});
afterAll(async () => {
  await adminApp.delete();
});

async function newDriver() {
  await auth.signOut();
  return (await signInAnonymously(auth)).user.uid;
}
// ~1 km north per 0.009 degrees
const HOME = { lat: -33.9, lng: 151.0 };
const drive = (lat, lng) => [
  { lat, lng, ageMs: 100000 },
  { lat: lat - 0.0008, lng, ageMs: 85000 },
];

describe("private zone (server-enforced)", () => {
  test("inside 400 m of the trip start: never appears for others", async () => {
    const uid = await newDriver();
    const res = await httpsCallable(functions, "updatePresence")({
      samples: drive(HOME.lat + 0.002, HOME.lng),
      speedKmh: 40,
      mood: "happy",
      allowName: false,
      tripContext: { sourceLat: HOME.lat, sourceLng: HOME.lng },
    });
    expect(res.data.outcome).toBe("suppressed_near_sensitive_location");
    expect((await adminDb.doc(`presence/${uid}`).get()).exists).toBe(false);
  });

  test("appears after leaving the zone and moving; with a geohash for viewport queries", async () => {
    const uid = await newDriver();
    const res = await httpsCallable(functions, "updatePresence")({
      samples: drive(HOME.lat + 0.02, HOME.lng),
      speedKmh: 40,
      mood: "happy",
      allowName: false,
      tripContext: { sourceLat: HOME.lat, sourceLng: HOME.lng },
    });
    expect(res.data.outcome).toBe("success");
    const doc = (await adminDb.doc(`presence/${uid}`).get()).data();
    expect(doc.geohash).toHaveLength(6);
  });

  test("disappears on arrival (entering the destination zone)", async () => {
    const uid = await newDriver();
    const call = httpsCallable(functions, "updatePresence");
    const dest = { lat: HOME.lat + 0.05, lng: HOME.lng };
    await call({ samples: drive(dest.lat + 0.02, dest.lng), speedKmh: 40, mood: "happy", allowName: false, tripContext: { destLat: dest.lat, destLng: dest.lng } });
    expect((await adminDb.doc(`presence/${uid}`).get()).exists).toBe(true);
    const res = await call({ samples: drive(dest.lat + 0.001, dest.lng), speedKmh: 20, mood: "happy", allowName: false, tripContext: { destLat: dest.lat, destLng: dest.lng } });
    expect(res.data.outcome).toBe("suppressed_near_sensitive_location");
    expect((await adminDb.doc(`presence/${uid}`).get()).exists).toBe(false);
  });

  test("ghost mode hides instantly", async () => {
    const uid = await newDriver();
    await httpsCallable(functions, "updatePresence")({ samples: drive(HOME.lat + 0.03, HOME.lng), speedKmh: 40, mood: "happy", allowName: false });
    expect((await adminDb.doc(`presence/${uid}`).get()).exists).toBe(true);
    await httpsCallable(functions, "clearPresence")({});
    expect((await adminDb.doc(`presence/${uid}`).get()).exists).toBe(false);
  });

  test("no Home: the first stationary place tonight becomes a private zone", async () => {
    const uid = await newDriver();
    const night = { lat: HOME.lat + 0.2, lng: HOME.lng + 0.2 };
    const r = await httpsCallable(functions, "noteActive")({ lat: night.lat, lng: night.lng, ghost: false, localHour: 23, localDate: "2026-11-24", stationary: true });
    expect(r.data.nightZoneSet).toBe(true);
    const res = await httpsCallable(functions, "updatePresence")({ samples: drive(night.lat + 0.002, night.lng), speedKmh: 40, mood: "happy", allowName: false });
    expect(res.data.outcome).toBe("suppressed_near_sensitive_location");
    expect((await adminDb.doc(`presence/${uid}`).get()).exists).toBe(false);
  });

  test("clients can't read anyone's activity or private zone", async () => {
    const uid = await newDriver();
    await httpsCallable(functions, "noteActive")({ lat: -33.5, lng: 150.5, ghost: false });
    const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require("firebase/firestore");
    const db = getFirestore(auth.app);
    try {
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
    } catch {
      // already connected
    }
    await expect(getDoc(doc(db, `activity/${uid}`))).rejects.toBeTruthy();
    await expect(getDoc(doc(db, `privateZones/${uid}`))).rejects.toBeTruthy();
  });
});

describe("Trackys around you (server count)", () => {
  // A quiet area of its own (central NSW), so other tests' activity doesn't mix in.
  const C = { lat: -32.5, lng: 148.5 };
  test("a few people: 'A few' (never the exact number), ghosts counted as a number", async () => {
    for (let i = 0; i < 3; i++) {
      await newDriver();
      await httpsCallable(functions, "noteActive")({ lat: C.lat + i * 0.01, lng: C.lng, ghost: i === 0 });
    }
    await newDriver();
    const r = await httpsCallable(functions, "trackysAround")({ lat: C.lat, lng: C.lng });
    expect(r.data).toMatchObject({ few: true, count: null });
    expect(JSON.stringify(r.data)).not.toMatch(/lat|lng/);
  });

  test("24 people within 10 km: rounded to 20, area 10 km; cached for 60 s", async () => {
    const D = { lat: -31.5, lng: 147.5 };
    const batch = adminDb.batch();
    const now = Date.now();
    for (let i = 0; i < 24; i++) {
      batch.set(adminDb.doc(`activity/seed-${i}`), require("../functions/trackysCore").activityDoc({ lat: D.lat + (i % 5) * 0.01, lng: D.lng, ghost: i % 3 === 0, now }));
    }
    await batch.commit();
    await newDriver();
    const r = await httpsCallable(functions, "trackysAround")({ lat: D.lat, lng: D.lng });
    expect(r.data).toMatchObject({ few: false, count: 20, radiusKm: 10, cached: false });
    const again = await httpsCallable(functions, "trackysAround")({ lat: D.lat, lng: D.lng });
    expect(again.data.cached).toBe(true);
  });
});
