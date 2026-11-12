// Records real test routes for the manoeuvre tests (__tests__/nav/allManoeuvres.test.ts).
//
//   node scripts/record-osrm-test-routes.mjs
//
// For each route below it asks the public OSRM server (OpenStreetMap data, the same response
// format as Mapbox Directions) for the route itself, then, for every turn and exit on it, for the
// REAL road a driver would follow by carrying straight on instead of making the manoeuvre: a
// route from ~250 m before the manoeuvre, starting in the direction of travel, to a point 700 m
// straight ahead past it. Nothing is drawn by hand; every line is a road OSRM routed along.
// Output: __tests__/fixtures/manoeuvres/<name>.json

import fs from "node:fs";
import path from "node:path";

const OSRM = "https://router.project-osrm.org/route/v1/driving";
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "__tests__", "fixtures", "manoeuvres");

// Real places around Sydney, chosen for a mix of motorway exits/merges, city-grid turns and
// suburban roundabouts.
const ROUTES = [
  { name: "m4-silverwater", from: [151.0035, -33.8226], to: [151.04, -33.834] },
  { name: "m5-marsh-st", from: [151.079, -33.9455], to: [151.172, -33.933] },
  { name: "cbd-central-to-quay", from: [151.2065, -33.884], to: [151.211, -33.861] },
  { name: "parramatta-local", from: [151.0035, -33.8150], to: [151.0300, -33.8060] },
  { name: "castle-hill-roundabouts", from: [151.004, -33.731], to: [151.025, -33.72] },
];

const TRACK = new Set(["turn", "off ramp", "on ramp", "fork", "merge", "roundabout", "rotary", "end of road", "exit roundabout"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    // 4xx with a body is an answer ("NoRoute", "NoSegment": nothing straight ahead) -- not a retry.
    if (res.ok || (res.status >= 400 && res.status < 429)) return res.json();
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`OSRM failed: ${url}`);
}

function decode(str, precision = 6) {
  const factor = Math.pow(10, precision);
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const x = rad(b[0] - a[0]) * Math.cos(rad((a[1] + b[1]) / 2));
  const y = rad(b[1] - a[1]);
  return Math.hypot(x, y) * R;
}
function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function offset(p, brg, meters) {
  const dLat = (meters * Math.cos(rad(brg))) / 111320;
  const dLng = (meters * Math.sin(rad(brg))) / (111320 * Math.cos(rad(p[1])));
  return [p[0] + dLng, p[1] + dLat];
}

/** The point `meters` back along a line from its end, and the direction of travel there. */
function backAlong(line, meters) {
  let acc = 0;
  for (let i = line.length - 1; i > 0; i--) {
    const seg = dist(line[i - 1], line[i]);
    if (acc + seg >= meters) return { point: line[i - 1], brg: bearing(line[i - 1], line[i]) };
    acc += seg;
  }
  return { point: line[0], brg: bearing(line[0], line[Math.min(1, line.length - 1)]) };
}

const trimStep = (s) => ({
  distance: s.distance, duration: s.duration, geometry: s.geometry, name: s.name, ref: s.ref, exits: s.exits,
  destinations: s.destinations, driving_side: s.driving_side,
  maneuver: { type: s.maneuver.type, modifier: s.maneuver.modifier, location: s.maneuver.location, exit: s.maneuver.exit },
  intersections: s.intersections.slice(0, 1).map((i) => ({ location: i.location, bearings: i.bearings, entry: i.entry, lanes: i.lanes })),
});

fs.mkdirSync(OUT, { recursive: true });
for (const r of ROUTES) {
  const json = await get(`${OSRM}/${r.from.join(",")};${r.to.join(",")}?steps=true&overview=full&geometries=polyline6&alternatives=false`);
  const route = json.routes[0];
  const steps = route.legs[0].steps;
  const missed = [];
  for (let k = 1; k < steps.length; k++) {
    const m = steps[k].maneuver;
    if (!TRACK.has(m.type) || !m.modifier || m.modifier === "straight") continue;
    // The road up to this manoeuvre (end of the previous step).
    const before = decode(steps[k - 1].geometry);
    if (before.length < 2) continue;
    const split = m.location;
    const { point: start, brg } = backAlong(before, 250);
    const approachBrg = bearing(before[Math.max(0, before.length - 2)], before[before.length - 1]);
    const ahead = offset(split, approachBrg, 700);
    await sleep(1100);
    const alt = await get(
      `${OSRM}/${start.join(",")};${ahead.join(",")}?overview=full&geometries=polyline6&continue_straight=true&bearings=${Math.round(brg)},30;&radiuses=30;200`
    );
    if (alt.code !== "Ok" || !alt.routes?.[0]) continue;
    missed.push({ step: k, type: m.type, modifier: m.modifier, name: steps[k].name, geometry: alt.routes[0].geometry });
  }
  const out = {
    source: "OSRM demo server (router.project-osrm.org), OpenStreetMap data. Route + a real carry-straight-on path at each turn/exit.",
    recordedAt: new Date().toISOString().slice(0, 10),
    code: json.code,
    routes: [{ distance: route.distance, duration: route.duration, geometry: route.geometry, legs: [{ summary: route.legs[0].summary, steps: steps.map(trimStep) }] }],
    missed,
  };
  fs.writeFileSync(path.join(OUT, `${r.name}.json`), JSON.stringify(out));
  console.log(r.name, Math.round(route.distance), "m,", steps.length, "steps,", missed.length, "missed paths");
  await sleep(1100);
}
