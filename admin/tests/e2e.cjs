// Dashboard end to end on the Firebase emulators: real sign-in, real Cloud Functions, real
// Firestore. Run (from the repo root):
//   NEXT_PUBLIC_USE_EMULATORS=1 NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-trackline-rules-test \
//   NEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key npm --prefix admin run build
//   npx firebase-tools emulators:exec --project demo-trackline-rules-test \
//     --only firestore,functions,auth "node admin/tests/e2e.cjs"
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const admin = require(path.join(__dirname, "../../firebase/tests/node_modules/firebase-admin"));

const PROJECT = "demo-trackline-rules-test";
const OUT = path.join(__dirname, "../out");
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, "../e2e-shots");
const OWNER = { email: "howtoguy25@gmail.com", password: "owner-e2e-pass-1" };
const DRIVER = { email: "e2e-driver@test.trackline", password: "driver-e2e-pass-1" };

function serve() {
  const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain" };
  return http
    .createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      let file = path.join(OUT, p);
      if (!fs.existsSync(file)) file = path.join(OUT, p, "index.html");
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(4322);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = admin.initializeApp({ projectId: PROJECT });
  const auth = app.auth();
  const db = app.firestore();
  for (const u of [OWNER, DRIVER]) {
    try {
      await auth.deleteUser((await auth.getUserByEmail(u.email)).uid);
    } catch {}
  }
  await auth.createUser({ ...OWNER, emailVerified: true });
  const driver = await auth.createUser({ ...DRIVER, emailVerified: true, displayName: "E2E Driver" });
  await db.doc(`deviceSessions/${driver.uid}`).set({ platform: "ios", isAnonymous: false, appVersion: "1.3.0", country: "AU", lastActiveAt: new Date(), firstOpenAt: new Date() });

  const server = serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const step = async (name, fn) => {
    process.stdout.write(`- ${name} ... `);
    await fn();
    console.log("ok");
  };
  const reason = async (text) => {
    await page.fill("#reason", text);
    await page.getByRole("button", { name: "Confirm" }).click();
  };

  try {
    await step("sign-in page", async () => {
      await page.goto("http://127.0.0.1:4322/");
      await page.getByText("TrackLine dashboard").waitFor();
      await page.getByRole("button", { name: "Continue with Google" }).waitFor();
      await page.getByRole("button", { name: "Continue with Apple" }).waitFor();
    });
    await step("wrong password is refused", async () => {
      await page.fill("#email", OWNER.email);
      await page.fill("#password", "nope-nope");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByText("Wrong email or password.").waitFor();
    });
    await step("owner signs in -> Overview with live cards", async () => {
      await page.fill("#password", OWNER.password);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 30000 });
      await page.getByText("Online now").waitFor({ timeout: 30000 });
      await page.getByText("Role: owner").waitFor();
      await page.screenshot({ path: path.join(SHOTS, "overview.png") });
    });
    await step("Users: search by email, open the profile (masked)", async () => {
      await page.getByRole("link", { name: "Users" }).click();
      await page.fill("#q", DRIVER.email);
      await page.getByRole("button", { name: "Search" }).click();
      await page.getByText("E2E Driver").click();
      await page.getByRole("heading", { name: "E2E Driver" }).waitFor({ timeout: 20000 });
      const body = await page.textContent("body");
      if (body.includes(DRIVER.email)) throw new Error("email shown unmasked");
      await page.screenshot({ path: path.join(SHOTS, "user.png") });
    });
    await step("action with a reason: sign out everywhere", async () => {
      await page.getByRole("button", { name: "Sign out everywhere" }).click();
      await reason("e2e test of the action flow");
      await page.getByText("Sign out all devices: done.").waitFor({ timeout: 20000 });
    });
    await step("App control: switch Vehicle Check off and publish", async () => {
      await page.getByRole("link", { name: "App control" }).click();
      await page.getByText("Feature switches").waitFor({ timeout: 20000 });
      await page.locator("tr", { hasText: "vehicleCheck" }).locator("input[type=checkbox]").uncheck();
      await page.getByRole("button", { name: "Publish changes" }).click();
      await reason("e2e: provider outage drill");
      await page.getByText("Publish app config: done.").waitFor({ timeout: 20000 });
      const cfg = (await db.doc("appConfig/current").get()).data();
      if (cfg.flags.vehicleCheck.enabled !== false) throw new Error("config not saved");
    });
    await step("Audit log shows both actions, chain intact", async () => {
      await page.getByRole("link", { name: "Audit log" }).click();
      await page.getByText("users.signOut").first().waitFor({ timeout: 20000 });
      await page.getByText("config.write").first().waitFor();
      await page.getByRole("button", { name: "Check integrity" }).click();
      await page.getByText(/entries intact/).waitFor({ timeout: 20000 });
      await page.screenshot({ path: path.join(SHOTS, "audit.png") });
    });
    await step("a driver account (no role) is refused", async () => {
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.fill("#email", DRIVER.email);
      await page.fill("#password", DRIVER.password);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByText("This account has no dashboard role.").waitFor({ timeout: 20000 });
    });
    if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
    console.log("E2E PASSED");
  } finally {
    await browser.close();
    server.close();
    await app.delete();
  }
}

main().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
