const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { ref, uploadBytes, getBytes } = require("firebase/storage");

// Real Storage Security Rules tests, run against the project's actual firebase/storage.rules
// via the real Storage emulator. This feature (Ghost mode/presence) doesn't touch Storage at
// all, but the user's own explicit testing request covers Storage rules generally -- this is a
// real regression check that the pre-existing voiceRecordings/{uid} rule still behaves exactly
// as documented, run alongside the Firestore tests rather than skipped.

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-trackline-rules-test",
    storage: {
      rules: fs.readFileSync(path.resolve(__dirname, "../storage.rules"), "utf8"),
      host: "127.0.0.1",
      port: 9199,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("voiceRecordings/{uid}/{fileName}", () => {
  test("a driver CAN write and read their own recording", async () => {
    const self = testEnv.authenticatedContext("driver-a").storage();
    const fileRef = ref(self, "voiceRecordings/driver-a/clip1.m4a");
    await assertSucceeds(uploadBytes(fileRef, new Uint8Array([1, 2, 3])));
    await assertSucceeds(getBytes(fileRef));
  });

  test("a driver CANNOT write to another driver's recording path", async () => {
    const other = testEnv.authenticatedContext("driver-b").storage();
    const fileRef = ref(other, "voiceRecordings/driver-a/clip1.m4a");
    await assertFails(uploadBytes(fileRef, new Uint8Array([1, 2, 3])));
  });

  test("an unauthenticated client CANNOT write anywhere", async () => {
    const anon = testEnv.unauthenticatedContext().storage();
    const fileRef = ref(anon, "voiceRecordings/driver-a/clip1.m4a");
    await assertFails(uploadBytes(fileRef, new Uint8Array([1, 2, 3])));
  });
});

describe("placePhotos/{uid}/{fileName}", () => {
  const jpeg = { contentType: "image/jpeg" };

  test("a driver CAN upload a JPEG to their own folder, and another signed-in driver can fetch it by path", async () => {
    const self = testEnv.authenticatedContext("driver-a").storage();
    await assertSucceeds(uploadBytes(ref(self, "placePhotos/driver-a/x1.jpg"), new Uint8Array([1, 2, 3]), jpeg));
    const other = testEnv.authenticatedContext("driver-b").storage();
    await assertSucceeds(getBytes(ref(other, "placePhotos/driver-a/x1.jpg")));
  });

  test("a driver CANNOT upload into someone else's folder", async () => {
    const self = testEnv.authenticatedContext("driver-a").storage();
    await assertFails(uploadBytes(ref(self, "placePhotos/driver-b/x2.jpg"), new Uint8Array([1]), jpeg));
  });

  test("anything that isn't a JPEG is refused", async () => {
    const self = testEnv.authenticatedContext("driver-a").storage();
    await assertFails(
      uploadBytes(ref(self, "placePhotos/driver-a/x3.jpg"), new Uint8Array([1]), { contentType: "text/html" })
    );
  });

  test("a signed-out client can't fetch a photo", async () => {
    const anon = testEnv.unauthenticatedContext().storage();
    await assertFails(getBytes(ref(anon, "placePhotos/driver-a/x1.jpg")));
  });
});

describe("every other path (catch-all)", () => {
  test("even a signed-in driver CANNOT write outside voiceRecordings/", async () => {
    const self = testEnv.authenticatedContext("driver-a").storage();
    const fileRef = ref(self, "somethingElse/driver-a/file.txt");
    await assertFails(uploadBytes(fileRef, new Uint8Array([1])));
  });
});
