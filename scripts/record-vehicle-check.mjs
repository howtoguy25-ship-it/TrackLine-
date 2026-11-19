// Re-records the CarJam AU fixtures from CarJam's TEST service once a development key exists:
//   CARJAM_TEST_KEY=... node scripts/record-vehicle-check.mjs
// Writes firebase/tests/fixtures/vehicleCheck/carjam_<plate>_<query>.recorded.xml for the
// documented test vehicles. The key is read from the environment only and never printed.
import fs from "fs";
import path from "path";

const key = process.env.CARJAM_TEST_KEY;
if (!key) {
  console.error("Set CARJAM_TEST_KEY (a CarJam development key).");
  process.exit(1);
}
const out = path.join(path.dirname(new URL(import.meta.url).pathname), "../firebase/tests/fixtures/vehicleCheck");
const vehicles = [
  { plate: "TEST00", state: "VIC" },
  { plate: "TEST80", state: "VIC" },
];
for (const v of vehicles) {
  for (const queryType of ["VDRSBC", "SC", "WO"]) {
    const params = new URLSearchParams({ key, query_type: queryType, plate: v.plate, state: v.state });
    const resp = await fetch(`https://test.carjam.co.nz/api/car-au/?${params}`);
    const body = await resp.text();
    const file = path.join(out, `carjam_${v.plate}_${queryType}.recorded.xml`);
    fs.writeFileSync(file, body);
    console.log(`${v.plate} ${queryType}: HTTP ${resp.status} -> ${path.basename(file)}`);
  }
}
