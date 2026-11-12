// Records a REAL road route through a real school zone (for the school-zone drive test):
// the zone's band (official TfNSW polygon, from the converted fixture tile) is extended 250 m
// past each end along its long axis, and OSRM (OpenStreetMap) routes between the two points.
//
//   node scripts/record-school-zone-drive.mjs TfNSW-449560   (Tempe High School, Unwins Bridge Road)
import fs from "node:fs";
import path from "node:path";

const id = process.argv[2] ?? "TfNSW-449560";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const tile = JSON.parse(fs.readFileSync(path.join(ROOT, "__tests__/fixtures/schoolZones/nsw-tile-newtown.json"), "utf8"));
const zone = tile.zones.find((z) => z.id === id);
if (!zone) throw new Error(`no ${id} in the fixture tile`);

function decode(str) {
  let i = 0, lat = 0, lng = 0;
  const out = [];
  while (i < str.length) {
    for (const which of [0, 1]) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push([lng / 1e6, lat / 1e6]);
  }
  return out;
}
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => Math.hypot(rad(b[0] - a[0]) * Math.cos(rad(a[1])), rad(b[1] - a[1])) * 6371000;
const ring = decode(zone.polygons[0]);
let best = [ring[0], ring[1]], max = 0;
for (const a of ring) for (const b of ring) { const d = dist(a, b); if (d > max) { max = d; best = [a, b]; } }
const [a, b] = best;
// Bands can wrap a corner (Newtown: Whitehorse St -> Gibbes St -> Angel St), so the route goes
// THROUGH both ends of the band, starting and finishing ~120 m outside it.
let cx = 0, cy = 0;
for (const p of ring) { cx += p[0]; cy += p[1]; }
const centre = [cx / ring.length, cy / ring.length];
const away = (q, m) => { const d = dist(centre, q); return [q[0] + ((q[0] - centre[0]) * m) / d, q[1] + ((q[1] - centre[1]) * m) / d]; };
const pts = [away(a, 200), a, b, away(b, 200)];
const url = `https://router.project-osrm.org/route/v1/driving/${pts.map((p) => p.join(",")).join(";")}?steps=true&overview=full&geometries=polyline6&continue_straight=true`;
const json = await (await fetch(url)).json();
if (json.code !== "Ok") throw new Error(`OSRM: ${json.code}`);
const r = json.routes[0];
// Several legs (one per waypoint pair): join their steps into one leg, dropping the in-between
// "arrive"/"depart" pairs.
const steps = r.legs.flatMap((leg, li) => leg.steps.filter((st, si) => !((li < r.legs.length - 1 && st.maneuver.type === "arrive") || (li > 0 && si === 0 && st.maneuver.type === "depart"))));
const out = {
  source: "OSRM demo server (OpenStreetMap) route through a real TfNSW school zone; zone from __tests__/fixtures/schoolZones/nsw-tile-newtown.json",
  recordedAt: new Date().toISOString().slice(0, 10),
  zoneId: id,
  code: json.code,
  routes: [{ distance: r.distance, duration: r.duration, geometry: r.geometry, legs: [{ summary: r.legs.map((l) => l.summary).join(", "), steps: steps.map((s) => ({ distance: s.distance, duration: s.duration, geometry: s.geometry, name: s.name, driving_side: s.driving_side, maneuver: { type: s.maneuver.type, modifier: s.maneuver.modifier, location: s.maneuver.location }, intersections: s.intersections.slice(0, 1).map((i) => ({ location: i.location, bearings: i.bearings, entry: i.entry })) })) }] }],
};
fs.writeFileSync(path.join(ROOT, "__tests__/fixtures/schoolZones/drive-through-zone.json"), JSON.stringify(out));
console.log(id, zone.name, "band", Math.round(max), "m; route", Math.round(r.distance), "m via", r.legs.map((l) => l.summary).join(", "));
