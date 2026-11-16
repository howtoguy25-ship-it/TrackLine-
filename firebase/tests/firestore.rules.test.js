const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, setDoc, deleteDoc, collection, addDoc, serverTimestamp } = require("firebase/firestore");

// Real Firestore Security Rules tests for the Ghost mode/presence feature (Part 2/3), run
// against the project's real firebase/firestore.rules file via the actual Firestore emulator --
// not a hand-rolled simulation of what the rules do. See firebase/tests/README.md for exactly
// how this suite is run and TEST_RESULTS.md for the real, pasted output of the last run.

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-trackline-rules-test",
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

const OWNER_EMAIL = "howtoguy25@gmail.com";

describe("presence/{uid}", () => {
  const seedPresence = async (uid) => {
    // withSecurityRulesDisabled bypasses rules entirely -- same as the Admin SDK used by
    // updatePresence/clearPresence in firebase/functions/index.js, which is the only real way a
    // presence doc is ever written in production.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `presence/${uid}`), {
        lat: -33.87,
        lng: 151.21,
        headingDeg: 90,
        mood: "happy",
        updatedAt: serverTimestamp(),
      });
    });
  };

  test("a signed-in driver CAN read another driver's presence doc", async () => {
    await seedPresence("driver-a");
    const reader = testEnv.authenticatedContext("driver-b").firestore();
    await assertSucceeds(getDoc(doc(reader, "presence/driver-a")));
  });

  test("an unauthenticated client CANNOT read a presence doc", async () => {
    await seedPresence("driver-a");
    const reader = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(reader, "presence/driver-a")));
  });

  test("a client CANNOT write their OWN presence doc directly -- only the Cloud Function (Admin SDK) can", async () => {
    const writer = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(
      setDoc(doc(writer, "presence/driver-a"), { lat: 0, lng: 0, headingDeg: 0, mood: "happy", updatedAt: serverTimestamp() })
    );
  });

  test("a client CANNOT delete their own presence doc directly", async () => {
    await seedPresence("driver-a");
    const writer = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(deleteDoc(doc(writer, "presence/driver-a")));
  });
});

describe("presencePending/{uid} (the server-side privacy-delay buffer)", () => {
  test("NO client can read it -- not another driver, not even the driver it belongs to", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "presencePending/driver-a"), { points: [{ lat: -33.87, lng: 151.21, t: 1 }] });
    });
    await assertFails(getDoc(doc(testEnv.authenticatedContext("driver-a").firestore(), "presencePending/driver-a")));
    await assertFails(getDoc(doc(testEnv.authenticatedContext("driver-b").firestore(), "presencePending/driver-a")));
    await assertFails(getDocs(collection(testEnv.authenticatedContext("driver-b").firestore(), "presencePending")));
  });

  test("no client can write it either", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(setDoc(doc(self, "presencePending/driver-a"), { points: [] }));
  });
});

describe("blocks/{uid}", () => {
  test("a driver CAN write their own block list", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertSucceeds(setDoc(doc(self, "blocks/driver-a"), { blockedUids: ["driver-b"] }));
  });

  test("a driver CANNOT write someone else's block list", async () => {
    const other = testEnv.authenticatedContext("driver-b").firestore();
    await assertFails(setDoc(doc(other, "blocks/driver-a"), { blockedUids: ["driver-c"] }));
  });

  test("a driver CAN read their own block list, but CANNOT read someone else's", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "blocks/driver-a"), { blockedUids: ["driver-b"] });
    });
    const self = testEnv.authenticatedContext("driver-a").firestore();
    const other = testEnv.authenticatedContext("driver-b").firestore();
    await assertSucceeds(getDoc(doc(self, "blocks/driver-a")));
    await assertFails(getDoc(doc(other, "blocks/driver-a")));
  });
});

describe("waves/{waveId}", () => {
  test("no client, authenticated or not, can read or write a wave rate-limit doc", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(setDoc(doc(self, "waves/driver-a_driver-b"), { lastSentAt: serverTimestamp() }));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "waves/driver-a_driver-b"), { lastSentAt: serverTimestamp() });
    });
    await assertFails(getDoc(doc(self, "waves/driver-a_driver-b")));
  });
});

describe("personaUsage/{uid} (the character-voice daily allowance)", () => {
  test("a driver can neither read nor reset their own allowance", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(setDoc(doc(self, "personaUsage/driver-a"), { day: "2026-11-11", count: 0 }));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "personaUsage/driver-a"), { day: "2026-11-11", count: 400 });
    });
    await assertFails(getDoc(doc(self, "personaUsage/driver-a")));
    await assertFails(setDoc(doc(self, "personaUsage/driver-a"), { day: "2026-11-11", count: 0 }));
  });
});

describe("trafficNsw/{docId} (the shared live-traffic snapshot)", () => {
  test("a signed-in driver CAN read it; an unauthenticated client cannot", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "trafficNsw/current"), { configured: true, incidents: [] });
    });
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext("driver-a").firestore(), "trafficNsw/current")));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "trafficNsw/current")));
  });

  test("no client can write or plant incidents in it", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(setDoc(doc(self, "trafficNsw/current"), { configured: true, incidents: [{ id: "fake" }] }));
  });
});

describe("placePhotos/{photoId} (moderated place photos)", () => {
  const good = (uid, photoId) => ({
    placeId: "ChIJ-test",
    uploaderUid: uid,
    storagePath: `placePhotos/${uid}/${photoId}.jpg`,
    status: "pending",
  });

  test("a driver can file their own photo for review, as pending", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertSucceeds(setDoc(doc(self, "placePhotos/p1"), good("driver-a", "p1")));
  });

  test("a photo can't be filed as already approved, for someone else, or at another path", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(setDoc(doc(self, "placePhotos/p2"), { ...good("driver-a", "p2"), status: "approved" }));
    await assertFails(setDoc(doc(self, "placePhotos/p3"), good("driver-b", "p3")));
    await assertFails(
      setDoc(doc(self, "placePhotos/p4"), { ...good("driver-a", "p4"), storagePath: "placePhotos/driver-b/p4.jpg" })
    );
  });

  test("other drivers can't see a pending photo, but can once it's approved", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "placePhotos/p5"), good("driver-a", "p5"));
      await setDoc(doc(ctx.firestore(), "placePhotos/p6"), { ...good("driver-a", "p6"), status: "approved" });
    });
    const other = testEnv.authenticatedContext("driver-b").firestore();
    await assertFails(getDoc(doc(other, "placePhotos/p5")));
    await assertSucceeds(getDoc(doc(other, "placePhotos/p6")));
    // ...and the uploader can always see their own.
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext("driver-a").firestore(), "placePhotos/p5")));
  });

  test("the uploader can't approve their own photo; the owner can", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "placePhotos/p7"), good("driver-a", "p7"));
    });
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(setDoc(doc(self, "placePhotos/p7"), { ...good("driver-a", "p7"), status: "approved" }));
    const admin = testEnv.authenticatedContext("admin", { email: "support@tracklinemaps.com" }).firestore();
    await assertSucceeds(setDoc(doc(admin, "placePhotos/p7"), { ...good("driver-a", "p7"), status: "approved" }));
  });
});

describe("placeReports/{reportId}", () => {
  test("a driver can report a place with a known reason; nobody but the owner can read reports", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertSucceeds(
      addDoc(collection(self, "placeReports"), { reportedBy: "driver-a", placeId: "ChIJ-x", reason: "closed" })
    );
    await assertFails(
      addDoc(collection(self, "placeReports"), { reportedBy: "driver-b", placeId: "ChIJ-x", reason: "closed" })
    );
    await assertFails(
      addDoc(collection(self, "placeReports"), { reportedBy: "driver-a", placeId: "ChIJ-x", reason: "made-up" })
    );
    await assertFails(getDocs(collection(self, "placeReports")));
  });
});

describe("userReports/{reportId}", () => {
  test("a signed-in driver CAN create a report attributed to themselves, about someone else", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertSucceeds(
      addDoc(collection(self, "userReports"), {
        reportedUid: "driver-b",
        reportedBy: "driver-a",
        reason: "harassment",
        createdAt: serverTimestamp(),
      })
    );
  });

  test("a driver CANNOT create a report with a spoofed reportedBy", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(
      addDoc(collection(self, "userReports"), {
        reportedUid: "driver-b",
        reportedBy: "driver-c",
        reason: "harassment",
        createdAt: serverTimestamp(),
      })
    );
  });

  test("a driver CANNOT report themselves", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(
      addDoc(collection(self, "userReports"), {
        reportedUid: "driver-a",
        reportedBy: "driver-a",
        reason: "other",
        createdAt: serverTimestamp(),
      })
    );
  });

  test("a non-admin CANNOT read userReports; the admin CAN", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await addDoc(collection(ctx.firestore(), "userReports"), {
        reportedUid: "driver-b",
        reportedBy: "driver-a",
        reason: "other",
        createdAt: serverTimestamp(),
      });
    });
    const nonAdmin = testEnv.authenticatedContext("driver-a").firestore();
    const admin = testEnv.authenticatedContext("owner-uid", { email: OWNER_EMAIL }).firestore();
    await assertFails(getDocs(collection(nonAdmin, "userReports")));
    await assertSucceeds(getDocs(collection(admin, "userReports")));
  });
});

// Quick regression check -- confirms the new match blocks above didn't break the pre-existing
// users/{uid} rules they sit next to (both are siblings inside the same top-level `match
// /databases/{database}/documents` block).
describe("users/{uid} (regression)", () => {
  test("a driver can still write their own profile doc", async () => {
    const self = testEnv.authenticatedContext("driver-a").firestore();
    await assertSucceeds(setDoc(doc(self, "users/driver-a"), { displayName: "Test" }));
  });

  test("a driver still cannot read someone else's profile doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/driver-b"), { displayName: "Other" });
    });
    const other = testEnv.authenticatedContext("driver-a").firestore();
    await assertFails(getDoc(doc(other, "users/driver-b")));
  });
});

describe("roadFeatureReports/{reportId} (driver school-zone / speed-limit reports)", () => {
  const report = (by, extra = {}) => ({
    kind: "school_zone_missing",
    reportedBy: by,
    lat: -33.9,
    lng: 151.15,
    tile: "-340_1511",
    heading: 10,
    speed: 40,
    unit: "km/h",
    windows: ["08:00-09:30"],
    status: "pending",
    confirmCount: 0,
    ...extra,
  });

  test("a driver can file a pending report as themselves -- not spoofed, not pre-approved", async () => {
    const a = testEnv.authenticatedContext("driver-a").firestore();
    await assertSucceeds(addDoc(collection(a, "roadFeatureReports"), report("driver-a")));
    await assertFails(addDoc(collection(a, "roadFeatureReports"), report("driver-b")));
    await assertFails(addDoc(collection(a, "roadFeatureReports"), report("driver-a", { status: "live" })));
    await assertFails(addDoc(collection(a, "roadFeatureReports"), report("driver-a", { confirmCount: 3 })));
    await assertFails(addDoc(collection(a, "roadFeatureReports"), report("driver-a", { kind: "made_up" })));
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(addDoc(collection(anon, "roadFeatureReports"), report("x")));
  });

  test("other drivers can confirm once each; never the reporter; nobody but the owner edits status", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "roadFeatureReports/r1"), report("driver-a"));
    });
    const a = testEnv.authenticatedContext("driver-a").firestore();
    const b = testEnv.authenticatedContext("driver-b").firestore();
    await assertSucceeds(getDoc(doc(b, "roadFeatureReports/r1")));
    await assertFails(setDoc(doc(a, "roadFeatureReports/r1/confirmations/driver-a"), { at: 1 }));
    await assertSucceeds(setDoc(doc(b, "roadFeatureReports/r1/confirmations/driver-b"), { at: 1 }));
    // Again (an update): refused. Someone else's id: refused.
    await assertFails(setDoc(doc(b, "roadFeatureReports/r1/confirmations/driver-b"), { at: 2 }));
    await assertFails(setDoc(doc(b, "roadFeatureReports/r1/confirmations/driver-c"), { at: 1 }));
    await assertFails(setDoc(doc(b, "roadFeatureReports/r1"), report("driver-a", { status: "live" })));
    const owner = testEnv.authenticatedContext("owner", { email: OWNER_EMAIL }).firestore();
    await assertSucceeds(setDoc(doc(owner, "roadFeatureReports/r1"), report("driver-a", { status: "approved" })));
  });

  test("communityRoadFeatures: readable by signed-in drivers, written only by the server", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "communityRoadFeatures/r1"), { kind: "school_zone", tile: "-340_1511" });
    });
    const b = testEnv.authenticatedContext("driver-b").firestore();
    await assertSucceeds(getDoc(doc(b, "communityRoadFeatures/r1")));
    await assertFails(setDoc(doc(b, "communityRoadFeatures/r2"), { kind: "school_zone" }));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "communityRoadFeatures/r1")));
  });
});
