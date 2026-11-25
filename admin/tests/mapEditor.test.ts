// Gap 16: the map editor's pin colours and the view box it sends the server.
import { describe, expect, it } from "vitest";
import { pinColour, viewBox } from "../lib/mapEditor";

const b = (s: number, w: number, n: number, e: number) => ({ getSouth: () => s, getWest: () => w, getNorth: () => n, getEast: () => e });

describe("map editor", () => {
  it("needs approval > fixed > live report", () => {
    expect(pinColour({ permanent: true, awaitingApproval: true })).toBe("#D97706");
    expect(pinColour({ permanent: true, awaitingApproval: false })).toBe("#2563EB");
    expect(pinColour({ permanent: false, awaitingApproval: false })).toBe("#DC2626");
  });
  it("sends the view box; too wide = ask to zoom in (same limit as the server)", () => {
    expect(viewBox(b(-33.95, 151, -33.85, 151.1))).toEqual({ south: -33.95, west: 151, north: -33.85, east: 151.1 });
    expect(viewBox(b(-35, 150, -33, 152))).toBeNull();
  });
});
