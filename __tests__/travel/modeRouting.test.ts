// Travel modes step 2: each mode asks the right provider, the motorbike fallback is labelled,
// unavailable modes say why, and the 2-minute cache. Route data is REAL (OSRM bike / foot / car
// profiles, recorded by scripts/record-ferry-routes.mjs); the fetch is stubbed only to hand the
// recorded response back and to see which URL/body each mode sends.
import { describe, expect, it } from "@jest/globals";
import bikeJson from "../fixtures/travel/circular-quay-opera-house-bike.json";
import footJson from "../fixtures/travel/circular-quay-opera-house-foot.json";
import carJson from "../fixtures/travel/bankstown-parramatta.json";
import { directionsUrl } from "@/services/mapboxDirections";
import { mapboxTokenState, mapboxTokenTail } from "@/config/mapboxToken";
import { getDiagnostics, resetDiagnostics } from "@/diagnostics/diagnostics";
import { routeErrorText } from "@/services/routingErrors";
import {
  MODE_CACHE_MS,
  MOTORBIKE_FALLBACK_NOTE,
  ModeRouteCache,
  fastestSeconds,
  fetchRoutesForMode,
  motorbikeRequestBody,
  walkTheBikeStretches,
  type ModeRoutes,
} from "@/travel/modeRouting";

const quay = { latitude: -33.861, longitude: 151.2108 };
const opera = { latitude: -33.8568, longitude: 151.2153 };
const json = (body: unknown, ok = true, status = ok ? 200 : 400) => Promise.resolve({ ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve("") } as Response);
// A real Mapbox public token has this shape: "pk." + two base64url parts.
const PK = "pk.eyJ1IjoidGVzdCJ9.abcDEF123";

function stub(map: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return map(url, init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const deps = (fetchImpl: typeof fetch, extra: Partial<{ googleKey: string; mapboxToken: string }> = {}) => ({
  mapboxToken: PK,
  googleKey: "",
  transit: async () => [],
  fetchImpl,
  ...extra,
});

describe("each mode asks the right provider", () => {
  it("bike = Mapbox cycling, walk = Mapbox walking; no car-only options sent", () => {
    const bike = directionsUrl({ profile: "cycling", origin: quay, destination: opera, avoid: { tolls: true, ferries: true } }, "t");
    expect(bike).toContain("/mapbox/cycling/");
    expect(bike).not.toContain("exclude=");
    expect(bike).not.toContain("maxspeed");
    expect(directionsUrl({ profile: "walking", origin: quay, destination: opera }, "t")).toContain("/mapbox/walking/");
    const drive = directionsUrl({ origin: quay, destination: opera, avoid: { ferries: true } }, "t");
    expect(drive).toContain("/mapbox/driving-traffic/");
    expect(drive).toContain("exclude=ferry");
  });

  it("a real bike route: time, and the stretch where you walk the bike", async () => {
    const { calls, fetchImpl } = stub(() => json(bikeJson));
    const r = await fetchRoutesForMode("bike", { origin: quay, destination: opera }, deps(fetchImpl));
    expect(calls[0].url).toContain("/mapbox/cycling/");
    expect(r.unavailable).toBeNull();
    expect(r.routes[0].distanceMeters).toBeCloseTo(841, -1);
    expect(fastestSeconds(r)).toBeGreaterThan(300);
    const walk = walkTheBikeStretches(r.routes[0]);
    expect(walk.length).toBeGreaterThan(0); // OSRM: part of this trip is "pushing bike"
  });

  it("a real walking route", async () => {
    const { fetchImpl } = stub(() => json(footJson));
    const r = await fetchRoutesForMode("walk", { origin: quay, destination: opera }, deps(fetchImpl));
    expect(r.routes[0].steps.length).toBeGreaterThan(1);
    expect(fastestSeconds(r)).toBeGreaterThan(fastestSeconds(await fetchRoutesForMode("bike", { origin: quay, destination: opera }, deps(stub(() => json(bikeJson)).fetchImpl)))!);
  });
});

describe("motorbike", () => {
  it("asks Google for TWO_WHEELER with the avoid options", () => {
    const body = motorbikeRequestBody({ origin: quay, destination: opera, avoid: { tolls: true } });
    expect(body.travelMode).toBe("TWO_WHEELER");
    expect(body.routeModifiers.avoidTolls).toBe(true);
  });
  it("where Google has no motorbike routing, the drive is shown and labelled", async () => {
    const { calls, fetchImpl } = stub((url) => (url.includes("routes.googleapis.com") ? json({ error: { code: 400 } }, false) : json(carJson)));
    const r = await fetchRoutesForMode("motorbike", { origin: quay, destination: opera }, deps(fetchImpl, { googleKey: "k" }));
    expect(calls.map((c) => (c.url.includes("googleapis") ? "google" : "mapbox"))).toEqual(["google", "mapbox"]);
    expect(r.note).toBe(MOTORBIKE_FALLBACK_NOTE);
    expect(r.routes.length).toBeGreaterThan(0);
  });
});

describe("unavailable modes say why; nothing invented", () => {
  it("no route -> greyed with a reason", async () => {
    const { fetchImpl } = stub(() => json({ code: "NoRoute", routes: [] }));
    const r = await fetchRoutesForMode("walk", { origin: quay, destination: opera }, deps(fetchImpl));
    expect(r).toEqual({ routes: [], note: null, unavailable: "No walking route between these places" });
    expect(fastestSeconds(r)).toBeNull();
  });
  it("offline -> 'No internet' (only when the request really couldn't go out), and no transit -> its own reason", async () => {
    const { fetchImpl } = stub(() => Promise.reject(new TypeError("Network request failed")));
    expect((await fetchRoutesForMode("bike", { origin: quay, destination: opera }, deps(fetchImpl))).unavailable).toBe("No internet");
    expect((await fetchRoutesForMode("transit", { origin: quay, destination: opera }, deps(fetchImpl))).unavailable).toBe("No public transport for this trip right now");
  });
});

describe("a build without Mapbox", () => {
  it("bike and walk come from the Google fallback instead of being greyed out", async () => {
    const asked: string[] = [];
    const r = await fetchRoutesForMode("walk", { origin: quay, destination: opera }, {
      mapboxToken: "",
      googleKey: "",
      transit: async () => [],
      fallback: async (mode) => {
        asked.push(mode);
        return (await fetchRoutesForMode("walk", { origin: quay, destination: opera }, deps(stub(() => json(footJson)).fetchImpl))).routes;
      },
    });
    expect(asked).toEqual(["walk"]);
    expect(r.unavailable).toBeNull();
    expect(r.routes.length).toBe(1);
  });
});

describe("cache: 2 minutes per mode and trip", () => {
  it("switching back within 2 min doesn't refetch; after, it does; a failure isn't kept", async () => {
    let now = 0;
    let n = 0;
    const ok: ModeRoutes = { routes: [], note: null, unavailable: null };
    const cache = new ModeRouteCache(async () => {
      n++;
      return ok;
    }, () => now);
    const req = { origin: quay, destination: opera };
    await cache.get("bike", req);
    await cache.get("bike", req);
    expect(n).toBe(1);
    await cache.get("walk", req);
    expect(n).toBe(2);
    now = MODE_CACHE_MS + 1;
    await cache.get("bike", req);
    expect(n).toBe(3);
    expect(ModeRouteCache.key("bike", { ...req, avoid: { ferries: true } })).not.toBe(ModeRouteCache.key("bike", req));
  });
});

describe("the TestFlight bug: placeholder text instead of a Mapbox token", () => {
  const PLACEHOLDER = "***** (This is a sensitive env variable. To access it, run command with --include-sensitive flag. Learn more.)";

  it("the token check sees placeholder / secret / junk for what they are", () => {
    expect(mapboxTokenState(PLACEHOLDER)).toBe("placeholder");
    expect(mapboxTokenState("")).toBe("missing");
    expect(mapboxTokenState("sk.eyJ1IjoidGVzdCJ9.abc")).toBe("secret");
    expect(mapboxTokenState("test-token")).toBe("malformed");
    expect(mapboxTokenState(PK)).toBe("ok");
    expect(mapboxTokenTail(PLACEHOLDER)).toBeNull();
    expect(mapboxTokenTail(PK)).toBe("F123");
  });

  it("no request is sent with a bad token; the reason is 'Map service key missing'", async () => {
    const { calls, fetchImpl } = stub(() => json(footJson));
    const r = await fetchRoutesForMode("walk", { origin: quay, destination: opera }, deps(fetchImpl, { mapboxToken: PLACEHOLDER }));
    expect(calls).toHaveLength(0);
    expect(r.unavailable).toBe("Map service key missing");
  });

  it("401 from Mapbox -> 'Map service rejected the key', recorded with its status for Diagnostics", async () => {
    resetDiagnostics();
    const { fetchImpl } = stub(() => json({ message: "Not Authorized - Invalid Token" }, false, 401));
    const r = await fetchRoutesForMode("bike", { origin: quay, destination: opera }, deps(fetchImpl));
    expect(r.unavailable).toBe("Map service rejected the key");
    expect(getDiagnostics().directions.bike).toMatchObject({ provider: "mapbox", status: 401, ok: false, message: "Map service rejected the key" });
  });

  it("403 -> restricted key; 422 -> bad request; 200 NoRoute -> no route (not a connection problem)", async () => {
    const at = async (status: number, body: unknown) => (await fetchRoutesForMode("walk", { origin: quay, destination: opera }, deps(stub(() => json(body, status < 300, status)).fetchImpl))).unavailable;
    expect(await at(403, { message: "Forbidden" })).toBe("Map service rejected the key (it isn't allowed for this app)");
    expect(await at(422, { code: "InvalidInput" })).toBe("Map service couldn't read this trip");
    expect(await at(200, { code: "NoRoute", routes: [] })).toBe("No walking route between these places");
  });

  it("bike/walk: when Mapbox refuses the key, Google answers instead", async () => {
    const { fetchImpl } = stub(() => json({ message: "Not Authorized" }, false, 401));
    const google = await fetchRoutesForMode("walk", { origin: quay, destination: opera }, deps(stub(() => json(footJson)).fetchImpl));
    const r = await fetchRoutesForMode("bike", { origin: quay, destination: opera }, { ...deps(fetchImpl), fallback: async () => google.routes });
    expect(r.unavailable).toBeNull();
    expect(r.routes).toBe(google.routes);
  });

  it("Drive in the mode row is the SAME Google result as the route preview card; Mapbox isn't asked", async () => {
    const { calls, fetchImpl } = stub(() => json(carJson));
    const previewCard = (await fetchRoutesForMode("walk", { origin: quay, destination: opera }, deps(stub(() => json(carJson)).fetchImpl))).routes;
    const asked: string[] = [];
    const r = await fetchRoutesForMode("drive", { origin: quay, destination: opera }, {
      ...deps(fetchImpl),
      fallback: async (mode) => (asked.push(mode), previewCard),
    });
    expect(asked).toEqual(["drive"]);
    expect(calls).toHaveLength(0);
    expect(r.routes).toBe(previewCard);
  });

  it("route error text for Google failures says the real reason", () => {
    const g = (status: string, message = "") => Object.assign(new Error(message), { name: "DirectionsApiError", status });
    expect(routeErrorText(g("REQUEST_DENIED"))).toBe("Map service rejected the key");
    expect(routeErrorText(g("ZERO_RESULTS"))).toBe("No route found");
    expect(routeErrorText(g("NETWORK_ERROR", "Network request failed"))).toBe("No internet");
    expect(routeErrorText(g("REQUEST_DENIED", "This API project is not authorized ... billing"))).toMatch(/billing/);
    expect(routeErrorText(new TypeError("Network request failed"))).toBe("No internet");
  });
});
