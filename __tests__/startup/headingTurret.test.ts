// Startup §4: simulated compass + GPS streams -- rotating in place, stopped at the lights, a
// magnetic spike, slow-to-fast -- end pointing the right way, never turning faster than 90°/s.
import { describe, expect, it } from "@jest/globals";
import { CompassFilter, HeadingTurret, targetHeading, TURRET_MAX_DEG_S, DEADBAND_DEG } from "@/nav/headingTurret";
import { shortestDelta } from "@/nav/headingFilter";

const FRAME = 1000 / 60;
/** Run the turret at 60 fps for `ms`, feeding `targetAt(t)`; returns the headings drawn. */
function run(turret: HeadingTurret, ms: number, targetAt: (t: number) => number | null, start = 0) {
  const out: { t: number; h: number }[] = [];
  for (let t = start; t <= start + ms; t += FRAME) {
    turret.setTarget(targetAt(t));
    const h = turret.step(t);
    if (h !== null) out.push({ t, h });
  }
  return out;
}
function maxRate(trace: { t: number; h: number }[]) {
  let max = 0;
  for (let i = 1; i < trace.length; i++) max = Math.max(max, Math.abs(shortestDelta(trace[i - 1].h, trace[i].h)) / ((trace[i].t - trace[i - 1].t) / 1000));
  return max;
}

describe("the turret", () => {
  it("rotating in place: follows a person turning 180° and never exceeds 90°/s", () => {
    const turret = new HeadingTurret();
    turret.setTarget(0);
    turret.step(0);
    const trace = run(turret, 4000, () => 180);
    expect(maxRate(trace)).toBeLessThanOrEqual(TURRET_MAX_DEG_S + 0.5);
    expect(Math.abs(shortestDelta(trace[trace.length - 1].h, 180))).toBeLessThan(0.5);
    // Eases in: the first 100 ms turn well under full speed.
    const early = trace.filter((p) => p.t <= 100);
    expect(maxRate(early)).toBeLessThan(TURRET_MAX_DEG_S);
  });
  it("takes the short way round (350° -> 10° turns +20°, not -340°)", () => {
    const turret = new HeadingTurret();
    turret.setTarget(350);
    turret.step(0);
    const trace = run(turret, 2000, () => 10);
    for (let i = 1; i < trace.length; i++) expect(shortestDelta(trace[i - 1].h, trace[i].h)).toBeGreaterThanOrEqual(-0.001);
    expect(Math.abs(shortestDelta(trace[trace.length - 1].h, 10))).toBeLessThan(0.5);
  });
  it("ignores jitter under 4° while at rest", () => {
    const turret = new HeadingTurret();
    turret.setTarget(90);
    turret.step(0);
    const trace = run(turret, 2000, (t) => 90 + (DEADBAND_DEG - 1) * Math.sin(t / 50));
    expect(trace.every((p) => Math.abs(shortestDelta(p.h, 90)) < 0.01)).toBe(true);
  });
});

describe("the compass", () => {
  it("stopped at the lights: a magnetic spike (>60° in <0.5 s) is ignored", () => {
    const c = new CompassFilter();
    let t = 0;
    for (; t < 2000; t += 100) c.push({ timeMs: t, heading: 45, accuracyDeg: 15 });
    c.push({ timeMs: t, heading: 170, accuracyDeg: 15 }); // spike
    c.push({ timeMs: t + 100, heading: 172, accuracyDeg: 15 });
    expect(c.good).toBe(45);
    for (let k = 2; k < 6; k++) c.push({ timeMs: t + k * 100, heading: 45, accuracyDeg: 15 }); // back
    expect(c.good).toBe(45);
  });
  it("…but a real turn that holds for 1 s is taken", () => {
    const c = new CompassFilter();
    for (let t = 0; t < 1000; t += 100) c.push({ timeMs: t, heading: 0, accuracyDeg: 10 });
    for (let t = 1000; t <= 2200; t += 100) c.push({ timeMs: t, heading: 120, accuracyDeg: 10 });
    expect(Math.abs(shortestDelta(c.good!, 120))).toBeLessThan(1);
  });
  it("poor accuracy keeps the last good heading", () => {
    const c = new CompassFilter();
    c.push({ timeMs: 0, heading: 30, accuracyDeg: 10 });
    c.push({ timeMs: 100, heading: 200, accuracyDeg: 50 });
    c.push({ timeMs: 200, heading: 210, accuracyDeg: null });
    expect(c.good).toBe(30);
  });
  it("low-pass: a steady new direction is approached smoothly, not snapped", () => {
    const c = new CompassFilter();
    c.push({ timeMs: 0, heading: 0, accuracyDeg: 10 });
    const first = c.push({ timeMs: 600, heading: 40, accuracyDeg: 10 })!;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(40);
  });
});

describe("compass when slow, GPS course when moving, blended between", () => {
  it("stopped: compass; > 8 km/h: GPS course; 3-8: smooth blend", () => {
    expect(targetHeading({ speedKmh: 0, gps: 90, compass: 180 })).toBe(180);
    expect(targetHeading({ speedKmh: 30, gps: 90, compass: 180 })).toBe(90);
    const mid = targetHeading({ speedKmh: 5.5, gps: 90, compass: 180 })!;
    expect(mid).toBeGreaterThan(90);
    expect(mid).toBeLessThan(180);
  });
  it("slow-to-fast: as speed rises 0 -> 12 km/h the arrow moves from the compass to the course with no jump faster than 90°/s", () => {
    const turret = new HeadingTurret();
    turret.setTarget(180);
    turret.step(0);
    const trace = run(turret, 6000, (t) => targetHeading({ speedKmh: (t / 6000) * 12, gps: 90, compass: 180 }));
    expect(maxRate(trace)).toBeLessThanOrEqual(TURRET_MAX_DEG_S + 0.5);
    expect(Math.abs(shortestDelta(trace[trace.length - 1].h, 90))).toBeLessThan(1);
  });
});

describe("wired into the map", () => {
  const src = require("fs").readFileSync("src/screens/MapScreen.tsx", "utf8") as string;
  it("the compass is read on the home map too (not only while driving) and feeds the turret", () => {
    expect(src).toMatch(/const good = compassFilterRef\.current\.push\(\{ timeMs: now, heading: value, accuracyDeg \}\);\s*turret\.setTarget\(targetHeading\(\{ \.\.\.turretInputsRef\.current, compass: good \}\)\);/);
    expect(src).not.toMatch(/useEffect\(\(\) => \{\s*if \(!route\) return;\s*let subscription: Location\.LocationSubscription/);
  });
  it("off a drive the arrow turns by the turret; the heading-up home map turns with it (not north-up, not driving)", () => {
    expect(src).toMatch(/turret: route \? null : turret,/);
    expect(src).toMatch(/if \(route \|\| northUp\) return;[\s\S]{0,400}camera\.move\("follow", \{ heading: h \}, \{ duration: 100 \}\)/);
  });
});
