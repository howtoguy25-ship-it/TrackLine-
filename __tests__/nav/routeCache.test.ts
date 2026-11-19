// Starting a drive with no internet: saved routes to the same place, planned from near here,
// are offered; anything else isn't. And which failures count as "no connection".
import { describe, expect, it, jest } from "@jest/globals";
import { addEntry, findEntry, savedAgo, MAX_ENTRIES, MAX_AGE_MS, type CachedRouteSet } from "@/nav/routeCache";
import { isConnectionFailure, RoutingError } from "@/services/routingErrors";
import { routeBounds, MAX_SPAN_DEG } from "@/map-v2/offlineArea";

jest.mock("@/map-v2/mapbox", () => ({ loadMapbox: () => null }));

const STACEY = { latitude: -33.9166, longitude: 151.0353 }; // 323 Stacey St area
const BAZENTIN = { latitude: -33.9236, longitude: 151.0573 }; // 40 Bazentin St area
const route = (id: string) => ({ polyline: [STACEY, BAZENTIN], steps: [], distanceMeters: 2500, durationSeconds: 300, etaText: "5 mins", distanceText: "2.5 km", summary: id }) as never;
const entry = (over: Partial<CachedRouteSet> = {}): CachedRouteSet => ({ savedAt: 1_000, origin: STACEY, destination: BAZENTIN, destinationName: "40 Bazentin St", routes: [route("a")], ...over });

describe("saved routes for offline start", () => {
  it("finds the saved route to the same place from near where it was planned", () => {
    const list = [entry()];
    const nearby = { latitude: STACEY.latitude + 0.002, longitude: STACEY.longitude }; // ~220 m
    expect(findEntry(list, nearby, BAZENTIN, 2_000)?.routes[0]).toMatchObject({ summary: "a" });
  });

  it("not from far away, not to a different place, not when too old", () => {
    const list = [entry()];
    expect(findEntry(list, { latitude: -33.95, longitude: 151.0353 }, BAZENTIN, 2_000)).toBeNull();
    expect(findEntry(list, STACEY, { latitude: -33.87, longitude: 151.21 }, 2_000)).toBeNull();
    expect(findEntry(list, STACEY, BAZENTIN, 1_000 + MAX_AGE_MS + 1)).toBeNull();
  });

  it("newest first; the same trip is replaced, not duplicated; at most 12 kept", () => {
    let list = addEntry([], entry({ savedAt: 1, routes: [route("old")] }), 10);
    list = addEntry(list, entry({ savedAt: 2, routes: [route("new")] }), 10);
    expect(list).toHaveLength(1);
    expect(findEntry(list, STACEY, BAZENTIN, 10)?.routes[0]).toMatchObject({ summary: "new" });
    for (let i = 0; i < 20; i++) list = addEntry(list, entry({ savedAt: 3 + i, destination: { latitude: -33 - i * 0.01, longitude: 151 } }), 30);
    expect(list.length).toBe(MAX_ENTRIES);
  });

  it("says how old the saved route is", () => {
    expect(savedAgo(0, 1000)).toBe("today");
    expect(savedAgo(0, 86_400_000 * 1.5)).toBe("yesterday");
    expect(savedAgo(0, 86_400_000 * 4.2)).toBe("4 days ago");
  });
});

describe("no connection", () => {
  it("offline / timeouts / network errors count; a refused key or no route doesn't", () => {
    expect(isConnectionFailure(new TypeError("Network request failed"))).toBe(true);
    expect(isConnectionFailure(new RoutingError("offline", null))).toBe(true);
    expect(isConnectionFailure(new RoutingError("timeout", null))).toBe(true);
    expect(isConnectionFailure(Object.assign(new Error("x"), { name: "RequestTimeoutError" }))).toBe(true);
    expect(isConnectionFailure(new RoutingError("no_route", null))).toBe(false);
    expect(isConnectionFailure(new Error("REQUEST_DENIED"))).toBe(false);
  });
});

describe("map tiles along the route", () => {
  it("the route's own area with a margin; very long routes aren't downloaded", () => {
    const b = routeBounds([STACEY, BAZENTIN])!;
    expect(b[0][0]).toBeGreaterThan(BAZENTIN.longitude);
    expect(b[1][1]).toBeLessThan(BAZENTIN.latitude);
    expect(routeBounds([STACEY, { latitude: STACEY.latitude - MAX_SPAN_DEG - 0.1, longitude: STACEY.longitude }])).toBeNull();
  });
});
