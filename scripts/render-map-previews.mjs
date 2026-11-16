// Renders TrackLine's own map style (src/map-v2/styles/trackline-{light,dark}.json -- the exact
// files the app ships) for a spread of places worldwide, at zoom 11, 14, 16 and 18, into
// docs/map-previews/, so the style can be checked on GitHub without a phone.
//
// Why not the Mapbox Static Images API: it only renders styles uploaded to a Mapbox account
// (Mapbox Studio), and ours is a local JSON file built from rules. So this draws the same JSON
// with Mapbox GL JS in a headless browser -- the same tiles, fonts and rules as the phone.
//
// Needs the app's public Mapbox token (pk....) in MAPBOX_PUBLIC_TOKEN:
//   npm i --no-save mapbox-gl@3.35.0
//   MAPBOX_PUBLIC_TOKEN=pk... node scripts/render-map-previews.mjs [--only sydney-cbd]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "docs/map-previews");
const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (!token) {
  console.error("No Mapbox token: set MAPBOX_PUBLIC_TOKEN (the app's public pk. token). Nothing rendered.");
  process.exit(2);
}

export const PLACES = [
  ["sydney-cbd", "Sydney CBD", -33.8688, 151.2093],
  ["greenacre-bankstown", "Greenacre / Bankstown", -33.905, 151.056],
  ["parramatta", "Parramatta", -33.815, 151.0011],
  ["dubbo", "Dubbo (regional NSW)", -32.2569, 148.6011],
  ["melbourne", "Melbourne", -37.8136, 144.9631],
  ["brisbane", "Brisbane", -27.4698, 153.0251],
  ["perth", "Perth", -31.9523, 115.8613],
  ["auckland", "Auckland", -36.8485, 174.7633],
  ["london", "London", 51.5074, -0.1278],
  ["paris", "Paris", 48.8566, 2.3522],
  ["new-york", "New York", 40.7128, -74.006],
  ["los-angeles", "Los Angeles", 34.0522, -118.2437],
  ["toronto", "Toronto", 43.6532, -79.3832],
  ["dubai", "Dubai", 25.2048, 55.2708],
  ["tokyo", "Tokyo", 35.6762, 139.6503],
  ["riyadh", "Riyadh", 24.7136, 46.6753],
  ["beirut", "Beirut", 33.8938, 35.5018],
  ["mexico-city", "Mexico City", 19.4326, -99.1332],
  ["cape-town", "Cape Town", -33.9249, 18.4241],
  ["hume-hwy", "Hume Hwy near Marulan (rural highway)", -34.708, 150.009],
  ["m4-m7", "M4 / M7 Light Horse Interchange (motorway interchange)", -33.7957, 150.8596],
  ["sydney-harbour", "Sydney Harbour (coastline, ferries)", -33.8523, 151.2108],
];
const ZOOMS = [11, 14, 16, 18];
const THEMES = ["light", "dark"];

// The shield plates the app draws at runtime (TrackLineMap), same colours.
const PLATES = { green: "#1F8A3B", blue: "#1E4FA3", white: "#FFFFFF", red: "#C8102E", yellow: "#FFD400", orange: "#E87722", brown: "#7A4A21" };

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const { chromium } = require("playwright");
const glJs = fs.readFileSync(require.resolve("mapbox-gl/dist/mapbox-gl.js"), "utf8");
const glCss = fs.readFileSync(require.resolve("mapbox-gl/dist/mapbox-gl.css"), "utf8");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
await page.setContent(`<html><head><style>${glCss} html,body,#m{margin:0;width:640px;height:640px}</style></head><body><div id="m"></div></body></html>`);
await page.addScriptTag({ content: glJs });

const results = [];
for (const theme of THEMES) {
  const style = JSON.parse(fs.readFileSync(path.join(ROOT, `src/map-v2/styles/trackline-${theme}.json`), "utf8"));
  for (const [slug, label, lat, lng] of PLACES) {
    if (only && slug !== only) continue;
    for (const zoom of ZOOMS) {
      const file = `${slug}-z${zoom}-${theme}.png`;
      const ok = await page.evaluate(
        async ({ token, style, lat, lng, zoom, plates }) => {
          window.mapboxgl.accessToken = token;
          if (window.__map) window.__map.remove();
          const map = new window.mapboxgl.Map({ container: "m", style, center: [lng, lat], zoom, interactive: false, attributionControl: true, preserveDrawingBuffer: true });
          window.__map = map;
          map.on("styleimagemissing", (e) => {
            const plate = e.id.replace("tl-shield-", "");
            if (!plates[plate]) return;
            const c = document.createElement("canvas");
            c.width = c.height = 20;
            const g = c.getContext("2d");
            g.fillStyle = plates[plate];
            g.strokeStyle = plate === "white" ? "#1A1A1A" : "#FFFFFF";
            g.lineWidth = 1.5;
            g.beginPath();
            g.roundRect(1, 1, 18, 18, 5);
            g.fill();
            g.stroke();
            map.addImage(e.id, g.getImageData(0, 0, 20, 20), { stretchX: [[6, 14]], stretchY: [[6, 14]], content: [6, 6, 14, 14] });
          });
          return await new Promise((resolve) => {
            const t = setTimeout(() => resolve(false), 45000);
            map.once("idle", () => {
              clearTimeout(t);
              resolve(true);
            });
            map.on("error", (e) => console.log("map error", e?.error?.message));
          });
        },
        { token, style, lat, lng, zoom, plates: PLATES }
      );
      await page.screenshot({ path: path.join(OUT, file) });
      results.push({ slug, label, zoom, theme, file, ok });
      console.log(ok ? "rendered" : "TIMED OUT", file);
    }
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, "render-log.json"), JSON.stringify(results, null, 2));
