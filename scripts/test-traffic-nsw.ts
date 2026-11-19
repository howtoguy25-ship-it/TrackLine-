// Real unit checks for src/services/trafficNswModel.ts -- run with:
//   npx tsx scripts/test-traffic-nsw.ts
import {
  EMPTY_TRAFFIC_SNAPSHOT,
  ROADWORK_RADIUS_METERS,
  TRAFFIC_STALE_AFTER_MS,
  formatIncidentAge,
  incidentStyle,
  incidentsNear,
  isTrafficStale,
  parseTrafficSnapshot,
  type TrafficIncident,
} from "../src/services/trafficNswModel";

const assert = {
  ok(value: unknown, message?: string): void {
    if (!value) throw new Error(message ?? "assertion failed");
  },
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
};
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const sydney = { latitude: -33.8688, longitude: 151.2093 };
// ~111m per 0.001 deg of latitude.
const at = (metersNorth: number, extra: Partial<TrafficIncident> = {}): TrafficIncident => ({
  id: `incident:${metersNorth}`,
  kind: "incident",
  category: "Crash",
  headline: "Crash",
  where: "",
  delay: "",
  advice: "",
  major: false,
  lat: sydney.latitude + metersNorth / 111_320,
  lng: sydney.longitude,
  updatedAt: null,
  ...extra,
});

console.log("reading the shared snapshot");
check("nothing there -> not configured, no incidents", () => {
  assert.equal(parseTrafficSnapshot(undefined), EMPTY_TRAFFIC_SNAPSHOT);
  assert.equal(parseTrafficSnapshot("nope"), EMPTY_TRAFFIC_SNAPSHOT);
});
check("the server's 'no key yet' document reads as not configured", () => {
  const snapshot = parseTrafficSnapshot({ configured: false, checkedAt: 1, incidents: [] });
  assert.equal(snapshot.configured, false);
  assert.equal(snapshot.incidents.length, 0);
});
check("a normal document comes through", () => {
  const snapshot = parseTrafficSnapshot({
    configured: true,
    updatedAt: 5000,
    failedKinds: ["roadwork"],
    incidents: [at(100), at(200, { kind: "flood", id: "flood:1" })],
  });
  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.updatedAt, 5000);
  assert.equal(snapshot.incidents.length, 2);
  assert.equal(snapshot.failedKinds.join(","), "roadwork");
});
check("malformed incidents are skipped one by one; the rest still show", () => {
  const snapshot = parseTrafficSnapshot({
    configured: true,
    incidents: [
      null, 7, "x", {},
      { ...at(1), lat: "nope" },
      { ...at(2), lat: 999 },
      { ...at(3), id: "" },
      { ...at(4), kind: "meteor" },
      at(5),
    ],
  });
  assert.equal(snapshot.incidents.length, 1);
  assert.equal(snapshot.incidents[0].id, "incident:5");
});
check("incidents that aren't a list don't throw", () => {
  assert.equal(parseTrafficSnapshot({ configured: true, incidents: "lots" }).incidents.length, 0);
});

console.log("which incidents get drawn");
check("out of range is left out; in range is nearest first", () => {
  const near = incidentsNear([at(30_000), at(500), at(45_000), at(5_000)], sydney);
  assert.equal(near.map((i) => i.id).join(","), "incident:500,incident:5000,incident:30000");
});
check("ordinary roadworks only show when close; a major one shows from further out", () => {
  const far = ROADWORK_RADIUS_METERS + 3_000;
  const near = incidentsNear(
    [
      at(far, { kind: "roadwork", id: "roadwork:far" }),
      at(2_000, { kind: "roadwork", id: "roadwork:near" }),
      at(far, { kind: "roadwork", id: "roadwork:major", major: true }),
    ],
    sydney
  );
  assert.equal(near.map((i) => i.id).join(","), "roadwork:major,roadwork:near");
});
check("major first, then incidents, then roadworks -- so a cap drops the least important", () => {
  const list = [
    at(100, { kind: "roadwork", id: "roadwork:a" }),
    at(9_000, { id: "incident:far" }),
    at(20_000, { id: "incident:major", major: true }),
  ];
  assert.equal(incidentsNear(list, sydney).map((i) => i.id).join(","), "incident:major,incident:far,roadwork:a");
  assert.equal(incidentsNear(list, sydney, 2).map((i) => i.id).join(","), "incident:major,incident:far");
});
check("each carries its distance", () => {
  const [only] = incidentsNear([at(1_000)], sydney);
  assert.ok(Math.abs(only.distanceMeters - 1_000) < 5);
});

console.log("how they look");
check("fire, flood, roadwork and major event are styled by kind", () => {
  assert.equal(incidentStyle({ kind: "fire", category: "Bush Fire" }).icon, "flame");
  assert.equal(incidentStyle({ kind: "flood", category: "Flooding" }).icon, "water");
  assert.equal(incidentStyle({ kind: "roadwork", category: "Scheduled Roadwork" }).icon, "construct");
  assert.equal(incidentStyle({ kind: "majorevent", category: "Special Event" }).icon, "flag");
});
check("an incident is styled by its category: crash, heavy traffic, or a general hazard", () => {
  assert.equal(incidentStyle({ kind: "incident", category: "Crash" }).label, "Crash");
  assert.equal(incidentStyle({ kind: "incident", category: "Heavy Traffic" }).label, "Heavy traffic");
  const other = incidentStyle({ kind: "incident", category: "Breakdown" });
  assert.equal(other.icon, "warning");
  assert.equal(other.label, "Breakdown");
});

console.log("freshness");
check("age reads naturally, and is blank when the feed gave no time", () => {
  const now = 10_000_000;
  assert.equal(formatIncidentAge(null, now), "");
  assert.equal(formatIncidentAge(now - 20_000, now), "just now");
  assert.equal(formatIncidentAge(now - 7 * 60_000, now), "7 min ago");
  assert.equal(formatIncidentAge(now - 3 * 3_600_000, now), "3 hr ago");
  assert.equal(formatIncidentAge(now + 60_000, now), "just now"); // clock skew never reads as negative
});
check("a snapshot much older than the refresh interval is flagged stale; a fresh one isn't", () => {
  const now = 100_000_000;
  const fresh = { ...EMPTY_TRAFFIC_SNAPSHOT, configured: true, updatedAt: now - 6 * 60_000 };
  const old = { ...EMPTY_TRAFFIC_SNAPSHOT, configured: true, updatedAt: now - TRAFFIC_STALE_AFTER_MS - 1 };
  assert.equal(isTrafficStale(fresh, now), false);
  assert.equal(isTrafficStale(old, now), true);
  assert.equal(isTrafficStale({ ...EMPTY_TRAFFIC_SNAPSHOT, configured: true }, now), true);
});
check("'not configured' is never called stale -- it's a different message", () => {
  assert.equal(isTrafficStale(EMPTY_TRAFFIC_SNAPSHOT, 100_000_000), false);
});

console.log(`\n${passed} checks passed`);
