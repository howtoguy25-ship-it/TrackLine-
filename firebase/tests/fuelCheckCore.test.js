// Pure unit tests for NSW FuelCheck prices (fuelPricesNearby in index.js). The API responses
// below follow the documented shape; they're hand-built, not captured from the live API.
const core = require("../functions/fuelCheckCore");

describe("FuelCheck", () => {
  it("placeholder or empty keys are 'not set up'", () => {
    expect(core.isConfigured("unset", "unset")).toBe(false);
    expect(core.isConfigured("", "x")).toBe(false);
    expect(core.isConfigured("abcdefghijk", "lmnopqrstuv")).toBe(true);
  });

  it("only NSW points and known fuel types are asked for", () => {
    expect(core.parseRequest({ lat: -33.87, lng: 151.21, fuelType: "E10" })).toEqual({ lat: -33.87, lng: 151.21, fuelType: "E10", radiusKm: 5 });
    expect(core.parseRequest({ lat: -37.81, lng: 144.96, fuelType: "E10" }).error).toBe("FuelCheck covers New South Wales only.");
    expect(core.parseRequest({ lat: -33.87, lng: 151.21, fuelType: "XYZ" }).error).toBe("Unknown fuel type.");
    expect(core.parseRequest({ lat: -33.87, lng: 151.21, fuelType: "U91", radiusKm: 999 }).radiusKm).toBe(25);
  });

  it("joins stations with their prices; stations without a price are left out", () => {
    const out = core.parseNearby({
      stations: [
        { code: "101", name: "Ampol Foodary Ashfield", brand: "Ampol", address: "1 Parramatta Rd", location: { latitude: -33.888, longitude: 151.124 } },
        { code: "102", name: "No price here", brand: "BP", location: { latitude: -33.9, longitude: 151.1 } },
      ],
      prices: [{ stationcode: "101", fueltype: "E10", price: 189.9, lastupdated: "17/11/2026 08:41:12" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: "101", brand: "Ampol", centsPerLitre: 189.9 });
    // 08:41 Sydney summer time (UTC+11) is 21:41 UTC the day before.
    expect(new Date(out[0].updatedMs).toISOString()).toBe("2026-11-16T21:41:12.000Z");
  });

  it("request timestamp is Sydney time in the API's format", () => {
    expect(core.requestTimestamp(Date.UTC(2026, 10, 16, 22, 5, 0))).toMatch(/^17\/11\/2026 09:05:00 AM$/);
  });

  it("asks for a token, then prices, with the key header and never the secret in the body", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (url === core.TOKEN_URL) return { ok: true, json: async () => ({ access_token: "tok" }) };
      return { ok: true, json: async () => ({ stations: [], prices: [] }) };
    };
    await core.fetchNearbyPrices({ key: "KEYKEYKEYKEY", secret: "SECRETSECRET", request: { lat: -33.8, lng: 151.2, fuelType: "U91", radiusKm: 5 }, fetchImpl, nowMs: 0, uuid: "u" });
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${Buffer.from("KEYKEYKEYKEY:SECRETSECRET").toString("base64")}`);
    expect(calls[1].url).toBe(core.NEARBY_URL);
    expect(calls[1].init.headers.apikey).toBe("KEYKEYKEYKEY");
    expect(calls[1].init.headers.Authorization).toBe("Bearer tok");
    expect(calls[1].init.body).not.toContain("SECRETSECRET");
    expect(JSON.parse(calls[1].init.body)).toMatchObject({ fueltype: "U91", radius: "5", sortby: "distance" });
  });

  it("a failed sign-in says so", async () => {
    await expect(
      core.fetchNearbyPrices({ key: "k".repeat(10), secret: "s".repeat(10), request: { lat: -33.8, lng: 151.2, fuelType: "E10", radiusKm: 5 }, fetchImpl: async () => ({ ok: false, status: 401 }), nowMs: 0, uuid: "u" })
    ).rejects.toThrow("FuelCheck sign-in failed (HTTP 401)");
  });
});
