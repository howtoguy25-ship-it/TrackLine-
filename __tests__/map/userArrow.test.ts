// Permanent fix §1: the arrow eases between fixes (no jumps), turns the short way, keeps its
// heading when there's none, drops stale/out-of-order fixes, snaps on a teleport.
import { describe, expect, it } from "@jest/globals";
import { MAX_EASE_MS, MotionSmoother, turn } from "@/map-v2/userMotion";

const f = (lat: number, t: number, heading: number | null = 0) => ({ latitude: lat, longitude: 151, heading, timeMs: t });
const D = 0.0001; // ~11 m

describe("user arrow motion", () => {
  it("glides from the old fix to the new one over the gap between fixes", () => {
    const m = new MotionSmoother();
    m.push(f(-33.9, 0), 0);
    m.push(f(-33.9 + D, 1000), 1000);
    const mid = m.at(1500)!;
    expect(mid.latitude).toBeGreaterThan(-33.9);
    expect(mid.latitude).toBeLessThan(-33.9 + D);
    expect(m.at(2000)!.latitude).toBeCloseTo(-33.9 + D, 9);
    expect(m.moving(1500)).toBe(true);
    expect(m.moving(2001)).toBe(false);
  });
  it("never eases longer than 1 s even when fixes are far apart", () => {
    const m = new MotionSmoother();
    m.push(f(-33.9, 0), 0);
    m.push(f(-33.9 + D, 5000), 5000);
    expect(m.at(5000 + MAX_EASE_MS)!.latitude).toBeCloseTo(-33.9 + D, 9);
  });
  it("a new fix mid-glide starts from where the arrow is drawn (no jump back)", () => {
    const m = new MotionSmoother();
    m.push(f(-33.9, 0), 0);
    m.push(f(-33.9 + D, 1000), 1000);
    const drawn = m.at(1500)!;
    m.push(f(-33.9 + 2 * D, 1500), 1500);
    expect(m.at(1500)!.latitude).toBeCloseTo(drawn.latitude, 9);
  });
  it("drops out-of-order and repeated fixes", () => {
    const m = new MotionSmoother();
    m.push(f(-33.9, 1000), 0);
    expect(m.push(f(-33.8, 900), 10)).toBe(false);
    expect(m.push(f(-33.8, 1000), 10)).toBe(false);
    expect(m.at(10)!.latitude).toBeCloseTo(-33.9, 9);
  });
  it("turns the short way across north; no heading keeps the last one; starts north", () => {
    expect(turn(350, 10)).toBe(20);
    expect(turn(10, 350)).toBe(-20);
    const m = new MotionSmoother();
    m.push(f(-33.9, 0, null), 0);
    expect(m.at(0)!.heading).toBe(0);
    m.push(f(-33.9, 1000, 350), 1000);
    m.push(f(-33.9, 2000, 10), 2000);
    const h = m.at(2100)!.heading;
    expect(h > 340 || h < 20).toBe(true);
    m.push(f(-33.9, 3000, null), 3500);
    expect(m.at(5000)!.heading).toBeCloseTo(10, 0);
  });
  it("a teleport (> 500 m) snaps instead of sliding across the city", () => {
    const m = new MotionSmoother();
    m.push(f(-33.9, 0), 0);
    m.push(f(-33.8, 1000), 1000);
    expect(m.at(1000)!.latitude).toBeCloseTo(-33.8, 9);
  });
});

describe("the arrow image bundles (Metro)", () => {
  it("is required by its base name, with 1x / 2x / 3x files present; nothing requires an @Nx file", () => {
    const fs = require("fs") as typeof import("fs");
    const src = fs.readFileSync("src/map-v2/layers/UserArrow.tsx", "utf8");
    expect(src).toMatch(/require\("\.\.\/\.\.\/\.\.\/assets\/map\/user-arrow\.png"\)/);
    for (const f of ["user-arrow.png", "user-arrow@2x.png", "user-arrow@3x.png"]) expect([f, fs.existsSync(`assets/map/${f}`)]).toEqual([f, true]);
    // Requiring "x@3x.png" directly made `expo export` fail ("Unable to resolve module"), which
    // jest never noticed: guard every source file.
    const { execSync } = require("child_process") as typeof import("child_process");
    const hits = execSync("grep -rnE \"require\\(['\\\"][^'\\\"]*@[0-9]x\\.(png|jpg)['\\\"]\\)\" src || true", { encoding: "utf8" }).trim();
    expect(hits).toBe("");
  });
});
