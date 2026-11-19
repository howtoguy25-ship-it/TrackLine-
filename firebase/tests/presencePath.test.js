// Pure unit tests for firebase/functions/presencePath.js -- no emulator needed. These cover the
// branch the emulator tests can't reach (they run with a fake Mapbox token on purpose): turning
// a REAL Mapbox match's road geometry into timed, compact path points.
const {
  haversineMeters,
  sanitizeLook,
  timeAlongGeometry,
  downsample,
  bearingDegrees,
  roundCoord,
} = require("../functions/presencePath");

describe("timeAlongGeometry (Mapbox [lng, lat] road geometry -> timed points)", () => {
  // An L-shaped road: 3 equal legs north, then 1 equal leg east.
  const geometry = [
    [151.2, -33.87],
    [151.2, -33.869],
    [151.2, -33.868],
    [151.2, -33.867],
  ];

  test("first and last vertices get exactly the batch's own start/end times", () => {
    const timed = timeAlongGeometry(geometry, 1000, 61000);
    expect(timed[0].t).toBe(1000);
    expect(timed[timed.length - 1].t).toBeCloseTo(61000, 5);
  });

  test("times are spread by DISTANCE along the road, not by vertex count", () => {
    // Second leg is 3x as long as the first -> it should take 3x as long.
    const uneven = [
      [151.2, -33.87],
      [151.2, -33.869],
      [151.2, -33.866],
    ];
    const timed = timeAlongGeometry(uneven, 0, 40000);
    expect(timed[1].t).toBeCloseTo(10000, -1);
  });

  test("swaps Mapbox's [lng, lat] order into {lat, lng}", () => {
    const timed = timeAlongGeometry(geometry, 0, 1000);
    expect(timed[0]).toMatchObject({ lat: -33.87, lng: 151.2 });
  });

  test("times never go backwards", () => {
    const timed = timeAlongGeometry(geometry, 0, 60000);
    for (let i = 1; i < timed.length; i++) expect(timed[i].t).toBeGreaterThanOrEqual(timed[i - 1].t);
  });

  test("a zero-length match (stationary) doesn't divide by zero", () => {
    const timed = timeAlongGeometry([[151.2, -33.87], [151.2, -33.87]], 500, 900);
    for (const p of timed) expect(Number.isFinite(p.t)).toBe(true);
  });
});

describe("downsample", () => {
  const points = Array.from({ length: 100 }, (_, i) => ({ i }));

  test("leaves a short list untouched", () => {
    expect(downsample(points.slice(0, 5), 24)).toHaveLength(5);
  });

  test("caps a long list at the limit and always keeps both endpoints", () => {
    const out = downsample(points, 24);
    expect(out).toHaveLength(24);
    expect(out[0].i).toBe(0);
    expect(out[out.length - 1].i).toBe(99);
  });

  test("keeps the original order", () => {
    const out = downsample(points, 10);
    for (let i = 1; i < out.length; i++) expect(out[i].i).toBeGreaterThan(out[i - 1].i);
  });
});

describe("sanitizeLook (a design shown on OTHER drivers' phones)", () => {
  const valid = { color: "#2DD4BF", eyeStyle: "normal", mouthStyle: "smile", trail: "dots" };

  test("passes a fully valid design through", () => {
    expect(sanitizeLook({ ...valid, colorBottom: "#60A5FA", accessory: "cap", accessoryColor: "#0F766E" })).toEqual({
      ...valid,
      colorBottom: "#60A5FA",
      accessory: "cap",
      accessoryColor: "#0F766E",
    });
  });

  test.each([
    ["missing colour", { ...valid, color: undefined }],
    ["non-hex colour", { ...valid, color: "red" }],
    ["short hex", { ...valid, color: "#FFF" }],
    ["unknown eye style", { ...valid, eyeStyle: "laser" }],
    ["unknown mouth style", { ...valid, mouthStyle: "fangs" }],
    ["not an object", "happy"],
    ["null", null],
  ])("rejects the whole design: %s", (_name, raw) => {
    expect(sanitizeLook(raw)).toBeNull();
  });

  test("drops unknown optional parts instead of storing them", () => {
    const look = sanitizeLook({ ...valid, accessory: "jetpack", accessoryColor: "#000000", trail: "fire", extra: "x" });
    expect(look).toEqual({ ...valid, trail: "none" });
  });

  test("an accessory colour is only kept alongside a valid accessory", () => {
    expect(sanitizeLook({ ...valid, accessoryColor: "#000000" }).accessoryColor).toBeUndefined();
  });
});

describe("geometry helpers", () => {
  test("haversineMeters: 0.001 deg of latitude is ~111m", () => {
    expect(haversineMeters(-33.87, 151.2, -33.869, 151.2)).toBeGreaterThan(110);
    expect(haversineMeters(-33.87, 151.2, -33.869, 151.2)).toBeLessThan(112);
  });

  test("bearingDegrees: north is 0, east is 90", () => {
    expect(bearingDegrees(0, 0, 1, 0)).toBeCloseTo(0, 5);
    expect(bearingDegrees(0, 0, 0, 1)).toBeCloseTo(90, 5);
  });

  test("roundCoord keeps 5 decimal places (~1m)", () => {
    expect(roundCoord(-33.868812345)).toBe(-33.86881);
  });
});
