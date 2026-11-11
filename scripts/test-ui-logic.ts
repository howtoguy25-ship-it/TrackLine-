// Real unit checks for the small pure rules behind the Waze-style UI pass 2 -- run with:
//   npx tsx scripts/test-ui-logic.ts
// Each section of the pass adds its own block here. Nothing in this file renders a screen:
// how things LOOK and FEEL on a phone is in TEST_ON_PHONE.md, marked "NEEDS DEVICE TEST".
import { RUBIK, rubikFamilyForWeight } from "../src/theme/typography";
import { scaleFor } from "../src/theme/scale";

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

console.log("§0 font");
check("each weight the spec uses maps to the Rubik file that IS that weight", () => {
  assert.equal(rubikFamilyForWeight("400"), RUBIK.regular);
  assert.equal(rubikFamilyForWeight("500"), RUBIK.medium);
  assert.equal(rubikFamilyForWeight("600"), RUBIK.semiBold);
  assert.equal(rubikFamilyForWeight("700"), RUBIK.bold);
});
check("no weight, 'normal' and 'bold' behave as React Native's own defaults do", () => {
  assert.equal(rubikFamilyForWeight(undefined), RUBIK.regular);
  assert.equal(rubikFamilyForWeight("normal"), RUBIK.regular);
  assert.equal(rubikFamilyForWeight("bold"), RUBIK.bold);
});
check("weights that aren't bundled use the nearest real face (800/900 -> Bold, 300 -> Regular)", () => {
  assert.equal(rubikFamilyForWeight("800"), RUBIK.bold);
  assert.equal(rubikFamilyForWeight(900), RUBIK.bold);
  assert.equal(rubikFamilyForWeight("300"), RUBIK.regular);
  assert.equal(rubikFamilyForWeight(100), RUBIK.regular);
});
check("a nonsense weight falls back to Regular instead of an unregistered family", () => {
  assert.equal(rubikFamilyForWeight("heavy"), RUBIK.regular);
});

console.log("§0 scaling from the 390pt design width");
check("a 390pt phone is 1:1", () => {
  assert.equal(scaleFor(390), 1);
});
check("smaller and larger phones scale in proportion", () => {
  assert.ok(Math.abs(scaleFor(375) - 375 / 390) < 1e-9);
  assert.ok(Math.abs(scaleFor(430) - 430 / 390) < 1e-9);
});
check("the scale is clamped, so a tiny phone isn't cramped and a tablet isn't oversized", () => {
  assert.equal(scaleFor(280), 0.85);
  assert.equal(scaleFor(1024), 1.25);
});
check("a missing or bad width never produces NaN sizes", () => {
  assert.equal(scaleFor(0), 1);
  assert.equal(scaleFor(NaN), 1);
});

console.log(`\n${passed} checks passed`);
