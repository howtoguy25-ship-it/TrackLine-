// Sydney Harbour: Circular Quay -> Manly must offer Ferry (the Manly ferry); Bankstown ->
// Parramatta must not. REAL Google transit responses, recorded by
// scripts/record-transit-ferry.mjs -- which needs a Google key, not available where these tests
// were written. Until the recordings exist this suite is SKIPPED (shown as skipped, not passed).
// The Putney -> Mortlake car-ferry test (modes.test.ts) runs on real OSRM data already.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "@jest/globals";
import { parseRoute } from "@/services/directions";
import { ferryLegs, ferryModeAvailable } from "@/travel/modes";

const dir = path.join(__dirname, "../fixtures/travel");
const manlyFile = path.join(dir, "circular-quay-manly-transit.json");
const controlFile = path.join(dir, "bankstown-parramatta-transit.json");
const recorded = fs.existsSync(manlyFile) && fs.existsSync(controlFile);
const load = (f: string) => (JSON.parse(fs.readFileSync(f, "utf8")).routes as unknown[]).map(parseRoute);

(recorded ? describe : describe.skip)("Sydney ferries on real Google transit data", () => {
  it("Circular Quay -> Manly: Ferry is offered, with the Manly wharf", () => {
    const routes = load(manlyFile);
    expect(ferryModeAvailable({ transit: routes })).toBe(true);
    const legs = routes.flatMap(ferryLegs);
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.some((l) => /Manly/i.test(l.arrivalStop ?? ""))).toBe(true);
    expect(legs.every((l) => l.carsAllowed === false)).toBe(true);
  });
  it("Bankstown -> Parramatta: no Ferry", () => {
    expect(ferryModeAvailable({ transit: load(controlFile) })).toBe(false);
  });
});
