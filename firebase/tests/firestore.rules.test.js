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
