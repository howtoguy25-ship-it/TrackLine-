// Travel modes step 1: the six modes, remembering the last one, and ferry detection on REAL
// routes (OSRM / OpenStreetMap, recorded by scripts/record-ferry-routes.mjs): Putney -> Mortlake
// crosses the Parramatta River on the Mortlake vehicle ferry; Bankstown -> Parramatta doesn't.
import { describe, expect, it } from "@jest/globals";
import ferryDrive from "../fixtures/travel/putney-mortlake-ferry.json";
import plainDrive from "../fixtures/travel/bankstown-parramatta.json";
import { parseMapboxResponse, excludeParam } from "@/services/mapboxDirections";
import { MODE_ORDER, asModeId, ferryBadge, ferryLegs, ferryModeAvailable, ferryOptions, routeHasFerry } from "@/travel/modes";

const withFerry = parseMapboxResponse(ferryDrive)[0];
const without = parseMapboxResponse(plainDrive)[0];

describe("the modes", () => {
  it("six, in order; the last one used is remembered, Drive by default", () => {
    expect(MODE_ORDER).toEqual(["drive", "motorbike", "bike", "walk", "transit", "ferry"]);
    expect(asModeId("bike")).toBe("bike");
    expect(asModeId(undefined)).toBe("drive");
    expect(asModeId("hovercraft")).toBe("drive");
  });
});

describe("ferry detection on real drives", () => {
  it("Putney -> Mortlake: the drive includes the Mortlake Ferry, cars allowed", () => {
    expect(routeHasFerry(withFerry)).toBe(true);
    const [leg] = ferryLegs(withFerry);
    expect(leg.name).toBe("Mortlake Ferry");
    expect(leg.carsAllowed).toBe(true);
    expect(leg.distanceMeters).toBeGreaterThan(200);
    expect(leg.distanceMeters).toBeLessThan(500); // the river is ~330 m wide there
    expect(ferryBadge(withFerry)).toBe("Includes ferry (Mortlake Ferry)");
  });
  it("Bankstown -> Parramatta: no water crossing, so no Ferry mode", () => {
    expect(routeHasFerry(without)).toBe(false);
    expect(ferryBadge(without)).toBeNull();
    expect(ferryModeAvailable({ drive: [without], walk: [], transit: null })).toBe(false);
  });
  it("Ferry shows only when a real option has a ferry leg, and lists those options", () => {
    expect(ferryModeAvailable({ drive: [without, withFerry] })).toBe(true);
    expect(ferryOptions({ drive: [without, withFerry] }).map((o) => o.mode)).toEqual(["drive"]);
  });
  it("Avoid > Ferries asks the router to leave them out", () => {
    expect(excludeParam({ ferries: true })).toBe("ferry");
  });
});
