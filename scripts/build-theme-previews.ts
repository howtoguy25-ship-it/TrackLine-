// Map styles add-on §3: the theme picker's previews are the real styles drawn with real Mapbox
// tiles (not colour swatches): each theme from buildStyle, over Sydney CBD at z14 with a route in
// that theme's own route colours, rendered by Mapbox GL JS in headless Chromium.
// Run: MAPBOX_TOKEN_FILE=… MAPBOX_GL_DIR=… npx tsx scripts/build-theme-previews.ts
// The token is read from the file and never printed.
/* global mapboxgl */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { SATELLITE_LABEL_PALETTE, THEME_PALETTES, buildStyle, type StylePalette } from "../src/map-v2/styles/buildStyle";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright");
declare const mapboxgl: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const token = readFileSync(process.env.MAPBOX_TOKEN_FILE!, "utf8").trim();
const gl = path.join(process.env.MAPBOX_GL_DIR!, "node_modules/mapbox-gl/dist");
const lib = readFileSync(path.join(gl, "mapbox-gl.js"), "utf8");
const css = readFileSync(path.join(gl, "mapbox-gl.css"), "utf8");
const W = 320;
const H = 184;
const CENTER: [number, number] = [151.2075, -33.8705];
const ROUTE: [number, number][] = [[151.2005, -33.8755], [151.2042, -33.8727], [151.2069, -33.8712], [151.2101, -33.8684], [151.2139, -33.8662]];

const styles: [string, StylePalette, boolean][] = [
  ...Object.entries(THEME_PALETTES).map(([k, p]) => [k, p, false] as [string, StylePalette, boolean]),
  ["satellite", SATELLITE_LABEL_PALETTE, true],
];

(async () => {
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  for (const [key, palette, satellite] of styles) {
    const style = buildStyle(palette, { satellite });
    await page.setContent(`<html><head><style>${css} body{margin:0} #m{width:${W}px;height:${H}px} .mapboxgl-ctrl-bottom-left,.mapboxgl-ctrl-bottom-right{display:none}</style></head><body><div id="m"></div><script>${lib}</script></body></html>`);
    await page.evaluate(
      async ({ token, style, CENTER, ROUTE, palette }: { token: string; style: unknown; CENTER: [number, number]; ROUTE: [number, number][]; palette: StylePalette }) => {
        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({ container: "m", style, center: CENTER, zoom: 14, preserveDrawingBuffer: true, attributionControl: false });
        await new Promise((r) => map.on("load", r));
        map.addSource("r", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ROUTE } } });
        map.addLayer({ id: "rc", type: "line", source: "r", paint: { "line-color": palette.routeCasing, "line-width": 9 }, layout: { "line-cap": "round", "line-join": "round" } });
        map.addLayer({ id: "rl", type: "line", source: "r", paint: { "line-color": palette.route, "line-width": 6 }, layout: { "line-cap": "round", "line-join": "round" } });
        await new Promise((r) => { map.once("idle", r); setTimeout(r, 25000); });
      },
      { token, style, CENTER, ROUTE, palette }
    );
    const out = `assets/map/theme-previews/${key}.jpg`;
    writeFileSync(out, await page.screenshot({ type: "jpeg", quality: 82 }));
    console.log("wrote", out);
  }
  await b.close();
})();
