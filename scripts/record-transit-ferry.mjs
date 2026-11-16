// Records REAL Google Directions transit responses for the travel-mode ferry tests:
//   - Circular Quay -> Manly: the Manly ferry (F1) is a real option
//   - Bankstown -> Parramatta: no water crossing (control)
// Needs a Google key with the Directions API (the app's GOOGLE_DIRECTIONS_API_KEY):
//   GOOGLE_DIRECTIONS_API_KEY=... node scripts/record-transit-ferry.mjs
// The key is never written to the fixture (it's stripped from the recorded URL).
import fs from "node:fs";
import path from "node:path";

const key = process.env.GOOGLE_DIRECTIONS_API_KEY;
if (!key) {
  console.error("No GOOGLE_DIRECTIONS_API_KEY -- nothing recorded.");
  process.exit(2);
}
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "__tests__/fixtures/travel");
// Next weekday at 10:00 Sydney time, so the timetable is an ordinary one.
const d = new Date();
do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()));
const departure = Math.floor(Date.parse(`${d.toISOString().slice(0, 10)}T10:00:00+11:00`) / 1000);

const trips = {
  "circular-quay-manly-transit": ["-33.8610,151.2108", "-33.8001,151.2843"],
  "bankstown-parramatta-transit": ["-33.9177,151.0346", "-33.8150,151.0036"],
};
for (const [name, [o, dst]] of Object.entries(trips)) {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${o}&destination=${dst}&mode=transit&alternatives=true&departure_time=${departure}&key=${key}`;
  const json = await (await fetch(url)).json();
  if (json.status !== "OK") throw new Error(`${name}: ${json.status} ${json.error_message ?? ""}`);
  json._source = `Google Directions API (transit), recorded ${new Date().toISOString().slice(0, 10)}: ${url.replace(/&key=[^&]+/, "")}`;
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(json));
  const types = json.routes.map((r) => r.legs[0].steps.filter((s) => s.travel_mode === "TRANSIT").map((s) => s.transit_details.line.vehicle.type).join("+"));
  console.log(name, json.routes.length, "routes:", types.join(" | "));
}
