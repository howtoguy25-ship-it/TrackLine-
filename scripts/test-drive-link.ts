// Real unit checks for src/services/driveLink.ts -- run with:
//   npx tsx scripts/test-drive-link.ts
import {
  buildAppDriveLink,
  buildDriveLink,
  driveShareMessage,
  parseDriveLink,
} from "../src/services/driveLink";

const assert = {
  ok(value: unknown, message?: string): void {
    if (!value) throw new Error(message ?? "assertion failed");
  },
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
};
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const opera = {
  latitude: -33.856784,
  longitude: 151.215297,
  name: "Sydney Opera House",
  address: "Bennelong Point, Sydney NSW 2000",
};

console.log("drive links");
check("a built link reads back as the same place", () => {
  const parsed = parseDriveLink(buildDriveLink(opera));
  assert.ok(parsed);
  assert.equal(parsed!.name, opera.name);
  assert.equal(parsed!.address, opera.address);
  assert.ok(Math.abs(parsed!.latitude - opera.latitude) < 1e-6);
  assert.ok(Math.abs(parsed!.longitude - opera.longitude) < 1e-6);
});
check("the app-scheme form reads back the same way", () => {
  const parsed = parseDriveLink(buildAppDriveLink(opera));
  assert.equal(parsed?.name, opera.name);
});
check("names with &, =, #, emoji and non-Latin text survive the round trip", () => {
  for (const name of ["Fish & Chips = Yum #1", "Café Zoë 🚗", "مطعم الشام", "Ресторан"]) {
    assert.equal(parseDriveLink(buildDriveLink({ ...opera, name }))?.name, name);
  }
});
check("no address is fine", () => {
  const link = buildDriveLink({ ...opera, address: "" });
  assert.ok(!link.includes("addr="));
  assert.equal(parseDriveLink(link)?.address, "");
});
check("a missing name gets a plain default rather than an empty title", () => {
  assert.equal(parseDriveLink("trackline://drive?lat=-33.8&lng=151.2")?.name, "Shared destination");
});
check("www. and a trailing slash are accepted", () => {
  assert.ok(parseDriveLink("https://www.tracklinemaps.com/drive/?lat=-33.8&lng=151.2&name=X"));
});
check("links to anywhere else are not drive links", () => {
  for (const url of [
    "https://tracklinemaps.com/live/abc123",
    "https://evil.example/drive?lat=-33.8&lng=151.2",
    "https://tracklinemaps.com.evil.example/drive?lat=-33.8&lng=151.2",
    "trackline://settings?lat=-33.8&lng=151.2",
    "http://tracklinemaps.com/drive?lat=-33.8&lng=151.2",
    "",
  ]) {
    assert.equal(parseDriveLink(url), null);
  }
  assert.equal(parseDriveLink(null), null);
});
check("missing, non-numeric, out-of-range or 0,0 coordinates are refused", () => {
  for (const q of [
    "lat=-33.8", "lng=151.2", "lat=abc&lng=151.2", "lat=-33.8&lng=1e5", "lat=91&lng=151.2",
    "lat=-33.8&lng=181", "lat=0&lng=0", "lat=&lng=", "lat=-33.8;drop&lng=151.2",
  ]) {
    assert.equal(parseDriveLink(`trackline://drive?${q}`), null);
  }
});
check("control characters and over-long text from a hand-written link are cleaned", () => {
  const parsed = parseDriveLink(`trackline://drive?lat=-33.8&lng=151.2&name=${encodeURIComponent("A\nB\u0007" + "x".repeat(500))}`);
  assert.ok(parsed);
  assert.ok(!/[\u0000-\u001f]/.test(parsed!.name));
  assert.ok(parsed!.name.length <= 120);
});
check("badly percent-encoded text doesn't throw", () => {
  assert.equal(parseDriveLink("trackline://drive?lat=-33.8&lng=151.2&name=%E0%A4%A")?.name, "Shared destination");
});
check("the share message carries the name and the link", () => {
  const message = driveShareMessage(opera);
  assert.ok(message.includes("Sydney Opera House"));
  assert.ok(message.includes(buildDriveLink(opera)));
});

console.log(`\n${passed} checks passed`);
