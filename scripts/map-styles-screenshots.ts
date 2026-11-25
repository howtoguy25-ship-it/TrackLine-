// Map styles add-on §4: every style (TrackLine Light/Normal, Dark, each theme, Satellite) at z11,
// z14 and z17 over Sydney and London, plus a driving view on a real route in each. Drawn from the
// app's own buildStyle with real Mapbox tiles in headless Chromium (Mapbox GL JS); the arrow is
// the app's own image; route colours are each style's own. Writes docs/map-styles/*.jpg + shots.json.
// Run: MAPBOX_TOKEN_FILE=… MAPBOX_GL_DIR=… npx tsx scripts/map-styles-screenshots.ts
// The token is read from the file and never printed.
/* global mapboxgl */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { SATELLITE_LABEL_PALETTE, THEME_PALETTES, buildStyle, type StylePalette } from "../src/map-v2/styles/buildStyle";
import { navFollowPadding, navStartBearing, NAV_FOLLOW_PITCH } from "../src/nav/navCamera";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright");
declare const mapboxgl: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const OUT = "docs/map-styles";
const W = 390;
const H = 844;
const token = readFileSync(process.env.MAPBOX_TOKEN_FILE!, "utf8").trim();
const gl = path.join(process.env.MAPBOX_GL_DIR!, "node_modules/mapbox-gl/dist");
const lib = readFileSync(path.join(gl, "mapbox-gl.js"), "utf8");
const css = readFileSync(path.join(gl, "mapbox-gl.css"), "utf8");
const arrowPng = "data:image/png;base64," + readFileSync("assets/map/user-arrow@3x.png").toString("base64");

type LngLat = [number, number];
const CITIES: { key: string; name: string; centre: LngLat; from: LngLat; to: LngLat }[] = [
  { key: "sydney", name: "Sydney", centre: [151.2075, -33.8705], from: [151.0345, -33.9175], to: [151.104, -33.877] },
  { key: "london", name: "London", centre: [-0.1276, 51.5072], from: [-0.1281, 51.508], to: [-0.1239, 51.5308] },
];
const STYLES: { key: string; palette: StylePalette; satellite: boolean }[] = [
  ...Object.entries(THEME_PALETTES)
    .filter(([k]) => k !== "normal") // "Normal" is TrackLine Light (same palette)
    .map(([key, palette]) => ({ key, palette, satellite: false })),
  { key: "satellite", palette: SATELLITE_LABEL_PALETTE, satellite: true },
];

async function route(from: LngLat, to: LngLat): Promise<LngLat[]> {
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from.join(",")};${to.join(",")}?geometries=geojson&overview=full&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);
  return ((await res.json()) as { routes: { geometry: { coordinates: LngLat[] } }[] }).routes[0].geometry.coordinates;
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const routes: Record<string, LngLat[]> = {};
  for (const c of CITIES) routes[c.key] = await route(c.from, c.to);
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e: Error) => console.log("pageerror", String(e).slice(0, 160)));
  const shots: Record<string, unknown>[] = [];
  for (const s of STYLES) {
    const style = buildStyle(s.palette, { satellite: s.satellite });
    for (const c of CITIES) {
      const line = routes[c.key];
      const start = { latitude: line[0][1], longitude: line[0][0] };
      const bearing = navStartBearing(line.map(([lng, lat]) => ({ latitude: lat, longitude: lng })), start)!;
      const views = [
        ...[11, 14, 17].map((z) => ({ name: `${s.key}-${c.key}-z${z}`, kind: "home", camera: { center: c.centre, zoom: z, pitch: 0, bearing: 0 }, driver: { at: c.centre, heading: 30 }, route: null as LngLat[] | null })),
        { name: `${s.key}-${c.key}-nav`, kind: "nav", camera: { center: line[0], zoom: 16.5, pitch: NAV_FOLLOW_PITCH, bearing, padding: navFollowPadding(H) }, driver: { at: line[0], heading: bearing }, route: line },
      ];
      for (const v of views) {
        await page.setContent(`<html><head><style>${css} body{margin:0} #m{width:${W}px;height:${H}px} #t{position:absolute;left:12px;top:12px;background:rgba(17,17,17,.8);color:#fff;font:600 12px -apple-system,Helvetica,Arial;padding:6px 10px;border-radius:10px}</style></head><body><div id="m"></div><div id="t">${s.palette.name} · ${c.name} · ${v.kind === "nav" ? "driving" : "z" + v.camera.zoom}</div><script>${lib}</script></body></html>`);
        const m = await page.evaluate(
          async ({ token, style, v, palette, arrowPng }: { token: string; style: unknown; v: any; palette: StylePalette; arrowPng: string }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            mapboxgl.accessToken = token;
            const map = new mapboxgl.Map({ container: "m", style, center: v.camera.center, zoom: v.camera.zoom, pitch: v.camera.pitch, bearing: v.camera.bearing, preserveDrawingBuffer: true });
            await new Promise((r) => map.on("load", r));
            if (v.camera.padding) map.jumpTo({ center: v.camera.center, zoom: v.camera.zoom, pitch: v.camera.pitch, bearing: v.camera.bearing, padding: v.camera.padding });
            const img = new Image();
            img.src = arrowPng;
            await img.decode();
            map.addImage("user-arrow", img, { pixelRatio: 3 });
            if (v.route) {
              map.addSource("r", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: v.route } } });
              map.addLayer({ id: "rc", type: "line", source: "r", paint: { "line-color": palette.routeCasing, "line-width": 14 }, layout: { "line-cap": "round", "line-join": "round" } }, "road-label-service");
              map.addLayer({ id: "rl", type: "line", source: "r", paint: { "line-color": palette.route, "line-width": 10 }, layout: { "line-cap": "round", "line-join": "round" } }, "road-label-service");
            }
            map.addSource("me", { type: "geojson", data: { type: "Feature", properties: { h: v.driver.heading }, geometry: { type: "Point", coordinates: v.driver.at } } });
            map.addLayer({ id: "me", type: "symbol", source: "me", layout: { "icon-image": "user-arrow", "icon-rotate": ["get", "h"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-allow-overlap": true } });
            await new Promise((r) => { map.once("idle", r); setTimeout(r, 30000); });
            const labels = map.queryRenderedFeatures({ layers: map.getStyle().layers.filter((l: { id: string; type: string }) => l.type === "symbol").map((l: { id: string }) => l.id) }).length;
            return { features: map.queryRenderedFeatures().length, labels, arrowY: map.project(v.driver.at).y };
          },
          { token, style, v, palette: s.palette, arrowPng }
        );
        await page.screenshot({ path: path.join(OUT, `${v.name}.jpg`), type: "jpeg", quality: 80 });
        shots.push({ file: `${v.name}.jpg`, style: s.palette.name, city: c.name, view: v.kind === "nav" ? "driving" : `z${v.camera.zoom}`, renderedFeatures: m.features, labels: m.labels, ...(v.kind === "nav" ? { arrowYFraction: +(m.arrowY / H).toFixed(3) } : {}) });
        console.log(v.name, m.features, "features", m.labels, "labels");
      }
    }
  }
  await b.close();
  writeFileSync(path.join(OUT, "shots.json"), JSON.stringify(shots, null, 2));
})();
