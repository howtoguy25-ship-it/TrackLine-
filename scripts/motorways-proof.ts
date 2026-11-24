// Proof renders for docs/motorways: the app's real bundled styles on real Mapbox tiles in headless
// Chromium, at real Sydney motorways (M4 / M7 at Eastern Creek, M5 at Bankstown), from the region
// view in to street level, light, dark and satellite. Motorways and their ramps are amber; the
// highways stay slate. No iOS simulator on Linux: these are map renders, not phone screenshots.
// Run: MAPBOX_TOKEN_FILE=<file with a pk. token> MAPBOX_GL_DIR=<dir with mapbox-gl> OUT_DIR=docs/motorways npx tsx scripts/motorways-proof.ts
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { mapboxZoomFromGoogle } from "../src/map-v2/geo";
import { SHIELD_IMAGE, SHIELD_PLATE_COLOURS } from "../src/map-v2/styles/buildStyle";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright");
declare const mapboxgl: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const W = 390;
const H = 700;
const OUT = process.env.OUT_DIR ?? "docs/motorways";
const token = readFileSync(process.env.MAPBOX_TOKEN_FILE!, "utf8").trim();
const gl = path.join(process.env.MAPBOX_GL_DIR!, "node_modules/mapbox-gl/dist");
const lib = readFileSync(path.join(gl, "mapbox-gl.js"), "utf8");
const css = readFileSync(path.join(gl, "mapbox-gl.css"), "utf8");

const SHOTS: { name: string; scheme: "light" | "dark" | "satellite-streets"; center: [number, number]; zoom: number; caption: string }[] = [
  { name: "light-sydney-z9", scheme: "light", center: [150.95, -33.85], zoom: 9, caption: "Sydney zoomed out: the motorway network (M1, M2, M4, M5, M7...)" },
  { name: "light-m4-m7-z12", scheme: "light", center: [150.868, -33.801], zoom: 12, caption: "M4 / M7 interchange: motorways + ramps amber, highways slate" },
  { name: "light-m4-m7-z14", scheme: "light", center: [150.868, -33.801], zoom: 14, caption: "Ramps onto the motorway in the same amber" },
  { name: "light-m5-z15", scheme: "light", center: [151.019, -33.932], zoom: 15, caption: "M5 at street level, shield on the line" },
  { name: "dark-sydney-z9", scheme: "dark", center: [150.95, -33.85], zoom: 9, caption: "Dark: muted amber motorways" },
  { name: "dark-m4-m7-z13", scheme: "dark", center: [150.868, -33.801], zoom: 13, caption: "Dark: M4 / M7" },
  { name: "satellite-m4-m7-z13", scheme: "satellite-streets", center: [150.868, -33.801], zoom: 13, caption: "Satellite: motorways amber over the imagery" },
];

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const notes: Record<string, unknown> = {};
  for (const s of SHOTS) {
    const style = JSON.parse(readFileSync(`src/map-v2/styles/trackline-${s.scheme}.json`, "utf8"));
    await page.goto("about:blank");
    await page.setContent(
      `<html><head><style>${css} body{margin:0;background:${s.scheme === "light" ? "#fff" : "#1B2230"}} #m{width:${W}px;height:${H}px}</style></head><body><script>window.__name=(f)=>f;</script><div id="m"></div><div style="position:absolute;left:12px;right:12px;bottom:16px;background:rgba(17,17,17,.82);color:#fff;font:600 12px -apple-system,Helvetica,Arial;padding:6px 10px;border-radius:10px">${s.caption} · app zoom ${s.zoom} · real tiles</div><script>${lib}</script></body></html>`
    );
    const r = await page.evaluate(
      async ({ token, style, center, zoom, plates, prefix }: { token: string; style: unknown; center: [number, number]; zoom: number; plates: Record<string, string>; prefix: string }) => {
        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({ container: "m", style, center, zoom, preserveDrawingBuffer: true });
        // The shield plates TrackLineMap registers on the phone (same colours, white edge, stretchable).
        map.on("styleimagemissing", (e: { id: string }) => {
          if (!e.id.startsWith(prefix + "-") || map.hasImage(e.id)) return;
          const plate = e.id.slice(prefix.length + 1);
          const c = document.createElement("canvas");
          c.width = c.height = 40;
          const g = c.getContext("2d")!;
          g.fillStyle = plate === "white" ? "#1A1A1A" : "#FFFFFF";
          g.beginPath();
          g.roundRect(0, 0, 40, 40, 10);
          g.fill();
          g.fillStyle = plates[plate] ?? "#FFFFFF";
          g.beginPath();
          g.roundRect(3, 3, 34, 34, 8);
          g.fill();
          map.addImage(e.id, g.getImageData(0, 0, 40, 40), { pixelRatio: 2, stretchX: [[12, 28]], stretchY: [[12, 28]], content: [8, 8, 32, 32] });
        });
        await new Promise((res) => map.on("load", res));
        await new Promise((res) => {
          map.once("idle", res);
          setTimeout(res, 25000);
        });
        const feats = map.queryRenderedFeatures(undefined, { layers: ["road-motorway"] });
        return { zoom: map.getZoom(), motorwayFeaturesDrawn: feats.length, refs: [...new Set(feats.map((f: { properties: { ref?: string } }) => f.properties.ref).filter(Boolean))].slice(0, 8) };
      },
      { token, style, center: s.center, zoom: mapboxZoomFromGoogle(s.zoom), plates: SHIELD_PLATE_COLOURS, prefix: SHIELD_IMAGE }
    );
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    notes[s.name] = { appZoom: s.zoom, ...r };
    console.log(s.name, JSON.stringify(r));
  }
  writeFileSync(`${OUT}/shots.json`, JSON.stringify(notes, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
