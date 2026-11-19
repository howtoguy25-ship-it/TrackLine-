// The speed-limit sign must change when the car moves onto a different road close by -- a side
// street beside the main road, a slip lane, a service road, the cross street at a junction -- not
// keep the first road's limit. Root causes (fixed): the lookup kept returning the last matched road
// while within 40 m of it, and the road tracker copied its answer into new 25 m squares.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: async () => null, setItem: async () => {} }));
import { fetchSpeedLimitNear, pickRoadInScene, resetRoadScene, sceneCovers, type SceneWay } from "@/services/osmTrafficData";
import { RoadLookupTracker, STREET_LOOKUP_MIN_MOVE_M } from "@/map/homeMapLogic";

// A main road running east (80 km/h) and a service road 18 m north of it (50 km/h), plus a side
// street running north from the main road (40 km/h). All within one 120 m Overpass answer.
const LAT = -33.92;
const M_LAT = 1 / 111_320;
const main: SceneWay = { id: 1, tags: { highway: "primary", maxspeed: "80", name: "Hume Highway" }, geometry: [{ lat: LAT, lon: 151.0 }, { lat: LAT, lon: 151.004 }] };
const service: SceneWay = { id: 2, tags: { highway: "service", maxspeed: "50", name: "Service Road" }, geometry: [{ lat: LAT + 18 * M_LAT, lon: 151.0 }, { lat: LAT + 18 * M_LAT, lon: 151.004 }] };
const side: SceneWay = { id: 3, tags: { highway: "residential", maxspeed: "40", name: "Smith Street" }, geometry: [{ lat: LAT, lon: 151.002 }, { lat: LAT + 300 * M_LAT, lon: 151.002 }] };
const scene = [main, service, side];

describe("picking the road from the roads around the driver", () => {
  it("on the main road heading east: 80", () => {
    expect(pickRoadInScene(scene, LAT + 2 * M_LAT, 151.001, 90)?.kmh).toBe(80);
  });
  it("moves onto the service road 18 m away, same direction: 50 (it used to stay 80)", () => {
    expect(pickRoadInScene(scene, LAT + 17 * M_LAT, 151.001, 90, 1)?.kmh).toBe(50);
  });
  it("turns into the side street at the junction: 40", () => {
    expect(pickRoadInScene(scene, LAT + 15 * M_LAT, 151.002, 0, 1)?.kmh).toBe(40);
  });
  it("doesn't flicker between two roads that fit about the same", () => {
    // Right between the main road and the service road: the current road keeps it.
    const mid = LAT + 9 * M_LAT;
    expect(pickRoadInScene(scene, mid, 151.001, 90, 1)?.wayId).toBe(1);
    expect(pickRoadInScene(scene, mid, 151.001, 90, 2)?.wayId).toBe(2);
  });
  it("nothing within 40 m: no sign (never a guess)", () => {
    expect(pickRoadInScene(scene, LAT + 200 * M_LAT, 151.0, 90)).toBeNull();
  });
  it("the scene is re-used within 70 m of where it was fetched", () => {
    expect(sceneCovers({ lat: LAT, lng: 151.001 }, LAT + 60 * M_LAT, 151.001)).toBe(true);
    expect(sceneCovers({ lat: LAT, lng: 151.001 }, LAT + 90 * M_LAT, 151.001)).toBe(false);
  });
});

describe("fetchSpeedLimitNear: one request per area, a new answer per road", () => {
  beforeEach(() => resetRoadScene());
  it("swaps 80 -> 50 -> 40 across three roads with ONE Overpass request", async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ elements: scene.map((w) => ({ type: "way", ...w })) }) }));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    const a = await fetchSpeedLimitNear(LAT + 2 * M_LAT, 151.001, 90);
    const b = await fetchSpeedLimitNear(LAT + 17 * M_LAT, 151.0012, 90);
    const c = await fetchSpeedLimitNear(LAT + 25 * M_LAT, 151.002, 0);
    expect([a?.kmh, b?.kmh, c?.kmh]).toEqual([80, 50, 40]);
    expect([a?.roadName, b?.roadName, c?.roadName]).toEqual(["Hume Highway", "Service Road", "Smith Street"]);
    // Overpass is asked from several mirrors at once for the first lookup only.
    const firstBatch = fetchMock.mock.calls.length;
    expect(firstBatch).toBeGreaterThan(0);
    await fetchSpeedLimitNear(LAT + 3 * M_LAT, 151.0015, 90);
    expect(fetchMock.mock.calls.length).toBe(firstBatch);
  });
});

describe("road tracker", () => {
  it("looks again after a few metres (not 25 m), and never re-uses an answer for another spot", () => {
    expect(STREET_LOOKUP_MIN_MOVE_M).toBeLessThanOrEqual(10);
    const t = new RoadLookupTracker<number>();
    const at = (m: number, heading = 90) => ({ latitude: LAT + m * M_LAT, longitude: 151.001, heading });
    expect(t.update(at(0))).toBe(true);
    t.resolve(at(0), 80);
    expect(t.update(at(4))).toBe(false);
    expect(t.update(at(12))).toBe(true); // 12 m: looked up again, not answered from memory
    t.resolve(at(12), 50);
    expect(t.value).toBe(50);
    // Coming back to the first spot is a real lookup again too.
    expect(t.update(at(0))).toBe(true);
  });
});
