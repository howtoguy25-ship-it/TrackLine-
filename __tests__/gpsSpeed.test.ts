// The speedometer's reading from a GPS fix: m/s -> km/h, -1/NaN/none handled, no impossible jumps.
import { describe, expect, it } from "@jest/globals";
import { MAX_PLAUSIBLE_KMH, displayKmh, rawSpeedKmh } from "@/utils/gpsSpeed";

const at = (lat: number, lng: number, t: number) => ({ latitude: lat, longitude: lng, timestamp: t });

describe("GPS speed", () => {
  it("converts metres per second to km/h (×3.6)", () => {
    expect(rawSpeedKmh(10, at(0, 0, 0), null)).toBeCloseTo(36);
    expect(rawSpeedKmh(27.7778, at(0, 0, 0), null)).toBeCloseTo(100, 1);
    expect(rawSpeedKmh(0, at(0, 0, 0), null)).toBe(0);
  });
  it("-1 (iOS: unknown) and NaN fall back to distance over time, not a number from nowhere", () => {
    // 100 m north in 10 s = 36 km/h
    const last = at(-33.86, 151.2, 0);
    const here = at(-33.86 + 100 / 111195, 151.2, 10000);
    expect(rawSpeedKmh(-1, here, last)).toBeCloseTo(36, 0);
    expect(rawSpeedKmh(NaN, here, last)).toBeCloseTo(36, 0);
    expect(rawSpeedKmh(null, here, null)).toBe(0);
  });
  it("the 3253 km/h case: two fixes milliseconds apart are skipped, not divided", () => {
    const last = at(-33.86, 151.2, 1000);
    const here = at(-33.86 + 10 / 111195, 151.2, 1011); // 10 m in 11 ms
    expect(rawSpeedKmh(-1, here, last)).toBeNull();
  });
  it("anything faster than a car can go is treated as a bad fix", () => {
    expect(rawSpeedKmh(1000, at(0, 0, 0), null)).toBeNull();
    const last = at(-33.86, 151.2, 0);
    const jump = at(-33.0, 151.2, 2000); // ~95 km in 2 s
    expect(rawSpeedKmh(-1, jump, last)).toBeNull();
  });
  it("the dial shows a whole number from 0 to 300, 0 when invalid", () => {
    expect(displayKmh(NaN)).toBe(0);
    expect(displayKmh(-3)).toBe(0);
    expect(displayKmh(null)).toBe(0);
    expect(displayKmh(3253)).toBe(MAX_PLAUSIBLE_KMH);
    expect(displayKmh(59.6)).toBe(60);
  });
});
