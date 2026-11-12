// Real unit checks for src/services/presencePlayback.ts -- run with:
//   npx tsx scripts/test-presence-playback.ts
// Plain node:assert, no test framework (this app has none at the root) -- see TEST_RESULTS.md.
// A tiny local assert rather than node:assert -- this file is typechecked by the app's own
// tsconfig, which (correctly) has no Node type definitions.
const assert = {
  ok(value: unknown, message?: string): void {
    if (!value) throw new Error(message ?? "assertion failed");
  },
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  },
};
import {
  poseAt,
  displayTimeFor,
  leanDegrees,
  playbackBudget,
  PRESENCE_PLAYBACK_DELAY_MS,
  DEAD_RECKON_MAX_MS,
  MAX_LEAN_DEGREES,
  type PathPoint,
} from "../src/services/presencePlayback";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const near = (a: number, b: number, eps = 1e-7) => Math.abs(a - b) < eps;

// A driver heading due NORTH at a steady pace: 0.001° of latitude (~111m) every 10s.
const north: PathPoint[] = [
  { lat: -33.87, lng: 151.2, t: 1_000_000 },
  { lat: -33.869, lng: 151.2, t: 1_010_000 },
  { lat: -33.868, lng: 151.2, t: 1_020_000 },
];

console.log("presencePlayback");
check("empty path -> no pose", () => assert.equal(poseAt([], 5), null));
check("before the first point -> parked on it, not moving", () => {
  const p = poseAt(north, 999_000)!;
  assert.ok(near(p.lat, -33.87) && !p.moving);
});
check("exactly halfway through a segment -> halfway between its points", () => {
  const p = poseAt(north, 1_005_000)!;
  assert.ok(near(p.lat, -33.8695), `lat ${p.lat}`);
  assert.ok(p.moving);
});
check("heading north reads as ~0 degrees", () => {
  const h = poseAt(north, 1_015_000)!.headingDeg!;
  assert.ok(h < 1 || h > 359, `heading ${h}`);
});
check("position is continuous across a point boundary", () => {
  const a = poseAt(north, 1_009_999)!;
  const b = poseAt(north, 1_010_001)!;
  assert.ok(Math.abs(a.lat - b.lat) < 1e-6);
});
check("dead-reckoning: just past the last point keeps going the same way at the same speed", () => {
  const p = poseAt(north, 1_025_000)!; // 5s past the end, at 0.0001 deg/s
  assert.ok(near(p.lat, -33.8675, 1e-6), `lat ${p.lat}`);
  assert.ok(p.moving);
});
check("dead-reckoning is CAPPED: long after the last point the Tracky has stopped, not sailed off", () => {
  const atCap = poseAt(north, 1_020_000 + DEAD_RECKON_MAX_MS)!;
  const wayLater = poseAt(north, 1_020_000 + 10 * 60 * 1000)!;
  assert.ok(near(atCap.lat, wayLater.lat), "position must stop advancing at the cap");
  assert.equal(wayLater.moving, false);
});
check("dead-reckoning speed is capped even if two points imply an absurd speed", () => {
  const teleport: PathPoint[] = [
    { lat: 0, lng: 0, t: 0 },
    { lat: 1, lng: 0, t: 1000 }, // 111km in one second
  ];
  const p = poseAt(teleport, 1000 + DEAD_RECKON_MAX_MS)!;
  const metersCoasted = (p.lat - 1) * 111320;
  assert.ok(metersCoasted <= 45 * (DEAD_RECKON_MAX_MS / 1000) + 1, `coasted ${metersCoasted}m`);
});
check("a single-point path never moves and never throws", () => {
  const p = poseAt([north[0]], 9_999_999)!;
  assert.ok(near(p.lat, -33.87) && !p.moving);
});
check("two points at the same place -> not 'moving', no NaN", () => {
  const still: PathPoint[] = [
    { lat: 1, lng: 1, t: 0 },
    { lat: 1, lng: 1, t: 10_000 },
  ];
  const mid = poseAt(still, 5000)!;
  const after = poseAt(still, 15_000)!;
  assert.ok(!mid.moving && !after.moving);
  assert.ok(Number.isFinite(after.lat) && Number.isFinite(after.lng));
});

console.log("displayTimeFor");
check("at the moment an update arrives, playback is the full delay behind it", () => {
  assert.equal(displayTimeFor(5_000_000, 777, 777), 5_000_000 - PRESENCE_PLAYBACK_DELAY_MS);
});
check("it then advances by exactly the viewer's own elapsed time", () => {
  assert.equal(displayTimeFor(5_000_000, 1000, 31_000), 5_000_000 - PRESENCE_PLAYBACK_DELAY_MS + 30_000);
});
check("a viewer clock that jumps BACKWARDS never rewinds playback before the delay point", () => {
  assert.equal(displayTimeFor(5_000_000, 10_000, 2_000), 5_000_000 - PRESENCE_PLAYBACK_DELAY_MS);
});
check("consecutive one-minute batches join up: batch 2 starts where batch 1 ends", () => {
  const w1 = 10_000_000;
  const endOfBatch1 = displayTimeFor(w1, 0, 60_000);
  const startOfBatch2 = displayTimeFor(w1 + 60_000, 60_000, 60_000);
  assert.equal(endOfBatch1, startOfBatch2);
});
check("playback never shows a point newer than the server's 60s privacy delay allows", () => {
  // The newest point the server will publish in a doc written at w is w-60s. A full minute of
  // playback after receipt reaches exactly that, never past it.
  const w = 10_000_000;
  assert.ok(displayTimeFor(w, 0, 60_000) <= w - 60_000);
});

console.log("leanDegrees");
check("heading east leans fully one way, west the other, north/south not at all", () => {
  const pose = (headingDeg: number) => ({ lat: 0, lng: 0, headingDeg, moving: true });
  assert.ok(near(leanDegrees(pose(90)), MAX_LEAN_DEGREES, 1e-9));
  assert.ok(near(leanDegrees(pose(270)), -MAX_LEAN_DEGREES, 1e-9));
  assert.ok(Math.abs(leanDegrees(pose(0))) < 1e-9);
  assert.ok(Math.abs(leanDegrees(pose(180))) < 1e-9);
});
check("a stopped Tracky stands upright", () => {
  assert.equal(leanDegrees({ lat: 0, lng: 0, headingDeg: 90, moving: false }), 0);
});

console.log("playbackBudget");
check("more Trackys on screen -> slower ticks and fewer (then no) trail particles", () => {
  const few = playbackBudget(3, false);
  const some = playbackBudget(12, false);
  const many = playbackBudget(40, false);
  assert.ok(few.tickMs < some.tickMs && some.tickMs < many.tickMs);
  assert.ok(few.trailParticles > some.trailParticles && many.trailParticles === 0);
});
check("Reduce Motion: no trails, and only an occasional position update", () => {
  const b = playbackBudget(1, true);
  assert.equal(b.trailParticles, 0);
  assert.ok(b.tickMs >= 5000);
});

console.log(`\n${passed} checks passed`);
