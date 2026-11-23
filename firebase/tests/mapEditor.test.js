// Gap item 16 (server): the web map editor's view box and pin moves are checked before anything
// is written (moderation.js mapArea / moveReport, both staff-only and audited).
const { parseBox, inBox, checkMove, MAX_MOVE_KM } = require("../functions/admin/moderation");

test("the view box must be a real area, at most ~50 km", () => {
  expect(parseBox({ south: -33.95, west: 151.0, north: -33.85, east: 151.1 })).toEqual({ south: -33.95, west: 151.0, north: -33.85, east: 151.1 });
  expect(() => parseBox({ south: -33.85, west: 151, north: -33.95, east: 151.1 })).toThrow(/area/);
  expect(() => parseBox({ south: -35, west: 150, north: -33, east: 152 })).toThrow(/Zoom in/);
  expect(() => parseBox(null)).toThrow();
});

test("in the box", () => {
  const box = { south: -33.95, west: 151.0, north: -33.85, east: 151.1 };
  expect(inBox(box, { lat: -33.9, lng: 151.05 })).toBe(true);
  expect(inBox(box, { lat: -33.8, lng: 151.05 })).toBe(false);
  expect(inBox(box, { lat: "x", lng: 151.05 })).toBe(false);
});

test("a pin moves at most 2 km per edit and must land on the map", () => {
  const from = { lat: -33.9, lng: 151.0 };
  expect(checkMove(from, { lat: -33.9005, lng: 151.0005 })).toEqual({ lat: -33.9005, lng: 151.0005 });
  expect(MAX_MOVE_KM).toBe(2);
  expect(() => checkMove(from, { lat: -33.95, lng: 151.0 })).toThrow(/2 km/);
  expect(() => checkMove(from, { lat: 200, lng: 0 })).toThrow(/place on the map/);
});
