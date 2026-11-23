// Permanent fix §7 proof frames for docs/permanent-fix. There is no iOS simulator on the build
// machine (Linux), so this renders the app's real map styles (src/map-v2/styles/*.json) with real
// Mapbox tiles in headless Chromium (Mapbox GL JS), drives the camera with the app's OWN
// CameraController / navCamera / previewCamera / layout code, draws the driver with the app's own
// arrow image, and places the controls at the frames the app's layout functions compute. Every
// number in shots.json is measured from the rendered map (map.project), not assumed.
//
// Run: MAPBOX_TOKEN_FILE=<file with a pk. token> MAPBOX_GL_DIR=<dir with mapbox-gl installed> \
//        npx tsx scripts/permanent-fix-proof.ts
// The token is read from the file and never printed.
/* global mapboxgl */
import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { CameraController, type CameraMode } from "../src/map-v2/cameraController";
import { mapboxZoomFromGoogle } from "../src/map-v2/geo";
import { HOME_FOLLOW_ZOOM, homeArrowTargetY, homeControlFrames, homeMapPadding, type HomeFrame } from "../src/map/homeMapLogic";
import { NAV_ARROW_FRACTION, NAV_FOLLOW_PITCH, navFollowPadding, navStartBearing } from "../src/nav/navCamera";
import { aheadRoom, navControlFrames, overlaps, type Frame } from "../src/nav/navControlsLayout";
import { allVisible, previewEdgePadding, previewFitCoordinates, projectFitted, boundsOf } from "../src/nav/previewCamera";
import { speedZoomFor } from "../src/map/speedZoom";
import { SURFACES } from "../src/theme/colors";
// = BANNER_HEIGHT in src/components/BannerAdBar.tsx (that module imports react-native, so not here;
// __tests__/presses/homeScreen.test.tsx pins it at 50).
const BANNER_HEIGHT = 50;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright");

declare const mapboxgl: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const OUT = "docs/permanent-fix";
const W = 390;
const H = 844;
const SAFE_TOP = 47;
const SAFE_BOTTOM = 34;
const token = readFileSync(process.env.MAPBOX_TOKEN_FILE!, "utf8").trim();
const gl = path.join(process.env.MAPBOX_GL_DIR!, "node_modules/mapbox-gl/dist");
const lib = readFileSync(path.join(gl, "mapbox-gl.js"), "utf8");
const css = readFileSync(path.join(gl, "mapbox-gl.css"), "utf8");
const arrowPng = "data:image/png;base64," + readFileSync("assets/map/user-arrow@3x.png").toString("base64");

type LngLat = [number, number];
interface Cam {
  center: LngLat;
  zoom: number; // Mapbox scale
  pitch: number;
  bearing: number;
  padding?: { top: number; bottom: number; left: number; right: number };
}
interface Scene {
  name: string;
  scheme: "light" | "dark";
  camera?: Cam;
  fit?: { coords: LngLat[]; padding: { top: number; bottom: number; left: number; right: number } };
  driver: { at: LngLat; heading: number };
  routes?: { line: LngLat[]; selected: boolean; label?: string }[];
  overlay: string; // HTML drawn over the map (the app's controls at their computed frames)
  measure?: { points: LngLat[]; free: { top: number; bottom: number; left: number; right: number } };
}

const ll = (p: { latitude: number; longitude: number }): LngLat => [p.longitude, p.latitude];
const toLatLng = ([lng, lat]: LngLat) => ({ latitude: lat, longitude: lng });

// ---- the app's controls, drawn at their frames ----
const btn = (f: HomeFrame | Frame, bg: string, inner: string, radius = "50%") =>
  `<div style="position:absolute;left:${f.x}px;top:${f.y}px;width:${f.width}px;height:${f.height}px;border-radius:${radius};background:${bg};box-shadow:0 3px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;color:#fff;font:600 13px -apple-system,Helvetica,Arial">${inner}</div>`;
const ICON = {
  menu: `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  compass: `<svg width="30" height="30" viewBox="0 0 24 24"><path d="M12 3l3 9h-6z" fill="#E5484D"/><path d="M12 21l-3-9h6z" fill="#fff"/></svg>`,
  sound: `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#fff"/><path d="M16 8a5 5 0 010 8M18.5 5.5a8.5 8.5 0 010 13" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  mic: `<svg width="24" height="24" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="#fff"/><path d="M6 11a6 6 0 0012 0M12 17v4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  report: `<svg width="30" height="30" viewBox="0 0 24 24"><path d="M5 18V6a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 3z" fill="#1A1A1A"/><path d="M12 7v4M12 13.2v.1" stroke="#FFD400" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  recenter: `<svg width="26" height="26" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" stroke="#fff" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="2.4" fill="#fff"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
};
const MAP_BTN = "#2A2C30";
const REPORT_YELLOW = "#FFD400";
const tag = (text: string, y: number) =>
  `<div style="position:absolute;left:50%;top:${y}px;transform:translateX(-50%);background:rgba(17,17,17,.82);color:#fff;font:600 12px -apple-system,Helvetica,Arial;padding:6px 10px;border-radius:10px;white-space:nowrap">${text}</div>`;

function homeOverlay(scheme: "light" | "dark", showRecenter: boolean, label: string, withBanner = true): string {
  const sheetPeek = 150;
  const banner = withBanner ? BANNER_HEIGHT + SAFE_BOTTOM : SAFE_BOTTOM;
  const f = homeControlFrames({ width: W, height: H - banner, topInset: SAFE_TOP, scale: 1, sheetVisibleHeight: sheetPeek, bottomInset: 0, showCompass: true, showAudioPlayer: false, showSound: true, showRecenter, showStreetPill: !showRecenter });
  const s = SURFACES[scheme];
  let html = "";
  html += btn(f.menu!, MAP_BTN, ICON.menu, "16px") + btn(f.compass!, MAP_BTN, ICON.compass) + btn(f.sound!, MAP_BTN, ICON.sound);
  html += btn(f.report!, REPORT_YELLOW, ICON.report, "16px");
  if (f.recenter) html += btn(f.recenter, MAP_BTN, ICON.recenter);
  if (f.streetPill) html += `<div style="position:absolute;left:${f.streetPill.x}px;top:${f.streetPill.y + 8}px;width:${f.streetPill.width}px;height:40px;border-radius:20px;background:${s.sheet};box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;font:600 17px -apple-system,Helvetica,Arial;color:${s.text}">Stacey St</div>`;
  // The "Where to?" sheet peek, then the ad bar under it (the same colour, full width).
  html += `<div style="position:absolute;left:0;right:0;bottom:${banner}px;height:${sheetPeek}px;background:${s.sheet};border-radius:20px 20px 0 0;box-shadow:0 -4px 14px rgba(0,0,0,.12)"><div style="width:40px;height:5px;border-radius:3px;background:${s.divider};margin:8px auto"></div><div style="margin:8px 16px;height:48px;border-radius:14px;background:${s.muted};display:flex;align-items:center;padding-left:16px;font:500 17px -apple-system,Helvetica,Arial;color:${s.textMuted}">Where to?</div></div>`;
  if (withBanner) html += `<div style="position:absolute;left:0;right:0;bottom:0;height:${banner}px;background:${s.sheet}"><div style="height:${BANNER_HEIGHT}px;width:100%;display:flex;align-items:center;justify-content:center;border-top:1px solid ${s.divider};font:500 11px -apple-system,Helvetica,Arial;color:${s.textMuted}">ad slot · full width × ${BANNER_HEIGHT} pt (no side bars)</div></div>`;
  // The caption sits in the sheet, under "Where to?", so it never covers the map or a control.
  return html + tag(label, H - banner - sheetPeek + 92);
}

function navOverlay(scheme: "light" | "dark", opts: { recenter: boolean; aheadBanner: boolean; speedLimit: number | null; label: string }): { html: string; frames: ReturnType<typeof navControlFrames> } {
  const topBar = 118;
  const bottomBar = 96;
  const bannerH = 88;
  const frames = navControlFrames({ width: W, height: H, safeTop: SAFE_TOP, safeBottom: SAFE_BOTTOM, bottomBarHeight: bottomBar, topBarHeight: topBar, showSpeedLimit: !!opts.speedLimit, showRecenter: opts.recenter, showCompass: true, showSound: true, showVoice: true, showInfoBanner: false, dropBy: opts.aheadBanner ? aheadRoom(bannerH) : 0, aheadBanner: opts.aheadBanner ? { height: bannerH, progress: 1 } : null });
  const s = SURFACES[scheme];
  let html = `<div style="position:absolute;left:0;right:0;top:0;height:${SAFE_TOP + topBar}px;background:#111;color:#fff;font:-apple-system,Helvetica,Arial"><div style="position:absolute;left:18px;top:${SAFE_TOP + 14}px;font:700 30px -apple-system,Helvetica,Arial">250 m</div><div style="position:absolute;left:18px;top:${SAFE_TOP + 56}px;font:600 20px -apple-system,Helvetica,Arial;color:#3DD6F5">Turn right onto Hume Hwy</div></div>`;
  if (opts.aheadBanner) html += `<div style="position:absolute;left:12px;right:12px;top:${SAFE_TOP + topBar + 12}px;height:${bannerH}px;border-radius:16px;background:${s.sheet};box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;gap:12px;padding:0 14px;font:600 16px -apple-system,Helvetica,Arial;color:${s.text}"><div style="width:44px;height:44px;border-radius:22px;background:#E5484D"></div><div>Hazard reported ahead<br><span style="font-weight:500;color:${s.textMuted};font-size:14px">800 m · on your route</span></div></div>`;
  if (frames.compass) html += btn(frames.compass, MAP_BTN, ICON.compass);
  if (frames.sound) html += btn(frames.sound, MAP_BTN, ICON.sound);
  if (frames.voice) html += btn(frames.voice, MAP_BTN, ICON.mic);
  if (frames.speedLimit && opts.speedLimit) html += `<div style="position:absolute;left:${frames.speedLimit.x}px;top:${frames.speedLimit.y}px;width:${frames.speedLimit.width}px;height:${frames.speedLimit.height}px;border-radius:50%;background:#fff;border:6px solid #D7263D;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font:800 20px -apple-system,Helvetica,Arial;color:#111">${opts.speedLimit}</div>`;
  html += `<div style="position:absolute;left:${frames.speedometer!.x}px;top:${frames.speedometer!.y}px;width:${frames.speedometer!.width}px;height:${frames.speedometer!.height}px;border-radius:50%;background:${s.sheet};box-shadow:0 3px 10px rgba(0,0,0,.25);display:flex;flex-direction:column;align-items:center;justify-content:center;font:800 28px -apple-system,Helvetica,Arial;color:${s.text}">52<span style="font:600 11px -apple-system,Helvetica,Arial;color:${s.textMuted}">km/h</span></div>`;
  html += btn(frames.report!, REPORT_YELLOW, ICON.report, "16px");
  if (frames.recenter) html += btn(frames.recenter, MAP_BTN, ICON.recenter);
  html += `<div style="position:absolute;left:0;right:0;bottom:0;height:${bottomBar + SAFE_BOTTOM}px;background:${s.sheet};border-radius:20px 20px 0 0;box-shadow:0 -4px 14px rgba(0,0,0,.12);display:flex;justify-content:center;gap:28px;padding-top:18px;font:700 22px -apple-system,Helvetica,Arial;color:${s.text}"><span>10:42</span><span style="color:${s.textMuted};font-weight:500">14 min · 9.6 km</span></div>`;
  return { html: html + tag(opts.label, H - SAFE_BOTTOM - 30), frames };
}

// ---- real routes (Mapbox Directions, the same provider the app navigates on) ----
async function routes(): Promise<{ line: LngLat[]; minutes: number }[]> {
  const from: LngLat = [151.0345, -33.9175]; // Stacey St, Bankstown
  const to: LngLat = [151.104, -33.877]; // Burwood
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from.join(",")};${to.join(",")}?alternatives=true&geometries=geojson&overview=full&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);
  const json = (await res.json()) as { routes: { geometry: { coordinates: LngLat[] }; duration: number }[] };
  return json.routes.map((r) => ({ line: r.geometry.coordinates, minutes: Math.round(r.duration / 60) }));
}

async function render(page: any, scene: Scene) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const style = JSON.parse(readFileSync(`src/map-v2/styles/trackline-${scene.scheme}.json`, "utf8"));
  await page.setContent(`<html><head><style>${css} body{margin:0;overflow:hidden} #m{width:${W}px;height:${H}px} #o{position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none}</style></head><body><div id="m"></div><div id="o">${scene.overlay}</div><script>${lib}</script></body></html>`);
  return page.evaluate(
    async ({ token, style, scene, arrowPng }: { token: string; style: unknown; scene: Scene; arrowPng: string }) => {
      mapboxgl.accessToken = token;
      const cam = scene.camera;
      const map = new mapboxgl.Map({ container: "m", style, center: cam?.center ?? scene.driver.at, zoom: cam?.zoom ?? 14, pitch: cam?.pitch ?? 0, bearing: cam?.bearing ?? 0, preserveDrawingBuffer: true, attributionControl: true });
      await new Promise((r) => map.on("load", r));
      const img = new Image();
      img.src = arrowPng;
      await img.decode();
      map.addImage("user-arrow", img, { pixelRatio: 3 });
      (scene.routes ?? []).forEach((r, i) => {
        map.addSource(`route-${i}`, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.line } } });
        map.addLayer({ id: `route-casing-${i}`, type: "line", source: `route-${i}`, paint: { "line-color": r.selected ? "#5B21B6" : "#6B7280", "line-width": r.selected ? 11 : 9 }, layout: { "line-cap": "round", "line-join": "round" } }, "road-label-service");
        map.addLayer({ id: `route-${i}`, type: "line", source: `route-${i}`, paint: { "line-color": r.selected ? "#8A3FFC" : "#B8BEC8", "line-width": r.selected ? 7 : 6 }, layout: { "line-cap": "round", "line-join": "round" } }, "road-label-service");
      });
      // Selected route on top.
      (scene.routes ?? []).forEach((r, i) => { if (r.selected) { map.moveLayer(`route-casing-${i}`, "road-label-service"); map.moveLayer(`route-${i}`, "road-label-service"); } });
      map.addSource("me", { type: "geojson", data: { type: "Feature", properties: { heading: scene.driver.heading }, geometry: { type: "Point", coordinates: scene.driver.at } } });
      map.addLayer({ id: "me-arrow", type: "symbol", source: "me", layout: { "icon-image": "user-arrow", "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-allow-overlap": true, "icon-size": 1 } });
      if (scene.fit) map.fitBounds(scene.fit.coords.reduce((b: any, c: [number, number]) => b.extend(c), new mapboxgl.LngLatBounds(scene.fit.coords[0], scene.fit.coords[0])), { padding: scene.fit.padding, duration: 0, bearing: 0, pitch: 0 }); // eslint-disable-line @typescript-eslint/no-explicit-any
      else if (cam?.padding) map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, padding: cam.padding });
      // Bubbles (route preview): at each route's middle point, measured on the rendered map.
      (scene.routes ?? []).forEach((r) => {
        if (!r.label) return;
        const mid = r.line[Math.floor(r.line.length * (r.selected ? 0.45 : 0.6))];
        const p = map.project(mid);
        const d = document.createElement("div");
        d.style.cssText = `position:absolute;left:${p.x - 40}px;top:${p.y - 44}px;padding:6px 10px;border-radius:12px;background:${r.selected ? "#8A3FFC" : "#fff"};color:${r.selected ? "#fff" : "#111"};font:700 14px -apple-system,Helvetica,Arial;box-shadow:0 2px 8px rgba(0,0,0,.25)`;
        d.textContent = r.label;
        document.getElementById("o")!.appendChild(d);
      });
      await new Promise((r) => { map.once("idle", r); setTimeout(r, 25000); });
      const me = map.project(scene.driver.at);
      let inside: boolean | null = null;
      if (scene.measure) {
        const f = scene.measure.free;
        inside = scene.measure.points.every((c) => { const p = map.project(c); return p.x >= f.left - 1 && p.x <= 390 - f.right + 1 && p.y >= f.top - 1 && p.y <= 844 - f.bottom + 1; });
      }
      return { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), arrowY: me.y, arrowX: me.x, inside, features: map.queryRenderedFeatures().length };
    },
    { token, style: JSON.parse(JSON.stringify(style)), scene, arrowPng }
  );
}

// The home camera's padding, as MapScreen computes it (sheet peek 150 + the ad bar under it).
const HOME_PAD = (() => {
  const banner = BANNER_HEIGHT + SAFE_BOTTOM;
  const p = homeMapPadding(H - banner, 150, H, homeArrowTargetY(H - banner, 150, 1));
  return { ...p, bottom: p.bottom + banner };
})();

(async () => {
  mkdirSync(OUT, { recursive: true });
  const rs = await routes();
  const home: LngLat = [151.0345, -33.9175];
  const homeZoom = mapboxZoomFromGoogle(HOME_FOLLOW_ZOOM);
  const scenes: Scene[] = [];
  const notes: Record<string, unknown> = {};

  // 1. Home map, light and dark: FOLLOW, heading-up, pitch 45, the banner showing.
  for (const scheme of ["light", "dark"] as const) {
    scenes.push({ name: `home-${scheme}`, scheme, camera: { center: home, zoom: homeZoom, pitch: 45, bearing: 20, padding: HOME_PAD }, driver: { at: home, heading: 20 }, overlay: homeOverlay(scheme, false, `Home · FOLLOW · ${scheme}`) });
  }

  // 2. Pinch-out on the home map, run through the real CameraController for 60 s of fixes.
  {
    const cam = { zoom: HOME_FOLLOW_ZOOM, center: { latitude: home[1], longitude: home[0] }, pitch: 45, heading: 20 };
    const target = {
      animateCamera: (c: Partial<typeof cam>) => Object.assign(cam, c),
      animateToRegion: () => undefined,
      fitToCoordinates: () => undefined,
    };
    const camera = new CameraController({ current: target });
    const states: { t: number; mode: CameraMode; zoom: number; at: LngLat }[] = [];
    const road = rs[0].line;
    cam.zoom = 13; // the driver's pinch (the map does it)
    camera.gesture(0);
    let moved = 0;
    for (let t = 0; t <= 60; t++) {
      const at = road[Math.min(road.length - 1, t * 2)];
      if (camera.move("follow", { center: toLatLng(at), zoom: HOME_FOLLOW_ZOOM, heading: 20 }, { duration: 500 })) moved++;
      if (camera.move("follow", { pitch: 45 }, { duration: 600 })) moved++; // the 3D tilt
      if (t % 15 === 0) states.push({ t, mode: camera.state, zoom: cam.zoom, at });
    }
    notes.pinch = { cameraMovesAllowedIn60s: moved, zoomAfter60s: cam.zoom, states };
    for (const s of states) {
      scenes.push({ name: `pinch-out-t${String(s.t).padStart(2, "0")}s`, scheme: "light", camera: { center: ll(cam.center), zoom: mapboxZoomFromGoogle(cam.zoom), pitch: 45, bearing: 20, padding: HOME_PAD }, driver: { at: s.at, heading: 20 }, overlay: homeOverlay("light", true, `Pinched out · ${s.mode} · t = ${s.t} s · zoom held`) });
    }
    // 3. Recentre: back to FOLLOW, the camera on you at street zoom, the button gone.
    camera.recentre();
    const last = states[states.length - 1].at;
    camera.move("recentre", { center: toLatLng(last), zoom: HOME_FOLLOW_ZOOM, pitch: 45, heading: 20 }, { duration: 600 });
    notes.recentre = { mode: camera.state, zoom: cam.zoom };
    scenes.push({ name: "recentre-after", scheme: "light", camera: { center: last, zoom: mapboxZoomFromGoogle(cam.zoom), pitch: 45, bearing: 20, padding: HOME_PAD }, driver: { at: last, heading: 20 }, overlay: homeOverlay("light", false, `Recentre → ${camera.state} · zoom ${cam.zoom}`) });
  }

  // 4. Route preview: every route + start + destination inside the free area, both sheet heights.
  const topCardBottom = SAFE_TOP + 132;
  for (const [label, sheetHeight] of [["collapsed", 300], ["pulled-up", Math.round(H * 0.55)]] as const) {
    const lines = rs.map((r) => r.line.map(toLatLng));
    const coords = previewFitCoordinates(lines, toLatLng(rs[0].line[0]), toLatLng(rs[0].line[rs[0].line.length - 1]));
    const padding = previewEdgePadding(topCardBottom, sheetHeight);
    const modelOk = allVisible(projectFitted(coords, boundsOf(coords)!, { width: W, height: H }, padding), { width: W, height: H }, padding);
    const s = SURFACES.light;
    const overlay =
      `<div style="position:absolute;left:12px;right:12px;top:${SAFE_TOP + 8}px;height:${topCardBottom - SAFE_TOP - 16}px;border-radius:16px;background:${s.sheet};box-shadow:0 3px 12px rgba(0,0,0,.18);padding:14px 16px;box-sizing:border-box;font:600 16px -apple-system,Helvetica,Arial;color:${s.text}">Stacey St, Bankstown<br><span style="color:${s.textMuted};font-weight:500">to Burwood</span><div style="display:flex;gap:8px;margin-top:12px">${["Drive", "Avoid"].map((t) => `<span style="padding:6px 12px;border-radius:14px;background:${s.muted};font-size:13px">${t}</span>`).join("")}</div></div>` +
      `<div style="position:absolute;left:0;right:0;bottom:0;height:${sheetHeight}px;background:${s.sheet};border-radius:20px 20px 0 0;box-shadow:0 -4px 14px rgba(0,0,0,.12);padding:18px;box-sizing:border-box;font:700 20px -apple-system,Helvetica,Arial;color:${s.text}">${rs[0].minutes} min<div style="margin-top:12px;height:50px;border-radius:14px;background:#8A3FFC;color:#fff;display:flex;align-items:center;justify-content:center">Go now</div></div>` +
      tag(`ROUTE_PREVIEW · flat, north-up · sheet ${label}`, H - sheetHeight + 110);
    scenes.push({
      name: `route-preview-${label}`,
      scheme: "light",
      fit: { coords: coords.map(ll), padding },
      driver: { at: rs[0].line[0], heading: 0 },
      routes: rs.map((r, i) => ({ line: r.line, selected: i === 0, label: `${r.minutes} min` })),
      overlay,
      measure: { points: coords.map(ll), free: padding },
    });
    notes[`preview-${label}`] = { padding, modelSaysAllVisible: modelOk };
  }

  // 5. Navigation, facing the road from the first second (parked: no GPS course yet).
  const route = rs[0].line.map(toLatLng);
  const start = route[0];
  const startBearing = navStartBearing(route, start)!;
  const navPad = navFollowPadding(H);
  notes.nav = { startBearing, firstSegmentFrom: rs[0].line[0], arrowFractionTarget: NAV_ARROW_FRACTION };
  for (const scheme of ["light", "dark"] as const) {
    const o = navOverlay(scheme, { recenter: false, aheadBanner: false, speedLimit: 60, label: `NAV_FOLLOW · bearing ${Math.round(startBearing)}° (first segment) · pitch ${NAV_FOLLOW_PITCH}` });
    scenes.push({ name: `nav-facing-road-${scheme}`, scheme, camera: { center: ll(start), zoom: mapboxZoomFromGoogle(speedZoomFor(0)), pitch: NAV_FOLLOW_PITCH, bearing: startBearing, padding: navPad }, driver: { at: ll(start), heading: startBearing }, routes: [{ line: rs[0].line, selected: true }], overlay: o.html });
  }

  // 6. Controls with the ahead banner showing (and Re-centre in FREE), measured for overlaps.
  for (const recenter of [false, true]) {
    const o = navOverlay("light", { recenter, aheadBanner: true, speedLimit: 60, label: recenter ? "FREE while driving · Re-centre above Report" : "Ahead banner down · nothing overlaps" });
    notes[`controls-banner-recentre-${recenter}`] = { overlaps: overlaps(o.frames) };
    scenes.push({ name: `controls-banner${recenter ? "-recentre" : ""}`, scheme: "light", camera: { center: ll(start), zoom: mapboxZoomFromGoogle(speedZoomFor(50)), pitch: NAV_FOLLOW_PITCH, bearing: startBearing, padding: navPad }, driver: { at: ll(start), heading: startBearing }, routes: [{ line: rs[0].line, selected: true }], overlay: o.html });
  }
  scenes.push({ name: "home-recentre-free", scheme: "dark", camera: { center: [151.05, -33.905], zoom: 13, pitch: 45, bearing: 0, padding: HOME_PAD }, driver: { at: home, heading: 20 }, overlay: homeOverlay("dark", true, "Home · FREE · Re-centre above Report · banner showing") });

  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  page.on("pageerror", (e: Error) => console.log("pageerror", String(e).slice(0, 200)));
  const shots: Record<string, unknown>[] = [];
  for (const scene of scenes) {
    const m = await render(page, scene);
    await page.screenshot({ path: path.join(OUT, `${scene.name}.png`) });
    const row = { name: `${scene.name}.png`, scheme: scene.scheme, ...m, arrowYFraction: +(m.arrowY / H).toFixed(3), takenAt: new Date().toISOString() };
    shots.push(row);
    console.log(scene.name, JSON.stringify({ zoom: +m.zoom.toFixed(2), pitch: m.pitch, bearing: +m.bearing.toFixed(1), arrowYFraction: row.arrowYFraction, inside: m.inside, features: m.features }));
  }
  await browser.close();
  writeFileSync(path.join(OUT, "shots.json"), JSON.stringify({ notes, shots }, null, 2));
  // The pinch-out "recording": the 60 s run as a short clip (one frame per 15 s, then Recentre).
  try {
    const list = ["pinch-out-t00s", "pinch-out-t15s", "pinch-out-t30s", "pinch-out-t45s", "pinch-out-t60s", "recentre-after"].map((n) => `file '${path.resolve(OUT, n + ".png")}'\nduration 1`).join("\n");
    const listFile = path.join(tmpdir(), "pf-list.txt");
    writeFileSync(listFile, list + `\nfile '${path.resolve(OUT, "recentre-after.png")}'\n`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "scale=390:-2,format=yuv420p", "-r", "10", path.join(OUT, "pinch-out-then-recentre.mp4")]);
  } catch (e) {
    console.log("clip skipped:", String(e).slice(0, 120));
  }
})();
