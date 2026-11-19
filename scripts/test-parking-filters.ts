// Real unit checks for src/services/parkingFilters.ts -- run with:
//   npx tsx scripts/test-parking-filters.ts
import {
  NO_PARKING_FILTERS,
  applyParkingFilters,
  isOpenAt,
  parkingAttributes,
  type ParkingAttributes,
} from "../src/services/parkingFilters";

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

// 2026-11-11 is a Wednesday.
const wed = (h: number, m = 0) => new Date(2026, 10, 11, h, m);
const sat = (h: number, m = 0) => new Date(2026, 10, 14, h, m);
const sun = (h: number, m = 0) => new Date(2026, 10, 15, h, m);

console.log("opening hours");
check("24/7 is always open", () => {
  assert.equal(isOpenAt("24/7", wed(3)), true);
});
check("nothing tagged -> unknown, not 'closed'", () => {
  assert.equal(isOpenAt(undefined, wed(12)), null);
  assert.equal(isOpenAt("", wed(12)), null);
});
check("weekday range: open inside, closed outside, closed at the weekend", () => {
  assert.equal(isOpenAt("Mo-Fr 07:00-19:00", wed(12)), true);
  assert.equal(isOpenAt("Mo-Fr 07:00-19:00", wed(6, 59)), false);
  assert.equal(isOpenAt("Mo-Fr 07:00-19:00", wed(19)), false);
  assert.equal(isOpenAt("Mo-Fr 07:00-19:00", sat(12)), false);
});
check("several rules: the one for today decides", () => {
  const hours = "Mo-Fr 07:00-19:00; Sa,Su 09:00-17:00";
  assert.equal(isOpenAt(hours, sat(8)), false);
  assert.equal(isOpenAt(hours, sat(10)), true);
  assert.equal(isOpenAt(hours, wed(8)), true);
});
check("times with no days apply every day", () => {
  assert.equal(isOpenAt("06:00-22:00", sun(21)), true);
  assert.equal(isOpenAt("06:00-22:00", sun(23)), false);
});
check("hours running past midnight count for the small hours of the next day", () => {
  assert.equal(isOpenAt("Fr,Sa 18:00-02:00", sat(23)), true);
  assert.equal(isOpenAt("Fr,Sa 18:00-02:00", sun(1)), true); // still Saturday night's session
  assert.equal(isOpenAt("Fr,Sa 18:00-02:00", sun(3)), false);
});
check("a day range that wraps the week (Fr-Mo) includes Sunday", () => {
  assert.equal(isOpenAt("Fr-Mo 08:00-20:00", sun(12)), true);
  assert.equal(isOpenAt("Fr-Mo 08:00-20:00", wed(12)), false);
});
check("'off' closes a day an earlier rule had open", () => {
  assert.equal(isOpenAt("Mo-Su 08:00-20:00; Su off", sun(12)), false);
  assert.equal(isOpenAt("Mo-Su 08:00-20:00; Su off", sat(12)), true);
});
check("anything outside the handled forms is 'unknown', never a guess", () => {
  assert.equal(isOpenAt("sunrise-sunset", wed(12)), null);
  assert.equal(isOpenAt("Mo-Fr 07:00-19:00; PH off", wed(12)), null);
  assert.equal(isOpenAt("Jan-Mar Mo-Fr 07:00-19:00", wed(12)), null);
});

console.log("reading a car park's tags");
check("no tags at all -> every attribute unknown", () => {
  const a = parkingAttributes(undefined, wed(12));
  assert.equal(a.free, null);
  assert.equal(a.openNow, null);
  assert.equal(a.covered, null);
  assert.equal(a.wheelchairAccessible, null);
  assert.equal(a.disabledBays, null);
  assert.equal(a.evCharging, null);
  assert.equal(a.capacity, null);
  assert.equal(a.restricted, false);
});
check("fee=no is free, fee=yes is paid, a conditional fee is neither", () => {
  assert.equal(parkingAttributes({ fee: "no" }, wed(12)).free, true);
  assert.equal(parkingAttributes({ fee: "yes" }, wed(12)).free, false);
  assert.equal(parkingAttributes({ fee: "Mo-Fr 08:00-18:00" }, wed(12)).free, null);
});
check("multi-storey and underground count as covered; surface doesn't", () => {
  assert.equal(parkingAttributes({ parking: "multi-storey" }, wed(12)).covered, true);
  assert.equal(parkingAttributes({ parking: "underground" }, wed(12)).covered, true);
  assert.equal(parkingAttributes({ parking: "surface" }, wed(12)).covered, false);
  assert.equal(parkingAttributes({ parking: "surface", covered: "yes" }, wed(12)).covered, true);
});
check("'limited' wheelchair access is not a yes", () => {
  assert.equal(parkingAttributes({ wheelchair: "yes" }, wed(12)).wheelchairAccessible, true);
  assert.equal(parkingAttributes({ wheelchair: "limited" }, wed(12)).wheelchairAccessible, false);
});
check("disabled bays and EV charging read from a count or a yes/no", () => {
  assert.equal(parkingAttributes({ "capacity:disabled": "4" }, wed(12)).disabledBays, true);
  assert.equal(parkingAttributes({ "capacity:disabled": "0" }, wed(12)).disabledBays, false);
  assert.equal(parkingAttributes({ "capacity:disabled": "yes" }, wed(12)).disabledBays, true);
  assert.equal(parkingAttributes({ "capacity:charging": "2" }, wed(12)).evCharging, true);
  assert.equal(parkingAttributes({ "capacity:charging": "no" }, wed(12)).evCharging, false);
});
check("private / permit / customers-only is flagged as restricted", () => {
  assert.equal(parkingAttributes({ access: "private" }, wed(12)).restricted, true);
  assert.equal(parkingAttributes({ access: "customers" }, wed(12)).restricted, true);
  assert.equal(parkingAttributes({ access: "yes" }, wed(12)).restricted, false);
});

console.log("filtering and sorting");
const unknown: ParkingAttributes = {
  free: null, openNow: null, covered: null, wheelchairAccessible: null,
  disabledBays: null, evCharging: null, capacity: null, restricted: false,
};
const lot = (id: string, distanceMeters: number, attributes: Partial<ParkingAttributes>) => ({
  id, distanceMeters, attributes: { ...unknown, ...attributes },
});
const lots = [
  lot("paid-near", 100, { free: false, capacity: 50 }),
  lot("free-far", 900, { free: true, capacity: 400 }),
  lot("unknown-mid", 400, {}),
  lot("free-mid", 500, { free: true, openNow: true }),
];
check("no filters: everything, nearest first", () => {
  const r = applyParkingFilters(lots, NO_PARKING_FILTERS, "nearest");
  assert.equal(r.kept.map((l) => l.id).join(","), "paid-near,unknown-mid,free-mid,free-far");
  assert.equal(r.excludedNo + r.excludedUnknown, 0);
});
check("a filter keeps only definite matches, and counts 'no' and 'doesn't say' separately", () => {
  const r = applyParkingFilters(lots, { ...NO_PARKING_FILTERS, free: true }, "nearest");
  assert.equal(r.kept.map((l) => l.id).join(","), "free-mid,free-far");
  assert.equal(r.excludedNo, 1);
  assert.equal(r.excludedUnknown, 1);
});
check("two filters must both be a definite yes", () => {
  const r = applyParkingFilters(lots, { ...NO_PARKING_FILTERS, free: true, openNow: true }, "nearest");
  assert.equal(r.kept.map((l) => l.id).join(","), "free-mid");
});
check("'Free first' orders free, then unstated, then paid -- nearest within each", () => {
  const r = applyParkingFilters(lots, NO_PARKING_FILTERS, "freeFirst");
  assert.equal(r.kept.map((l) => l.id).join(","), "free-mid,free-far,unknown-mid,paid-near");
});
check("'Most spaces' puts car parks with no stated size last", () => {
  const r = applyParkingFilters(lots, NO_PARKING_FILTERS, "largest");
  assert.equal(r.kept.map((l) => l.id).join(","), "free-far,paid-near,unknown-mid,free-mid");
});

console.log(`\n${passed} checks passed`);
