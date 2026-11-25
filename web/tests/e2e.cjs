// Web app account flows on the Firebase emulators (real Auth, Firestore, Cloud Functions):
// guest -> help request -> create an email account from the guest (same uid) -> inbox ->
// Can't sign in? form. The Google map itself needs a Maps key and isn't checked here.
//   VITE_USE_EMULATORS=1 VITE_FIREBASE_PROJECT_ID=demo-trackline-rules-test VITE_FIREBASE_API_KEY=fake-api-key npx --prefix web vite build web
//   npx firebase-tools emulators:exec --project demo-trackline-rules-test --only firestore,functions,auth "node web/tests/e2e.cjs"
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const admin = require(path.join(__dirname, "../../firebase/tests/node_modules/firebase-admin"));
const DIST = path.join(__dirname, "../dist");
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, "../e2e-shots");

function serve() {
  const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
  return http
    .createServer((req, res) => {
      let file = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(4323);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = admin.initializeApp({ projectId: "demo-trackline-rules-test" });
  const db = app.firestore();
  const server = serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  const step = async (name, fn) => {
    process.stdout.write(`- ${name} ... `);
    await fn();
    console.log("ok");
  };
  try {
    let uid;
    await step("opens as a guest (anonymous account)", async () => {
      await page.goto("http://127.0.0.1:4323/");
      await page.waitForFunction(() => document.querySelector(".about-button"), null, { timeout: 30000 });
      await page.click(".about-button");
      await page.click("[data-testid=open-account-center]");
      await page.getByText("You're using TrackLine as a guest").waitFor();
      const users = await app.auth().listUsers();
      uid = users.users.find((u) => u.providerData.length === 0).uid;
    });
    await step("Help: send a request; it reaches the support inbox", async () => {
      await page.getByRole("tab", { name: "Help" }).click();
      await page.fill("#ac-subject", "Web test");
      await page.getByLabel("What happened?").fill("Testing help from the web");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.getByText("Web test").waitFor({ timeout: 20000 });
      const t = await db.collection("supportTickets").where("uid", "==", uid).get();
      if (t.size !== 1) throw new Error("ticket not stored");
    });
    await step("Inbox shows a message sent to this user", async () => {
      await db.doc(`users/${uid}/inbox/m1`).set({ title: "Welcome to TrackLine", body: "Hello from the team", channels: ["inbox"], translations: {}, from: "TrackLine", createdAtMs: Date.now(), openedAtMs: null, dismissedAtMs: null, button: null });
      await page.getByRole("tab", { name: "Inbox" }).click();
      await page.getByText("Welcome to TrackLine").waitFor({ timeout: 20000 });
    });
    await step("create an email account from the guest: same uid, ticket kept", async () => {
      await page.getByRole("tab", { name: "Account" }).click();
      await page.getByRole("button", { name: "New here? Create an account" }).click();
      await page.fill("#ac-email", `web${Date.now()}@test.trackline`);
      await page.fill("#ac-password", "web-pass-12345");
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.getByText("Signed in as").waitFor({ timeout: 20000 });
      const u = await app.auth().getUser(uid);
      if (!u.email) throw new Error("guest was not upgraded in place");
      await page.screenshot({ path: path.join(SHOTS, "web-account.png") });
    });
    await step("Can't sign in? form is there", async () => {
      await page.getByRole("tab", { name: "Can't sign in?" }).click();
      await page.getByText("Lost both?", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Cancel a change to my account" }).waitFor();
    });
    await step("maintenance block from the dashboard reaches the web", async () => {
      await db.doc("appConfig/current").set({ maintenance: { mode: "block", message: "Upgrading, back at 9pm" }, flags: {} });
      await page.getByText("Upgrading, back at 9pm").waitFor({ timeout: 20000 });
      await db.doc("appConfig/current").set({ maintenance: { mode: "off", message: "" }, flags: {} });
    });
    console.log("WEB E2E PASSED");
  } catch (e) {
    await page.screenshot({ path: path.join(SHOTS, "web-failure.png") }).catch(() => {});
    console.error("WEB E2E FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
    await app.delete();
  }
})();
