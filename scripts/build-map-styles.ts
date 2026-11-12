// Writes the shipped Mapbox style files from src/map-v2/styles/buildStyle.ts:
//   npx tsx scripts/build-map-styles.ts
// __tests__/mapV2.test.ts fails if a file is out of date with the rules.
import fs from "fs";
import path from "path";
import { DARK_PALETTE, LIGHT_PALETTE, SATELLITE_LABEL_PALETTE, buildStyle } from "../src/map-v2/styles/buildStyle";

const dir = path.join(__dirname, "../src/map-v2/styles");
const files: [string, object][] = [
  ["trackline-light.json", buildStyle(LIGHT_PALETTE)],
  ["trackline-dark.json", buildStyle(DARK_PALETTE)],
  ["trackline-satellite-streets.json", buildStyle(SATELLITE_LABEL_PALETTE, { satellite: true })],
];
for (const [name, style] of files) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(style, null, 2) + "\n");
  console.log("wrote", name);
}
