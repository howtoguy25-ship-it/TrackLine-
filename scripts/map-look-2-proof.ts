// Proof renders for docs/map-look-2: the app's real map style (with the new haze and quieter
// buildings) on real Mapbox tiles in headless Chromium, at one spot from street level out to the
// region view, each frame tilted by the app's own curve (map/tiltCurve.ts), with the arrow and its
// grey disc drawn by the same layer settings (USER_HALO). No iOS simulator on Linux: these are
// map renders, not phone screenshots.
// Run: MAPBOX_TOKEN_FILE=<file with a pk. token> MAPBOX_GL_DIR=<dir with mapbox-gl> npx tsx scripts/map-look-2-proof.ts
/* global mapboxgl */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { tiltForZoom } from "../src/map/tiltCurve";
import { mapboxZoomFromGoogle } from "../src/map-v2/geo";
import { USER_HALO } from "../src/map-v2/layers/userHalo";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright");
declare const mapboxgl: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const W = 390;
const H = 844;
const OUT = "docs/map-look-2";
const token = readFileSync(process.env.MAPBOX_TOKEN_FILE!, "utf8").trim();
const gl = path.join(process.env.MAPBOX_GL_DIR!, "node_modules/mapbox-gl/dist");
const lib = readFileSync(path.join(gl, "mapbox-gl.js"), "utf8");
const css = readFileSync(path.join(gl, "mapbox-gl.css"), "utf8");
const arrowPng = "data:image/png;base64," + readFileSync("assets/map/user-arrow@3x.png").toString("base64");
const here: [number, number] = [151.0345, -33.9175];
const ZOOMS = [17, 16, 15, 14.5, 13.5, 12.5, 11.5, 10.5];

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const notes: Record<string, unknown> = {};
  for (const scheme of ["light", "dark"] as const) {
    const style = JSON.parse(readFileSync(`src/map-v2/styles/trackline-${scheme}.json`, "utf8"));
    for (const z of ZOOMS) {
      const pitch = Math.round(tiltForZoom(z) * 10) / 10;
      await page.goto("about:blank");
      await page.setContent(`<html><head><style>${css} body{margin:0;background:${scheme === "dark" ? "#1B2230" : "#fff"}} #m{width:${W}px;height:${H}px}</style></head><body><script>window.__name=(f)=>f;</script><div id="m"></div><div style="position:absolute;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(17,17,17,.82);color:#fff;font:600 12px -apple-system,Helvetica,Arial;padding:6px 10px;border-radius:10px">zoom ${z} · tilt ${pitch}° (tiltForZoom) · real tiles</div><script>${lib}</script></body></html>`);
      const r = await page.evaluate(
        async ({ token, style, here, zoom, pitch, arrowPng, halo }: { token: string; style: unknown; here: [number, number]; zoom: number; pitch: number; arrowPng: string; halo: typeof USER_HALO }) => {
          mapboxgl.accessToken = token;
          const map = new mapboxgl.Map({ container: "m", style, center: here, zoom, pitch, bearing: 20, preserveDrawingBuffer: true, padding: { top: 0, bottom: 260, left: 0, right: 0 } });
          await new Promise((res) => map.on("load", res));
          const img = new Image();
          img.src = arrowPng;
          await img.decode();
          map.addImage("arrow", img, { pixelRatio: 3 });
          map.addSource("me", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: here } } });
          map.addLayer({ id: "me-halo", type: "circle", source: "me", paint: { "circle-radius": halo.radius, "circle-color": halo.color, "circle-stroke-color": halo.stroke, "circle-stroke-width": 1, "circle-pitch-alignment": "map" } });
          map.addLayer({ id: "me", type: "symbol", source: "me", layout: { "icon-image": "arrow", "icon-rotate": 20, "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 0.8, 17, 1.0, 20, 1.15] } });
          await new Promise((res) => { map.once("idle", res); setTimeout(res, 25000); });
          return { zoom: map.getZoom(), pitch: map.getPitch(), fog: !!map.getFog() };
        },
        { token, style, here, zoom: mapboxZoomFromGoogle(z), pitch, arrowPng, halo: USER_HALO }
      );
      await page.waitForTimeout(400);
      const name = `${scheme}-z${String(z).replace(".", "_")}`;
      await page.screenshot({ path: `${OUT}/${name}.png` });
      notes[name] = { appZoom: z, ...r };
      console.log(name, JSON.stringify(r));
    }
  }
  // Filmstrip: street level -> region, light on top, dark below.
  const imgs = (s: string) => ZOOMS.map((z) => `<img src="data:image/png;base64,${readFileSync(`${OUT}/${s}-z${String(z).replace(".", "_")}.png`).toString("base64")}" style="width:195px;height:422px">`).join("");
  await page.setViewportSize({ width: 195 * 8 + 70, height: 900 });
  await page.goto("about:blank");
  await page.setContent(`<body style="margin:0;padding:10px;background:#fff;font:600 13px -apple-system,Helvetica,Arial"><div>Pinch out from street level: gentle lean → most lean → flat (map/tiltCurve.ts) · real tiles</div><div style="display:flex;gap:10px;margin-top:6px">${imgs("light")}</div><div style="display:flex;gap:10px;margin-top:10px">${imgs("dark")}</div></body>`);
  await page.screenshot({ path: `${OUT}/filmstrip.png`, fullPage: true });
  writeFileSync(`${OUT}/shots.json`, JSON.stringify(notes, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
