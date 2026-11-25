// Builds assets/map/user-arrow.png + @2x + @3x (44 pt: 44 / 88 / 132 px) from the same art as NavArrow3D
// (components/LocationMarkers.tsx): our teal arrow, lighter left face, darker bevel, white outline,
// soft shadow; nose up. Bundled as a native image so Mapbox has it the moment the style loads
// (no async snapshot, so never a moment where Mapbox draws its own default dot).
// The app requires "user-arrow.png"; Metro picks the @2x / @3x file for the screen. (Requiring the
// @3x name directly fails to bundle: Metro resolves scaled assets only through the base name.)
// Run: npx tsx scripts/build-user-arrow.ts
import { writeFileSync } from "fs";
import { shadeColor } from "../src/utils/color";

const TEAL = "#14B8A6";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="132" height="132" viewBox="0 0 44 44">
<ellipse cx="22" cy="36" rx="14" ry="4.5" fill="rgba(0,0,0,0.22)"/>
<path d="M22 3 L22 30 L6 38 Z" fill="${shadeColor(TEAL, 0.18)}"/>
<path d="M22 3 L38 38 L22 30 Z" fill="${shadeColor(TEAL, -0.28)}"/>
<path d="M22 3 L38 38 L22 30 L6 38 Z" fill="none" stroke="#FFFFFF" stroke-width="1.75" stroke-linejoin="round"/>
</svg>`;

(async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require("playwright");
  const b = await chromium.launch();
  for (const scale of [1, 2, 3]) {
    const p = await b.newPage({ viewport: { width: 44, height: 44 }, deviceScaleFactor: scale });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="132" height="132"', 'width="44" height="44"')}</body></html>`);
    const png = await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 44, height: 44 } });
    const name = `assets/map/user-arrow${scale === 1 ? "" : `@${scale}x`}.png`;
    writeFileSync(name, png);
    console.log("wrote", name);
    await p.close();
  }
  writeFileSync("assets/map/user-arrow.svg", svg);
  await b.close();
})();
