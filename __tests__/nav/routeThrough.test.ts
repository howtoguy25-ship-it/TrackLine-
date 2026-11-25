// getRouteThrough pins the live-traffic request to the road you're on: pass-through (via) points,
// a stop kept as a real stop, live traffic speeds requested. Its time is what shortcuts are judged
// against (src/nav/shortcuts.ts root cause 3).
const mockNetFetch = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock("@/services/netFetch", () => ({ netFetch: (...a: unknown[]) => mockNetFetch(...a) }));

import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getRouteThrough } from "@/services/directions";

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json, text: async () => "" });

describe("getRouteThrough", () => {
  beforeEach(() => {
    mockNetFetch.mockReset();
  });

  it("sends via points as pass-through, a stop as a stop, and asks for traffic on the line", async () => {
    mockNetFetch.mockResolvedValue(ok({ routes: [{ distanceMeters: 4600, duration: "900s", staticDuration: "700s", polyline: { encodedPolyline: "" }, legs: [] }] }));
    const r = await getRouteThrough({ latitude: -33.9, longitude: 151 }, { latitude: -33.9, longitude: 151.05 }, [
      { point: { latitude: -33.9, longitude: 151.01 }, via: true },
      { point: { latitude: -33.9, longitude: 151.03 }, via: false },
    ]);
    const [service, url, init] = mockNetFetch.mock.calls[0] as [string, string, { body: string }];
    expect(service).toBe("routes");
    expect(url).toMatch(/routes\.googleapis\.com/);
    const body = JSON.parse(init.body);
    expect(body.intermediates[0].via).toBe(true);
    expect(body.intermediates[1].via).toBeUndefined();
    expect(body.routingPreference).toBe("TRAFFIC_AWARE");
    expect(body.extraComputations).toContain("TRAFFIC_ON_POLYLINE");
    expect(body.computeAlternativeRoutes).toBeUndefined();
    expect(r.durationInTrafficSeconds).toBe(900);
  });

  it("falls back to the classic API with via: waypoints when the Routes API refuses", async () => {
    mockNetFetch
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}), text: async () => "" })
      .mockResolvedValueOnce(ok({ status: "OK", routes: [{ legs: [{ steps: [], distance: { value: 1 }, duration: { value: 1 } }], overview_polyline: { points: "" } }] }));
    await getRouteThrough({ latitude: -33.9, longitude: 151 }, { latitude: -33.9, longitude: 151.05 }, [{ point: { latitude: -33.9, longitude: 151.01 }, via: true }]);
    const classicUrl = decodeURIComponent(mockNetFetch.mock.calls[1][1] as string);
    expect(classicUrl).toMatch(/waypoints=via:-33\.9,151\.01/);
    expect(classicUrl).toMatch(/departure_time=now/);
  });
});
