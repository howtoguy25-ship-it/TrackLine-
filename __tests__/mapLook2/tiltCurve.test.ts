// Map look 2: the home map leans by zoom -- gently at street level, most around neighbourhood
// level, flat for the city/region view -- one smooth curve; live while pinching, never fighting a
// hand-set tilt; a soft horizon haze; quieter buildings; a grey disc under the arrow.
import { readFileSync } from "fs";
import { describe, expect, it } from "@jest/globals";
import { AutoTilt, MANUAL_TILT_DEG, TILT_DEADBAND, TILT_KEYS, tiltForZoom } from "@/map/tiltCurve";
import light from "@/map-v2/styles/trackline-light.json";
import dark from "@/map-v2/styles/trackline-dark.json";
import { USER_HALO } from "@/map-v2/layers/UserArrow";

describe("tilt curve", () => {
  it("street level leans gently, it leans more zooming out, then flattens for the wide view", () => {
    expect(tiltForZoom(17)).toBeGreaterThan(38);
    expect(tiltForZoom(17)).toBeLessThan(48);
    expect(tiltForZoom(14.5)).toBeGreaterThan(tiltForZoom(17)); // more curved out here
    expect(Math.max(...[13, 13.5, 14, 14.5, 15].map(tiltForZoom))).toBeGreaterThanOrEqual(55);
    expect(tiltForZoom(12)).toBeLessThan(tiltForZoom(14));
    expect(tiltForZoom(10.5)).toBe(0); // straight down, region view
    expect(tiltForZoom(8)).toBe(0);
    expect(tiltForZoom(20)).toBe(TILT_KEYS[TILT_KEYS.length - 1][1]);
  });
  it("is smooth: no jumps anywhere from zoom 8 to 20", () => {
    let prev = tiltForZoom(8);
    for (let z = 8.01; z <= 20; z += 0.01) {
      const t = tiltForZoom(z);
      expect(Math.abs(t - prev)).toBeLessThan(0.6);
      prev = t;
    }
  });
});

describe("live tilt while pinching", () => {
  it("pinching out from street level follows the curve, rate-limited", () => {
    const a = new AutoTilt();
    let pitch = tiltForZoom(17);
    let t = 0;
    const set: number[] = [];
    for (let z = 17; z >= 11; z -= 0.05) {
      t += 16;
      const p = a.frame({ zoom: z, pitch, gesture: true, timeMs: t });
      if (p != null) {
        set.push(p);
        pitch = p;
      }
    }
    expect(set.length).toBeGreaterThan(5);
    // Never more than one change per 60 ms; ends close to the curve.
    expect(Math.abs(pitch - tiltForZoom(11))).toBeLessThan(12);
    expect(a.manualTilt).toBe(false);
  });
  it("a two-finger tilt by hand stops it for good, until Re-centre resets it", () => {
    const a = new AutoTilt();
    const z = 16;
    let pitch = tiltForZoom(z);
    a.frame({ zoom: z, pitch, gesture: true, timeMs: 0 });
    for (let i = 1; i <= 20; i++) {
      pitch -= 1.5; // the driver tilting towards flat, zoom unchanged
      a.frame({ zoom: z, pitch, gesture: true, timeMs: i * 16 });
    }
    expect(Math.abs(pitch - tiltForZoom(z))).toBeGreaterThan(MANUAL_TILT_DEG);
    expect(a.manualTilt).toBe(true);
    expect(a.frame({ zoom: 13, pitch, gesture: false, timeMs: 1000 })).toBeNull();
    a.reset();
    expect(a.frame({ zoom: 13, pitch, gesture: false, timeMs: 2000 })).toBeCloseTo(tiltForZoom(13));
  });
  it("leaves the map alone inside the deadband", () => {
    const a = new AutoTilt();
    expect(a.frame({ zoom: 17, pitch: tiltForZoom(17) + TILT_DEADBAND / 2, gesture: false, timeMs: 0 })).toBeNull();
  });
});

describe("wired into the map", () => {
  const mapSrc = readFileSync("src/map-v2/TrackLineMap.tsx", "utf8");
  const screen = readFileSync("src/screens/MapScreen.tsx", "utf8");
  it("live only during the driver's own gesture, eased at rest, never during the app's animations", () => {
    expect(mapSrc).toMatch(/if \(!gesture && !atRest\) return;/);
    expect(mapSrc).toMatch(/applyAutoTilt\(state, true\)/);
  });
  it("home map only, not the flat Map view; Re-centre forgets a hand tilt", () => {
    expect(screen).toMatch(/autoTilt=\{isHomeIdle && settings\.defaultMapViewStyle !== "flat"\}/);
    expect(screen).toMatch(/setAutoTiltResetKey\(\(k\) => k \+ 1\)/);
    expect(screen).toMatch(/const DEFAULT_IDLE_PITCH = Math\.round\(tiltForZoom\(HOME_FOLLOW_ZOOM\)\);/);
  });
});

describe("cleaner map + horizon haze", () => {
  it("both styles fade the distance into a soft haze", () => {
    for (const st of [light, dark] as { fog?: { range: number[]; "horizon-blend": number } }[]) {
      expect(st.fog).toBeTruthy();
      expect(st.fog!.range[0]).toBeGreaterThan(0.5);
      expect(st.fog!["horizon-blend"]).toBeGreaterThan(0);
    }
  });
  it("buildings only from street level, soft, no outline", () => {
    const b = (light as { layers: { id: string; minzoom?: number; paint?: Record<string, unknown> }[] }).layers.find((l) => l.id === "buildings")!;
    expect(b.minzoom).toBeGreaterThanOrEqual(15.5);
    expect(b.paint!["fill-outline-color"]).toBeUndefined();
  });
});

describe("grey disc under your arrow", () => {
  it("a disc layer sits between the accuracy ring and the arrow, grey, growing a little with zoom", () => {
    const src = readFileSync("src/map-v2/layers/UserArrow.tsx", "utf8");
    const disc = src.indexOf('id="me-halo"');
    expect(disc).toBeGreaterThan(src.indexOf('id="me-accuracy"'));
    expect(disc).toBeLessThan(src.indexOf('id="me-arrow"'));
    expect(USER_HALO.color).toMatch(/^rgba\(128, 134, 145, 0\.\d+\)$/);
    expect(USER_HALO.radius[0]).toBe("interpolate");
  });
});
