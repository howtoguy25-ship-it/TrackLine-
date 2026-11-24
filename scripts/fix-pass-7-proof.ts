// Proof renders for fix pass 7 (written to docs/fix-pass-6, the folder the brief asked for). No
// iOS simulator on the Linux build machine, so -- like scripts/fix-pass-5-proof.ts -- this draws
// the app's real map style on real Mapbox tiles in headless Chromium and puts the app's screens on
// top as HTML built from the app's own code:
//   * exit gates: REAL OSM sites and gates (Overpass, our own query + parser: nav/exitGates.ts),
//     a REAL route out of the yard (Mapbox Directions, live), the app's decision (decideExit), the
//     question text (exitLabel/exitQuestion), the answer plan (exitAnswerPlan), and the rerouted
//     route through the other gate (Mapbox Directions with that gate as a waypoint -- the app asks
//     Google's Routes API with the gate as a via point; same idea);
//   * calm arrow: 60 s of noisy stationary GPS fed through stillLockStep / HeadingHold, and a
//     drive at 14 m/s with along-track noise through smoothAlong;
//   * home map: HOME_FOLLOW_ZOOM + tiltForZoom + the generated style, laid out by screenLayout on
//     a phone, a landscape phone and an iPad (portrait + landscape), with the ad slot from
//     bannerSlotHeight;
//   * navigation: navControlFrames (Re-centre in the right column above Report), the turn callout
//     beside the turn (calloutSide / calloutAnchor), the route line with one casing.
// Every image says "drawn" -- drawings of the React Native screens on real tiles, not phone
// screenshots. Measured values go to shots.json.
//
// Run: MAPBOX_TOKEN_FILE=<file with a pk. token> MAPBOX_GL_DIR=<dir with mapbox-gl installed> \
//        npx tsx scripts/fix-pass-7-proof.ts
// The token is read from the file and never printed.
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  alternativeExit,
  bucketFor,
  decideExit,
  exitAnswerPlan,
  exitLabel,
  exitQuestion,
  gatesOnRouteStart,
  overpassQuery,
  parseOverpass,
  siteAt,
  siteGates,
  type Gate,
  type OsmElement,
  type Site,
  type SiteData,
} from "../src/nav/exitGates";
import { HeadingHold, INITIAL_STILL, smoothAlong, stillLockStep, type AlongState, type StillState } from "../src/nav/stillLock";
import { buildRouteGeometry, pointAt, routeBearingAt } from "../src/nav/routeMatcher";
import { HOME_FOLLOW_ZOOM } from "../src/map/homeMapLogic";
import { tiltForZoom } from "../src/map/tiltCurve";
import { mapboxZoomFromGoogle } from "../src/map-v2/geo";
import { roadWidthExpression } from "../src/map-v2/styles/buildStyle";
import { screenLayout, withPanelPadding, type ScreenLayout } from "../src/layout/screenLayout";
import { bannerSlotHeight } from "../src/components/bannerSlot";
import { NAV_FOLLOW_PITCH, navFollowPadding, navZoomForSpeed } from "../src/nav/navCamera";
import { EXIT_CARD_HEIGHT, EXIT_CARD_SIDE, exitCardPlacement, navControlFrames, overlaps, type Frame } from "../src/nav/navControlsLayout";
import { CALLOUT_TAIL, calloutAnchor, calloutSide } from "../src/nav/turnCallout";
import { routeColoursFor } from "../src/map-v2/styles/mapAppearance";
import type { LatLng } from "../src/utils/polyline";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright");

declare const mapboxgl: any;  

const FONT = "-apple-system,Helvetica,Arial";
const OUT = "docs/fix-pass-6";
const token = readFileSync(process.env.MAPBOX_TOKEN_FILE!, "utf8").trim();
const gl = path.join(process.env.MAPBOX_GL_DIR!, "node_modules/mapbox-gl/dist");
const lib = readFileSync(path.join(gl, "mapbox-gl.js"), "utf8");
const css = readFileSync(path.join(gl, "mapbox-gl.css"), "utf8");
const arrowPng = "data:image/png;base64," + readFileSync("assets/map/user-arrow@3x.png").toString("base64");
const recorded = JSON.parse(readFileSync("docs/fix-pass-5/recorded-route.json", "utf8"));

type LngLat = [number, number];
type Pad = { top: number; bottom: number; left: number; right: number };
const ll = (p: LatLng): LngLat => [p.longitude, p.latitude];
const lat = (p: LngLat): LatLng => ({ latitude: p[1], longitude: p[0] });
const metres = (a: LatLng, b: LatLng) => {
  const k = Math.PI / 180;
  const x = (b.longitude - a.longitude) * k * Math.cos(((a.latitude + b.latitude) / 2) * k);
  const y = (b.latitude - a.latitude) * k;
  return Math.hypot(x, y) * 6_371_000;
};
const offset = (p: LatLng, north: number, east: number): LatLng => ({ latitude: p.latitude + north / 111_195, longitude: p.longitude + east / (111_195 * Math.cos((p.latitude * Math.PI) / 180)) });
const bearingOf = (a: LatLng, b: LatLng) => (Math.atan2((b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180), b.latitude - a.latitude) * 180) / Math.PI;

/** Seeded so every run draws the same noise. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

interface Shot {
  name: string;
  scheme: "light" | "dark";
  width: number;
  height: number;
  camera?: { center: LngLat; zoom: number; pitch: number; bearing: number; padding?: Pad };
  fit?: { coords: LngLat[]; padding: Pad };
  routes?: { line: LngLat[]; selected: boolean; faded?: boolean }[];
  driver?: { at: LngLat; heading: number };
  polygons?: LngLat[][];
  dots?: { at: LngLat; color: string; r: number }[];
  pins?: { at: LngLat; html: string; ax: number; ay: number }[];
  overlay: string;
  noMap?: boolean;
  measureRoad?: boolean;
}

const caption = (text: string, y: number, w: number) =>
  `<div style="position:absolute;left:${w / 2}px;top:${y}px;transform:translateX(-50%);background:rgba(17,17,17,.82);color:#fff;font:600 11px ${FONT};padding:5px 9px;border-radius:9px;max-width:${Math.min(520, w - 20)}px;text-align:center;z-index:9">${text}</div>`;

// ---------------------------------------------------------------- real data
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const overpassCache = new Map<string, SiteData>();
const diskCache = process.env.OVERPASS_CACHE_DIR;
const cacheFile = (q: string) => path.join(diskCache!, require("crypto").createHash("sha1").update(q).digest("hex") + ".json"); // eslint-disable-line @typescript-eslint/no-require-imports
async function overpass(q: string): Promise<SiteData> {
  const hit = overpassCache.get(q);
  if (hit) return hit;
  if (diskCache) {
    try {
      const d = JSON.parse(readFileSync(cacheFile(q), "utf8")) as SiteData;
      overpassCache.set(q, d);
      return d;
    } catch {
      // not cached yet
    }
  }
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded", "User-Agent": "TrackLine-proof/1.0" }, signal: AbortSignal.timeout(30_000) });
        if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
        const data = parseOverpass(((await r.json()) as { elements: OsmElement[] }).elements);
        overpassCache.set(q, data);
        if (diskCache) writeFileSync(cacheFile(q), JSON.stringify(data));
        return data;
      } catch (e) {
        last = e;
      }
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw last;
}
async function mapboxRoute(points: LngLat[]): Promise<{ line: LngLat[]; seconds: number; metres: number; firstStreet: string | null } | null> {
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${points.map((p) => p.join(",")).join(";")}?geometries=geojson&overview=full&steps=true&access_token=${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);
  const json = (await res.json()) as { routes: { geometry: { coordinates: LngLat[] }; duration: number; distance: number; legs: { steps: { name: string }[] }[] }[] };
  const r = json.routes[0];
  if (!r) return null;
  const firstStreet = r.legs[0]?.steps.map((s) => s.name).find((n) => n && n.length > 0) ?? null;
  return { line: r.geometry.coordinates, seconds: r.duration, metres: r.distance, firstStreet };
}

// ---------------------------------------------------------------- renderer
async function render(page: any, shot: Shot) {  
  const { width: w, height: h } = shot;
  const style = shot.noMap ? null : JSON.parse(readFileSync(`src/map-v2/styles/trackline-${shot.scheme}.json`, "utf8"));
  const colours = routeColoursFor(shot.scheme === "dark" ? "dark" : "light", false);
  const motorwayExpr = roadWidthExpression("motorway", 1, 2);
  await page.setViewportSize({ width: w, height: h });
  await page.goto("about:blank");
  await page.setContent(`<html><head><style>${css} body{margin:0;overflow:hidden;background:${shot.noMap ? "#F4F5F7" : shot.scheme === "dark" ? "#1C1D20" : "#fff"}} #m{width:${w}px;height:${h}px} #o{position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none}</style></head><body><script>window.__name=(f)=>f;</script><div id="m"></div><div id="o">${shot.overlay}</div><script>${lib}</script></body></html>`);
  if (shot.noMap) return {};
  return page.evaluate(
    async ({ token, style, shot, arrowPng, colours, motorwayExpr }: { token: string; style: unknown; shot: Shot; arrowPng: string; colours: { route: string; routeCasing: string; routeAlt: string }; motorwayExpr: unknown[] }) => {
      mapboxgl.accessToken = token;
      const cam = shot.camera;
      const map = new mapboxgl.Map({ container: "m", style, center: cam?.center ?? shot.fit!.coords[0], zoom: cam?.zoom ?? 13, pitch: cam?.pitch ?? 0, bearing: cam?.bearing ?? 0, preserveDrawingBuffer: true });
      await new Promise((r) => map.on("load", r));
      const arrow = new Image();
      arrow.src = arrowPng;
      await arrow.decode();
      map.addImage("user-arrow", arrow, { pixelRatio: 3 });
      const below = map.getLayer("road-label-service") ? "road-label-service" : undefined;
      (shot.polygons ?? []).forEach((poly, i) => {
        map.addSource(`poly-${i}`, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [poly] } } });
        map.addLayer({ id: `poly-${i}`, type: "line", source: `poly-${i}`, paint: { "line-color": "#E0A53A", "line-width": 2, "line-dasharray": [2, 2] } }, below);
      });
      const order = [...(shot.routes ?? [])].map((r, i) => ({ r, i })).sort((a, b) => Number(a.r.selected) - Number(b.r.selected));
      for (const { r, i } of order) {
        map.addSource(`route-${i}`, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.line } } });
        // One darker casing, one fill -- no white stripe (fix pass 7 §4).
        if (r.selected) map.addLayer({ id: `casing-${i}`, type: "line", source: `route-${i}`, paint: { "line-color": colours.routeCasing, "line-width": 12 }, layout: { "line-cap": "round", "line-join": "round" } }, below);
        map.addLayer({ id: `route-${i}`, type: "line", source: `route-${i}`, paint: { "line-color": r.selected ? colours.route : colours.routeAlt, "line-width": r.selected ? 8 : 6, "line-opacity": r.faded ? 0.55 : 1, ...(r.faded ? { "line-dasharray": [1.5, 1.2] } : {}) }, layout: { "line-cap": "round", "line-join": "round" } }, below);
      }
      if (shot.driver) {
        map.addSource("me", { type: "geojson", data: { type: "Feature", properties: { heading: shot.driver.heading }, geometry: { type: "Point", coordinates: shot.driver.at } } });
        map.addLayer({ id: "me", type: "symbol", source: "me", layout: { "icon-image": "user-arrow", "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-allow-overlap": true } });
      }
      if (shot.fit) map.fitBounds(shot.fit.coords.reduce((b: any, c: [number, number]) => b.extend(c), new mapboxgl.LngLatBounds(shot.fit.coords[0], shot.fit.coords[0])), { padding: shot.fit.padding, duration: 0, bearing: 0, pitch: 0 });  
      else if (cam?.padding) map.jumpTo({ ...cam });
      await new Promise((r) => { map.once("idle", r); setTimeout(r, 25000); });
      const o = document.getElementById("o")!;
      const at = (p0: [number, number], html: string, dx: number, dy: number) => {
        const p = map.project(p0);
        const d = document.createElement("div");
        d.style.cssText = `position:absolute;left:${p.x + dx}px;top:${p.y + dy}px`;
        d.innerHTML = html;
        o.insertBefore(d, o.firstChild);
        return p;
      };
      for (const d of shot.dots ?? []) at(d.at, `<div style="width:${d.r * 2}px;height:${d.r * 2}px;border-radius:50%;background:${d.color}"></div>`, -d.r, -d.r);
      for (const p of shot.pins ?? []) at(p.at, p.html, p.ax, p.ay);
      // The motorway's drawn width at this zoom, from the style's own expression (exponential 1.5).
      let motorwayPx: number | null = null;
      if (shot.measureRoad) {
        const z = map.getZoom();
        const e = motorwayExpr as number[];
        const stops: [number, number][] = [];
        for (let i = 3; i < e.length; i += 2) stops.push([e[i], e[i + 1]]);
        motorwayPx = stops[stops.length - 1][1];
        for (let i = 1; i < stops.length; i++) {
          const [z0, v0] = stops[i - 1];
          const [z1, v1] = stops[i];
          if (z <= z1) {
            motorwayPx = v0 + (v1 - v0) * ((1.5 ** (z - z0) - 1) / (1.5 ** (z1 - z0) - 1));
            break;
          }
        }
        motorwayPx = +motorwayPx.toFixed(1);
      }
      const me = shot.driver ? map.project(shot.driver.at) : null;
      return { zoom: +map.getZoom().toFixed(2), pitch: Math.round(map.getPitch()), bearing: Math.round(map.getBearing()), motorwayPx, arrow: me ? { x: Math.round(me.x), y: Math.round(me.y) } : null };
    },
    { token, style, shot, arrowPng, colours, motorwayExpr }
  );
}

// ---------------------------------------------------------------- drawn pieces
const GATE_SVG = (color = "#E0A53A", size = 36) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 36 36"><rect x="5" y="10" width="5" height="22" rx="1.5" fill="#5B6472"/><circle cx="7.5" cy="12" r="3.2" fill="#5B6472"/><rect x="8" y="9.5" width="25" height="5" rx="2.5" fill="#fff" stroke="${color}" stroke-width="1.4"/>${[12, 18, 24, 30].map((x) => `<line x1="${x}" y1="9.8" x2="${x + 2.6}" y2="14.2" stroke="${color}" stroke-width="2.4"/>`).join("")}<rect x="3" y="31" width="30" height="2" rx="1" fill="#9AA3AF"/></svg>`;
const gatePin = (label: string, tone: string) => ({
  html: `<div style="display:flex;flex-direction:column;align-items:center"><div style="background:${tone};color:#fff;border-radius:8px;padding:2px 6px;font:700 11px ${FONT};white-space:nowrap;margin-bottom:2px">${label}</div><div style="width:12px;height:12px;border-radius:6px;background:${tone};border:2px solid #fff"></div></div>`,
  ax: -40,
  ay: -34,
});
function statusBar(w: number, top: number, light: boolean) {
  return `<div style="position:absolute;left:0;right:0;top:0;height:${top}px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;font:600 16px ${FONT};color:${light ? "#fff" : "#1F2125"};width:${w - 56}px"><span>9:41</span><span style="font-size:13px">●●● ▮</span></div>`;
}
function topBar(w: number, safeTop: number, distance: string, street: string, icon: string, left = 0, width = w) {
  return `<div style="position:absolute;left:${left}px;width:${width}px;top:0;background:#000;padding:${safeTop + 6}px 16px 14px;box-sizing:border-box;display:flex;align-items:center;gap:14px;${left > 0 ? "border-bottom-left-radius:18px;border-bottom-right-radius:18px;" : ""}">
    <div style="width:72px;height:72px;display:flex;align-items:center;justify-content:center">${icon}</div>
    <div style="flex:1;min-width:0"><div style="font:800 38px/44px ${FONT};color:#fff">${distance}</div>
    <div style="font:700 24px ${FONT};color:#41D8F5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${street}</div></div></div>${statusBar(w, safeTop, true)}`;
}
const TOP_BAR_H = 6 + 72 + 14;
const turnRight = (size: number) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><path d="M20 50V30a8 8 0 0 1 8-8h18M38 12l10 10-10 10" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const straight = (size: number) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><path d="M32 54V12M22 22l10-10 10 10" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function etaBar(w: number, safeBottom: number, eta: string, sub: string) {
  return `<div style="position:absolute;left:0;right:0;bottom:0;height:${110 + safeBottom}px;background:#1C1D20;border-top-left-radius:20px;border-top-right-radius:20px;display:flex;align-items:flex-start;justify-content:space-between;padding:22px 18px 0;box-sizing:border-box;width:${w}px">
    <div style="width:56px;height:56px;border-radius:28px;background:#33363B"></div>
    <div style="text-align:center"><div style="font:800 30px ${FONT};color:#fff">${eta}</div><div style="font:500 15px ${FONT};color:#B8BCC4">${sub}</div></div>
    <div style="width:56px;height:56px;border-radius:28px;background:#33363B"></div></div>`;
}
/** components/ExitGateCard.tsx, drawn: our gate icon, the question, [Open] [Closed]. */
function exitCard(question: string, place: { bottom: number; right: number }, w: number) {
  return `<div style="position:absolute;left:${EXIT_CARD_SIDE}px;width:${w - EXIT_CARD_SIDE - place.right}px;bottom:${place.bottom}px;max-height:${EXIT_CARD_HEIGHT}px;background:#fff;border-radius:20px;padding:12px;box-sizing:border-box;box-shadow:0 6px 18px rgba(0,0,0,.25)">
    <div style="display:flex;align-items:center;gap:12px">${GATE_SVG()}<div style="flex:1;font:700 16px/20px ${FONT};color:#1F2125">${question}</div></div>
    <div style="display:flex;gap:8px;margin-top:8px"><div style="flex:1;height:44px;border-radius:22px;background:#EEF0F3;display:flex;align-items:center;justify-content:center;font:700 16px ${FONT};color:#1F2125">Open</div><div style="flex:1;height:44px;border-radius:22px;background:#0098FF;display:flex;align-items:center;justify-content:center;font:700 16px ${FONT};color:#fff">Closed</div></div></div>`;
}
const toast = (text: string, top: number, w: number) => `<div style="position:absolute;left:0;width:${w}px;top:${top}px;display:flex;justify-content:center"><div style="padding:8px 14px;border-radius:18px;background:rgba(20,22,26,.9);font:600 15px ${FONT};color:#fff">${text}</div></div>`;

(async () => {
  mkdirSync(OUT, { recursive: true });
  const notes: Record<string, unknown> = {};
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const shoot = async (shot: Shot) => {
    const r = await render(page, shot);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
    notes[shot.name] = r;
    console.log(shot.name, JSON.stringify(r).slice(0, 200));
  };

  // ======== 1-2. Smart exit gates: a real warehouse lot, its real gates, a real route out
  {
    const W = 390, H = 844, SAFE_TOP = 47, SAFE_BOTTOM = 34;
    const searchAt: LatLng[] = [{ latitude: -33.8395, longitude: 150.912 }, { latitude: -33.853, longitude: 150.89 }, { latitude: -33.83, longitude: 150.935 }];
    const destination: LatLng = { latitude: -33.8726, longitude: 150.9566 }; // Fairfield station
    let found: null | { data: SiteData; site: Site; gates: Gate[]; origin: LatLng; route: NonNullable<Awaited<ReturnType<typeof mapboxRoute>>>; exit: Gate; alt: Gate; rerouted: NonNullable<Awaited<ReturnType<typeof mapboxRoute>>> } = null;
    const tried: string[] = [];
    for (const p of searchAt) {
      if (found) break;
      let area: SiteData;
      try {
        area = await overpass(overpassQuery(p, 900));
      } catch (e) {
        console.log("  area skipped (Overpass unavailable):", String(e));
        continue;
      }
      // Warehouse lots first (the smallest site wins in siteAt, as in the app).
      const candidates = area.sites.filter((s) => s.kind === "warehouse" && siteGates(s, area.gates).length >= 2).sort((a, b) => a.areaM2 - b.areaM2);
      for (const cand of candidates) {
        if (found || tried.length > 60) break;
        const gates = siteGates(cand, area.gates);
        const c = cand.polygon.reduce((a, q) => ({ latitude: a.latitude + q.latitude / cand.polygon.length, longitude: a.longitude + q.longitude / cand.polygon.length }), { latitude: 0, longitude: 0 });
        for (const g of gates) {
          // Parked in the yard, 25 m inside the gate.
          const d = metres(g.point, c);
          const t = Math.min(1, 25 / Math.max(1, d));
          const origin = { latitude: g.point.latitude + (c.latitude - g.point.latitude) * t, longitude: g.point.longitude + (c.longitude - g.point.longitude) * t };
          // What the app runs at "Go": the site we're in (re-fetched around the start, ~500 m).
          const cell = { latitude: +origin.latitude.toFixed(3), longitude: +origin.longitude.toFixed(3) };
          let data: SiteData;
          try {
            data = await overpass(overpassQuery(cell));
          } catch {
            continue;
          }
          console.log("  try", cand.id, g.id);
          const site = siteAt(origin, data.sites);
          tried.push(`${cand.id}/${g.id}`);
          if (!site) continue;
          const siteG = siteGates(site, data.gates);
          const route = await mapboxRoute([ll(origin), ll(destination)]);
          if (!route) continue;
          const onRoute = gatesOnRouteStart(route.line.map(lat), siteG);
          if (onRoute.length === 0) continue;
          const exit = onRoute[0].gate;
          const alt = alternativeExit(siteG, exit.id, {}, origin, bucketFor(new Date()), Date.now());
          if (!alt) continue;
          const rerouted = await mapboxRoute([ll(origin), ll(alt.point), ll(destination)]);
          // The new route must really leave through the other gate, and not through the closed one.
          if (!rerouted || gatesOnRouteStart(rerouted.line.map(lat), [alt]).length === 0 || gatesOnRouteStart(rerouted.line.map(lat), [exit]).length > 0) continue;
          found = { data, site, gates: siteG, origin, route, exit, alt, rerouted };
          break;
        }
      }
    }
    if (!found) throw new Error(`No real site with a gate on a real route found (tried ${tried.length}: ${tried.join(", ")})`);
    const { site, gates, origin, route, exit, alt, rerouted } = found;
    const now = new Date();
    const bucket = bucketFor(now);
    const decision = decideExit({ site, exit, doc: null, myLast: null, nowMs: now.getTime(), bucket });
    const label = exitLabel(exit, site, route.firstStreet);
    const question = exitQuestion(label);
    const plan = exitAnswerPlan(false, { exit, gates, docs: {}, from: origin, bucket, arrivalVia: null }, now.getTime());
    notes.exitGates = {
      source: "OpenStreetMap via Overpass (live), Mapbox Directions (live)",
      site: { id: site.id, kind: site.kind, name: site.name, areaM2: Math.round(site.areaM2) },
      gates: gates.map((g) => ({ id: g.id, barrier: g.barrier, access: g.access, at: g.point })),
      origin,
      routeExitGate: exit.id,
      decision: decision.kind,
      question,
      closedPlan: plan.action === "reroute" ? { action: plan.action, via: plan.via.map((g) => g.id), say: plan.say } : plan,
      openPlan: exitAnswerPlan(true, { exit, gates, docs: {}, from: origin, bucket, arrivalVia: null }, now.getTime()),
      original: { km: +(route.metres / 1000).toFixed(2), min: Math.round(route.seconds / 60), passes: gatesOnRouteStart(route.line.map(lat), gates).map((g) => g.gate.id) },
      rerouted: { km: +(rerouted.metres / 1000).toFixed(2), min: Math.round(rerouted.seconds / 60), passes: gatesOnRouteStart(rerouted.line.map(lat), gates).map((g) => g.gate.id) },
      tried,
    };
    const heading = bearingOf(lat(route.line[0]), lat(route.line[Math.min(route.line.length - 1, 4)]));
    const gatePins = gates.map((g) => ({ at: ll(g.point), ...gatePin(g.id === exit.id ? `OSM gate ${g.id} · on route` : `OSM gate ${g.id}`, g.id === exit.id ? "#B4540A" : "#5B6472") }));
    const etaText = (s: number) => new Date(Date.now() + s * 1000).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" });
    // 1: stopped in the yard at the start of the drive -- the question.
    await shoot({
      name: "1-exit-question",
      scheme: "light",
      width: W,
      height: H,
      camera: { center: ll(origin), zoom: 17.2, pitch: NAV_FOLLOW_PITCH, bearing: heading, padding: navFollowPadding(H) },
      routes: [{ line: route.line, selected: true }],
      polygons: [site.polygon.map(ll)],
      driver: { at: ll(origin), heading },
      pins: gatePins,
      overlay:
        topBar(W, SAFE_TOP, `${Math.round(gatesOnRouteStart(route.line.map(lat), [exit])[0].alongM)} m`, route.firstStreet ?? "", straight(60)) +
        exitCard(question, exitCardPlacement({ windowHeight: H, safeTop: SAFE_TOP, safeBottom: SAFE_BOTTOM, topBarHeight: TOP_BAR_H, bottomBarHeight: 110 }), W) +
        etaBar(W, SAFE_BOTTOM, etaText(route.seconds), `${Math.round(route.seconds / 60)} min • ${(route.metres / 1000).toFixed(1)} km`) +
        caption(`Real OSM ${site.kind} ${site.id}${site.name ? ` (${site.name})` : ""} · ${gates.length} gates · real route leaves through ${exit.id} · stopped (0 km/h) → decideExit = "${decision.kind}" · dashed = site edge, pins = annotations · drawn`, SAFE_TOP + TOP_BAR_H + 10, W),
    });
    // 2: "Closed" -> out through the other gate (overview so both routes show).
    const fitCoords = [...route.line.slice(0, 60), ...rerouted.line.slice(0, 60), ll(origin), ...gates.map((g) => ll(g.point))];
    await shoot({
      name: "2-exit-closed-reroute",
      scheme: "light",
      width: W,
      height: H,
      fit: { coords: fitCoords, padding: { top: SAFE_TOP + TOP_BAR_H + 70, bottom: 110 + SAFE_BOTTOM + 40, left: 40, right: 40 } },
      routes: [{ line: route.line, selected: false, faded: true }, { line: rerouted.line, selected: true }],
      polygons: [site.polygon.map(ll)],
      driver: { at: ll(origin), heading: bearingOf(origin, alt.point) },
      pins: gates.map((g) => ({ at: ll(g.point), ...gatePin(g.id === exit.id ? `${g.id} · answered Closed` : g.id === alt.id ? `${g.id} · new exit` : g.id, g.id === exit.id ? "#C62828" : g.id === alt.id ? "#1E7A34" : "#5B6472") })),
      overlay:
        topBar(W, SAFE_TOP, "", "Using another exit", straight(60)) +
        toast("Using another exit", SAFE_TOP + TOP_BAR_H + 12, W) +
        etaBar(W, SAFE_BOTTOM, etaText(rerouted.seconds), `${Math.round(rerouted.seconds / 60)} min • ${(rerouted.metres / 1000).toFixed(1)} km`) +
        caption(`Tapped Closed → exitAnswerPlan = reroute via ${alt.id} ("${plan.action === "reroute" ? plan.say : ""}") · dashed grey = the old route out ${exit.id} · purple = new real route through ${alt.id} · overview for the picture · drawn`, H - 110 - SAFE_BOTTOM - 64, W),
    });
  }

  // ======== 3. Calm arrow: 60 s parked with noisy GPS; then driving at 14 m/s
  {
    const W = 390, H = 844;
    const r = rng(7);
    const parked: LatLng = { latitude: -33.84462, longitude: 151.03712 }; // a kerb in Homebush
    let s: StillState = INITIAL_STILL;
    const hold = new HeadingHold();
    let ex = 0, ey = 0; // correlated GPS wander (metres)
    const raw: LatLng[] = [];
    const drawn: LatLng[] = [];
    const headings: number[] = [];
    let heldChanges = 0;
    let lastHeld: number | null = null;
    for (let t = 0; t <= 60; t++) {
      ex = 0.85 * ex + gauss(r) * 2.4;
      ey = 0.85 * ey + gauss(r) * 2.4;
      const fix = { ...offset(parked, ey, ex), accuracy: 8 + r() * 12, speed: Math.abs(gauss(r)) * 0.45 + (r() < 0.08 ? 1.1 : 0), timeMs: t * 1000 };
      s = stillLockStep(s, fix);
      raw.push(fix);
      drawn.push({ latitude: s.latitude, longitude: s.longitude });
      const compass = 82 + gauss(r) * 7 + (r() < 0.06 ? 28 : 0);
      const held = hold.push(compass, t * 1000, s.locked);
      headings.push(Math.round(held ?? 0));
      if (lastHeld != null && held !== lastHeld) heldChanges++;
      lastHeld = held;
    }
    const rawSpread = Math.max(...raw.map((p) => metres(parked, p)));
    const rawPath = raw.slice(1).reduce((a, p, i) => a + metres(raw[i], p), 0);
    const drawnMoves = Math.max(...drawn.map((p) => metres(drawn[0], p)));
    notes.calmStill = { seconds: 60, rawMaxFromTrueM: +rawSpread.toFixed(1), rawPathWanderedM: +rawPath.toFixed(1), arrowMovedM: +drawnMoves.toFixed(2), locked: s.locked, compassHeldChanges: heldChanges };
    const dots = raw.map((p) => ({ at: ll(p), color: "rgba(229,72,77,.55)", r: 4 }));
    await shoot({
      name: "3-arrow-still-60s",
      scheme: "light",
      width: W,
      height: H,
      camera: { center: ll(parked), zoom: 18.3, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } },
      driver: { at: ll(drawn[drawn.length - 1]), heading: lastHeld ?? 0 },
      dots,
      overlay:
        statusBar(W, 47, false) +
        caption(`Parked 60 s · red dots = the 61 raw GPS fixes (wander up to ${rawSpread.toFixed(1)} m, ${rawPath.toFixed(0)} m of jitter) · the arrow moved ${drawnMoves.toFixed(1)} m (stillLockStep) · compass noise ±7° with spikes → heading changed ${heldChanges}× (HeadingHold) · drawn`, 70, W),
    });
    // Driving: the recorded route at a steady 14 m/s (50 km/h), the matcher's along-track noise ±5 m.
    const geo = buildRouteGeometry(recorded.steps, recorded.line);
    let a: AlongState | null = null;
    let st: StillState = INITIAL_STILL;
    const errsRaw: number[] = [];
    const errsDrawn: number[] = [];
    let lockedWhileDriving = 0;
    const r2 = rng(11);
    const along0 = 2000;
    for (let t = 0; t < 120; t++) {
      const truth = along0 + 14 * t;
      const measured = truth + gauss(r2) * 5;
      const p = pointAt(geo, measured);
      st = stillLockStep(st, { ...p, accuracy: 6, speed: 14 + gauss(r2) * 0.4, timeMs: t * 1000 });
      if (st.locked) lockedWhileDriving++;
      a = smoothAlong(a, measured, 14, t * 1000);
      if (t > 3) {
        errsRaw.push(Math.abs(measured - truth));
        errsDrawn.push(Math.abs(a.along - truth));
      }
    }
    const p95 = (xs: number[]) => +[...xs].sort((x, y) => x - y)[Math.floor(xs.length * 0.95)].toFixed(1);
    notes.calmDriving = { seconds: 120, speedMs: 14, rawAlongErrorP95M: p95(errsRaw), drawnAlongErrorP95M: p95(errsDrawn), secondsLockedWhileDriving: lockedWhileDriving };
    // Chart (no map): drawn arrow vs raw, both cases.
    const cw = 820, ch = 520;
    const plot = (xs: number[], ys: number[][], colours: string[], x0: number, y0: number, pw: number, phh: number, ymax: number, title: string, yLabel: string) => {
      const sx = (i: number) => x0 + (i / (xs.length - 1)) * pw;
      const sy = (v: number) => y0 + phh - (Math.min(v, ymax) / ymax) * phh;
      const lines = ys.map((y, k) => `<polyline fill="none" stroke="${colours[k]}" stroke-width="${k === ys.length - 1 ? 3 : 2}" points="${y.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ")}"/>`).join("");
      const grid = [0, 0.5, 1].map((f) => `<line x1="${x0}" x2="${x0 + pw}" y1="${sy(ymax * f)}" y2="${sy(ymax * f)}" stroke="#DADDE2"/><text x="${x0 - 6}" y="${sy(ymax * f) + 4}" font-size="11" text-anchor="end" fill="#6B7078">${(ymax * f).toFixed(0)}</text>`).join("");
      return `<text x="${x0}" y="${y0 - 10}" font-size="14" font-weight="700" fill="#1F2125">${title}</text>${grid}${lines}<text x="${x0}" y="${y0 + phh + 18}" font-size="11" fill="#6B7078">${yLabel}</text>`;
    };
    const tS = raw.map((_, i) => i);
    const stillRaw = raw.map((p) => metres(parked, p));
    const stillDrawn = drawn.map((p) => metres(drawn[0], p));
    const svg = `<svg width="${cw}" height="${ch}" font-family="Helvetica">
      ${plot(tS, [stillRaw, stillDrawn], ["#E5484D", "#0098FF"], 50, 60, 330, 300, 15, "Parked 60 s: distance from where it stopped (m)", "seconds 0-60 · red raw GPS · blue the arrow")}
      ${plot(errsRaw.map((_, i) => i), [errsRaw, errsDrawn], ["#E5484D", "#0098FF"], 460, 60, 330, 300, 15, "Driving 50 km/h: along-route error (m)", "seconds 4-120 · red matcher input · blue the arrow (smoothAlong)")}
    </svg>`;
    const summary = `<div style="position:absolute;left:50px;top:420px;font:500 14px/20px ${FONT};color:#1F2125;width:740px">Parked: the raw fixes wandered up to <b>${rawSpread.toFixed(1)} m</b>; the arrow moved <b>${drawnMoves.toFixed(1)} m</b> and its heading changed <b>${heldChanges}×</b> in 60 s.<br>Driving: 95% of the input was within <b>${p95(errsRaw)} m</b>; the arrow, within <b>${p95(errsDrawn)} m</b>, and it was locked for <b>${lockedWhileDriving}</b> s while moving (sharp, never held).</div>`;
    await shoot({ name: "3b-arrow-still-vs-driving", scheme: "light", width: cw, height: ch, noMap: true, overlay: `<div style="position:absolute;left:0;top:0">${svg}</div>` + summary });
  }

  // ======== 4. Home map at the new scale: phone, landscape phone, iPad portrait + landscape
  {
    const devices: { name: string; w: number; h: number; insets: { top: number; bottom: number; left: number; right: number } }[] = [
      { name: "4-home-phone", w: 390, h: 844, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
      { name: "4-home-phone-landscape", w: 844, h: 390, insets: { top: 0, bottom: 21, left: 47, right: 47 } },
      { name: "4-home-ipad", w: 1024, h: 1366, insets: { top: 24, bottom: 20, left: 0, right: 0 } },
      { name: "4-home-ipad-landscape", w: 1366, h: 1024, insets: { top: 24, bottom: 20, left: 0, right: 0 } },
    ];
    const here: LatLng = { latitude: -33.84318, longitude: 151.04125 }; // beside the M4 at Homebush
    const zoom = mapboxZoomFromGoogle(HOME_FOLLOW_ZOOM);
    const pitch = Math.round(tiltForZoom(HOME_FOLLOW_ZOOM));
    const banner = bannerSlotHeight(56); // an adaptive banner that reports 56 pt -> the slot is 56
    for (const d of devices) {
      const L: ScreenLayout = screenLayout(d.w, d.h, d.insets, "ios");
      const bannerArea = banner + d.insets.bottom;
      const mapH = d.h - bannerArea;
      const sheetPeek = 132;
      const bottomPad = L.panel.side === "bottom" ? sheetPeek : 0;
      const padding = withPanelPadding({ top: d.insets.top, bottom: bottomPad + bannerArea, left: 0, right: 0 }, L);
      const panel =
        L.panel.side === "bottom"
          ? `<div style="position:absolute;left:0;right:0;bottom:${bannerArea}px;height:${sheetPeek}px;background:#fff;border-top-left-radius:24px;border-top-right-radius:24px;box-shadow:0 -4px 16px rgba(0,0,0,.14);padding:10px 16px;box-sizing:border-box"><div style="width:40px;height:5px;border-radius:3px;background:#DADDE2;margin:0 auto 12px"></div><div style="height:52px;border-radius:26px;background:#EEF0F3;display:flex;align-items:center;padding:0 18px;font:600 18px ${FONT};color:#5B6472">🔍&nbsp; Where to?</div></div>`
          : `<div style="position:absolute;left:${L.panel.left}px;width:${L.panel.width}px;top:${d.insets.top + 12}px;bottom:${bannerArea + 12}px;background:#fff;border-radius:24px;box-shadow:0 6px 20px rgba(0,0,0,.16);padding:16px;box-sizing:border-box"><div style="height:52px;border-radius:26px;background:#EEF0F3;display:flex;align-items:center;padding:0 18px;font:600 18px ${FONT};color:#5B6472">🔍&nbsp; Where to?</div><div style="font:700 15px ${FONT};color:#6B7078;margin:18px 4px 8px">Recent</div><div style="font:500 16px ${FONT};color:#1F2125;padding:10px 4px;border-bottom:1px solid #E6E8EB">Home</div><div style="font:500 16px ${FONT};color:#1F2125;padding:10px 4px;border-bottom:1px solid #E6E8EB">Work</div></div>`;
      const ad = `<div style="position:absolute;left:0;right:0;bottom:0;height:${bannerArea}px;background:#F4F5F7;border-top:1px solid #DADDE2"><div style="height:${banner}px;display:flex;align-items:center;justify-content:center;font:600 12px ${FONT};color:#6B7078">Ad slot · full width · ${banner} pt (adaptive banner's own height, max 60)</div></div>`;
      await shoot({
        name: d.name,
        scheme: "light",
        width: d.w,
        height: d.h,
        camera: { center: ll(here), zoom, pitch, bearing: 0, padding },
        driver: { at: ll(here), heading: 70 },
        measureRoad: true,
        overlay: statusBar(d.w, d.insets.top || 20, false) + panel + ad + caption(`${L.kind} ${d.w}×${d.h} · home zoom ${HOME_FOLLOW_ZOOM} (Mapbox ${zoom}) · ${pitch}° · sheet ${L.panel.side === "bottom" ? "along the bottom" : `as a ${L.panel.width} pt left panel`} · map ${d.w}×${mapH} above the ad · drawn`, (d.insets.top || 20) + 12, d.w),
      });
      notes[`${d.name}-layout`] = { kind: L.kind, panel: L.panel, mapPadding: padding, bannerSlot: banner, bannerArea };
    }
  }

  // ======== 5. Navigation: no overlaps -- following and FREE (Re-centre right column above Report)
  {
    const W = 390, H = 844, SAFE_TOP = 47, SAFE_BOTTOM = 34;
    const geo = buildRouteGeometry(recorded.steps, recorded.line);
    const stepIdx = recorded.steps.findIndex((s: { maneuver?: string; targetStreetName?: string }) => s.maneuver === "turn-right" && s.targetStreetName === "St Hilliers Road");
    const step = recorded.steps[stepIdx];
    const turnAlong = geo.stepEnds[stepIdx - 1];
    const along = turnAlong - 150;
    const here = pointAt(geo, along);
    const heading = routeBearingAt(geo, along) ?? 0;
    const speed = 50;
    const zoom = mapboxZoomFromGoogle(navZoomForSpeed(speed, H, here.latitude));
    const side = calloutSide(step.maneuver, step.drivingSide ?? "left");
    const anchor = calloutAnchor(side);
    const pillW = 128, pillH = 28, tailW = CALLOUT_TAIL * 1.4;
    const totalW = pillW + CALLOUT_TAIL + 2;
    const tail = `<div style="width:${tailW}px;height:${tailW}px;background:#3B0764;transform:rotate(45deg);margin:${side === "left" ? `0 0 0 -${tailW / 2}px` : `0 -${tailW / 2}px 0 0`}"></div>`;
    const pill = `<div style="height:${pillH}px;padding:0 10px;border-radius:999px;background:#3B0764;border:1px solid rgba(255,255,255,.25);display:flex;align-items:center;font:700 12px ${FONT};color:#fff;white-space:nowrap">${step.targetStreetName}</div>`;
    const callout = { at: ll(step.startLocation), html: `<div style="display:flex;align-items:center;width:${totalW}px;justify-content:${side === "left" ? "flex-end" : "flex-start"}">${side === "left" ? pill + tail : tail + pill}</div>`, ax: -anchor.x * totalW, ay: -anchor.y * pillH };
    const fb = (f: Frame, inner: string, bg = "#2A2C30", radius = "50%") => `<div style="position:absolute;left:${f.x}px;top:${f.y}px;width:${f.width}px;height:${f.height}px;border-radius:${radius};background:${bg};box-shadow:0 3px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center">${inner}</div>`;
    for (const free of [false, true]) {
      const frames = navControlFrames({ width: W, height: H, safeTop: SAFE_TOP, safeBottom: SAFE_BOTTOM, bottomBarHeight: 110, topBarHeight: TOP_BAR_H, showSpeedLimit: true, showRecenter: free, showCompass: true, showSound: true, showVoice: true, showStreetChip: true, showInfoBanner: false });
      let html = "";
      html += fb(frames.compass!, `<svg width="30" height="30" viewBox="0 0 24 24"><path d="M12 3l3 9h-6z" fill="#E5484D"/><path d="M12 21l-3-9h6z" fill="#fff"/></svg>`);
      html += fb(frames.sound!, `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#fff"/></svg>`);
      html += fb(frames.voice!, `<svg width="22" height="22" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="#fff"/><path d="M6 11a6 6 0 0012 0M12 17v4" stroke="#fff" stroke-width="2" fill="none"/></svg>`);
      html += fb(frames.speedometer!, `<div style="text-align:center;color:#1F2125"><div style="font:800 24px ${FONT}">48</div><div style="font:600 11px ${FONT}">km/h</div></div>`, "#fff");
      html += fb(frames.speedLimit!, `<div style="width:84%;height:84%;border-radius:50%;border:5px solid #E5484D;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font:800 18px ${FONT};color:#1F2125">50</div>`, "#fff");
      html += fb(frames.report!, `<svg width="30" height="30" viewBox="0 0 48 48"><path d="M24 7 L43 40 L5 40 Z" fill="none" stroke="#000" stroke-width="3.5" stroke-linejoin="round"/><path d="M24 20v14M17 27h14" stroke="#000" stroke-width="3.5" stroke-linecap="round"/></svg>`, "#FFC800", "16px");
      if (frames.streetChip) html += fb(frames.streetChip, `<span style="font:600 15px ${FONT};color:#fff">Rawson St</span>`, "rgba(28,29,32,.92)", "16px");
      if (free && frames.recenter) html += fb(frames.recenter, `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 11l18-8-8 18-2-8z" fill="#0062B8"/></svg>`, "#fff");
      notes[`5-nav-${free ? "free" : "following"}-frames`] = { overlaps: overlaps(frames), recenter: frames.recenter ?? null, report: frames.report };
      await shoot({
        name: `5-nav-${free ? "free" : "following"}`,
        scheme: "light",
        width: W,
        height: H,
        camera: free ? { center: ll(here), zoom: zoom - 0.6, pitch: 30, bearing: heading + 25, padding: navFollowPadding(H) } : { center: ll(here), zoom, pitch: NAV_FOLLOW_PITCH, bearing: heading, padding: navFollowPadding(H) },
        routes: [{ line: geo.points.map(ll), selected: true }],
        driver: { at: ll(here), heading },
        pins: [callout],
        overlay:
          topBar(W, SAFE_TOP, "150 m", step.targetStreetName, turnRight(60)) +
          html +
          etaBar(W, SAFE_BOTTOM, "10:12 am", "21 min • 15.2 km") +
          caption(
            free
              ? `Panned (FREE): round Re-centre in the right column above Report · no "End suggested route" pill (now in the options sheet) · ${overlaps(frames).length} overlaps · drawn`
              : `Following: callout "${step.targetStreetName}" beside the turn on its outside (${side}), tail to the corner · route = one fill + one casing, no white stripe · no own Tracky · ${overlaps(frames).length} overlaps · drawn`,
            SAFE_TOP + TOP_BAR_H + 12,
            W
          ),
      });
    }
  }

  writeFileSync(`${OUT}/shots.json`, JSON.stringify(notes, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
