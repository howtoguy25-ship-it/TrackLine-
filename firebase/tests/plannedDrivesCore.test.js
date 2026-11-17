// Pure unit tests for the planned-drive re-check (refreshPlannedDrives in index.js).
const core = require("../functions/plannedDrivesCore");

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 17, 21, 0); // 8:00 am Sydney (AEDT)
const base = {
  from: { name: "Home", lat: -33.8, lng: 151.2 },
  to: { name: "Office", lat: -33.87, lng: 151.21 },
  tz: "Australia/Sydney",
  reminded: false,
};

describe("which drives are due", () => {
  it("due within 30 minutes and not yet reminded", () => {
    expect(core.isDue({ ...base, leaveAtMs: NOW + 25 * MIN }, NOW)).toBe(true);
    expect(core.isDue({ ...base, leaveAtMs: NOW + 45 * MIN }, NOW)).toBe(false);
    expect(core.isDue({ ...base, leaveAtMs: NOW + 25 * MIN, reminded: true }, NOW)).toBe(false);
    expect(core.isDue({ ...base, leaveAtMs: NOW - 30 * MIN }, NOW)).toBe(false);
  });
});

describe("arrive-by re-check", () => {
  it("asks twice and moves the leave time when traffic is heavier", async () => {
    const asked = [];
    const predict = async (t) => {
      asked.push(t);
      return 40 * 60; // 40 min now, planned 30
    };
    const drive = { ...base, mode: "arrive", targetMs: NOW + 60 * MIN, leaveAtMs: NOW + 30 * MIN, durationSeconds: 30 * 60 };
    const { message, update } = await core.handleDrive(drive, NOW, predict);
    expect(asked).toEqual([NOW + 30 * MIN, NOW + 20 * MIN]);
    expect(update).toEqual({ leaveAtMs: NOW + 20 * MIN, durationSeconds: 2400, recheckedAt: NOW, reminded: true });
    expect(message.title).toBe("Drive to Office");
    expect(message.body).toMatch(/Leave at 8:20.* to arrive by 9:00.*40 min with traffic\. Traffic's heavier: 10 min earlier/);
  });

  it("a failed re-check still reminds with the planned times and says so", async () => {
    const drive = { ...base, mode: "arrive", targetMs: NOW + 60 * MIN, leaveAtMs: NOW + 30 * MIN, durationSeconds: 30 * 60 };
    const { message, update } = await core.handleDrive(drive, NOW, async () => {
      throw new Error("Routes HTTP 403");
    });
    expect(update).toEqual({ leaveAtMs: NOW + 30 * MIN, durationSeconds: 1800, recheckedAt: null, reminded: true });
    expect(message.body).toMatch(/Couldn't refresh the traffic/);
  });
});

describe("leave-at re-check", () => {
  it("keeps the leave time and gives the arrival", async () => {
    const drive = { ...base, mode: "leave", targetMs: NOW + 20 * MIN, leaveAtMs: NOW + 20 * MIN, durationSeconds: 1500 };
    const { message, update } = await core.handleDrive(drive, NOW, async () => 1800);
    expect(update.leaveAtMs).toBe(NOW + 20 * MIN);
    expect(message.body).toMatch(/Leaving at 8:20.*30 min with traffic, arriving about 8:50/);
  });
});

describe("Routes API request", () => {
  it("sends a future departure time, the field mask and the key header; reads seconds", async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ routes: [{ duration: "1234s" }] }) };
    };
    const predict = core.routesPredictor("KEY", fetchImpl, NOW, { ...base });
    expect(await predict(NOW + 30 * MIN)).toBe(1234);
    const body = JSON.parse(seen.init.body);
    expect(body.departureTime).toBe(new Date(NOW + 30 * MIN).toISOString());
    expect(seen.init.headers["X-Goog-FieldMask"]).toBe("routes.duration");
    expect(seen.init.headers["X-Goog-Api-Key"]).toBe("KEY");
  });

  it("a past time is sent as now; an error status throws", async () => {
    let body;
    const ok = core.routesPredictor("K", async (_u, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ routes: [{ duration: "60s" }] }) };
    }, NOW, base);
    await ok(NOW - MIN);
    expect(body.departureTime).toBeUndefined();
    const bad = core.routesPredictor("K", async () => ({ ok: false, status: 403 }), NOW, base);
    await expect(bad(NOW + 30 * MIN)).rejects.toThrow("Routes HTTP 403");
  });
});
