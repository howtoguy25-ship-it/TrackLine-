// Records REAL driving routes from OSRM (OpenStreetMap data) for the travel-mode ferry tests:
//   - Putney -> Mortlake (Sydney): crosses the Parramatta River on the Mortlake vehicle ferry
//   - Bankstown -> Parramatta: an ordinary drive, no water crossing
//   node scripts/record-ferry-routes.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "__tests__/fixtures/travel");
const routes = {
  "putney-mortlake-ferry": [[151.1075, -33.827], [151.104, -33.842]],
  "bankstown-parramatta": [[151.0346, -33.9177], [151.0036, -33.8150]],
};
for (const [name, [a, b]] of Object.entries(routes)) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.join(",")};${b.join(",")}?steps=true&overview=full&geometries=polyline6`;
  const json = await (await fetch(url)).json();
  if (json.code !== "Ok") throw new Error(`${name}: ${json.code}`);
  json._source = `OSRM demo server (OpenStreetMap data, ODbL), recorded ${new Date().toISOString().slice(0, 10)}: ${url}`;
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(json));
  const modes = json.routes[0].legs.flatMap((l) => l.steps.map((s) => s.mode));
  console.log(name, Math.round(json.routes[0].distance), "m", [...new Set(modes)].join(","));
}
