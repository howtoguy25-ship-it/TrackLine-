// Proof renders for docs/fix-pass-5. No iOS simulator on the build machine (Linux), so -- like
// scripts/waze-match-proof.ts -- this draws the app's real map style with real Mapbox tiles in
// headless Chromium, with REAL routes (Mapbox Directions, live) and the recorded route the tests
// use, and puts the app's screens on top as HTML built from the app's own maths: the preview fit
// (previewFitLines / previewEdgePadding), the bubble solver (layoutRouteBubbles), the driving
// camera (navZoomForSpeed / navFollowPadding), the control frames (navControlFrames), the
// roundabout drawing (roundaboutDrawing), the directions rows (directionsRows) and the sheet
// heights + chart (optionsSheetHeights / leaveChartBars). Every image says "drawn" -- they are
// drawings of the React Native screens on real map tiles, not phone screenshots.
//
// Run: MAPBOX_TOKEN_FILE=<file with a pk. token> MAPBOX_GL_DIR=<dir with mapbox-gl installed> \
//        npx tsx scripts/fix-pass-5-proof.ts
// The token is read from the file and never printed.
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { previewEdgePadding, previewFitCoordinates, previewFitLines } from "../src/nav/previewCamera";
import { bubbleBody, layoutRouteBubbles, timeDifferenceText, type BubbleSide } from "../src/map/bubbleLayout";
import { mapboxZoomFromGoogle } from "../src/map-v2/geo";
import { NAV_ARROW_FRACTION, NAV_FOLLOW_PITCH, metresAheadVisible, navFollowPadding, navZoomForSpeed } from "../src/nav/navCamera";
import { navControlFrames, overlaps, type Frame } from "../src/nav/navControlsLayout";
import { roundaboutDrawing, roundaboutExitAngle, roundaboutGeometryFor } from "../src/nav/roundabout";
import { directionsRows } from "../src/nav/directionsRows";
import { extractRoundaboutExitNumber } from "../src/utils/navFormat";
import { leaveChartBars, optionsSheetHeights, LEAVE_ERROR_TEXT } from "../src/travel/etaSheet";
import { routeColoursFor } from "../src/map-v2/styles/mapAppearance";
import { SURFACES, BLUE, GREEN_TEXT } from "../src/theme/colors";
import type { LatLng } from "../src/utils/polyline";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright");

declare const mapboxgl: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const W = 390;
const H = 844;
const SAFE_TOP = 47;
const SAFE_BOTTOM = 34;
const FONT = "-apple-system,Helvetica,Arial";
const OUT = "docs/fix-pass-5";
const token = readFileSync(process.env.MAPBOX_TOKEN_FILE!, "utf8").trim();
const gl = path.join(process.env.MAPBOX_GL_DIR!, "node_modules/mapbox-gl/dist");
const lib = readFileSync(path.join(gl, "mapbox-gl.js"), "utf8");
const css = readFileSync(path.join(gl, "mapbox-gl.css"), "utf8");
const arrowPng = "data:image/png;base64," + readFileSync("assets/map/user-arrow@3x.png").toString("base64");
const recorded = JSON.parse(readFileSync(`${OUT}/recorded-route.json`, "utf8"));

type LngLat = [number, number];
type Pad = { top: number; bottom: number; left: number; right: number };
const ll = (p: LatLng): LngLat => [p.longitude, p.latitude];
const lat = (p: LngLat): LatLng => ({ latitude: p[1], longitude: p[0] });
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const fmtKm = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

interface Shot {
  name: string;
  scheme: "light" | "dark";
  camera?: { center: LngLat; zoom: number; pitch: number; bearing: number; padding?: Pad };
  fit?: { coords: LngLat[]; padding: Pad };
  routes?: { line: LngLat[]; selected: boolean }[];
  driver?: { at: LngLat; heading: number; dot?: boolean };
  flag?: LngLat;
  pins?: { at: LngLat; html: string; ax: number; ay: number }[];
  overlay: string;
  noMap?: boolean;
  width?: number;
  height?: number;
  measure?: { points: LngLat[]; free: Pad };
}

const caption = (text: string, y: number, w = W) =>
  `<div style="position:absolute;left:${w / 2}px;top:${y}px;transform:translateX(-50%);background:rgba(17,17,17,.82);color:#fff;font:600 11px ${FONT};padding:5px 9px;border-radius:9px;max-width:${Math.min(360, w - 20)}px;text-align:center;z-index:9">${text}</div>`;

// ---------------------------------------------------------------- real routes
async function mapboxRoutes(profile: string, from: LngLat, to: LngLat, departAt?: string): Promise<{ line: LngLat[]; seconds: number; metres: number }[]> {
  const extra = departAt ? `&depart_at=${encodeURIComponent(departAt)}` : "";
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${from.join(",")};${to.join(",")}?alternatives=true&geometries=geojson&overview=full${extra}&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions ${profile} HTTP ${res.status}`);
  const json = (await res.json()) as { routes: { geometry: { coordinates: LngLat[] }; duration: number; distance: number }[] };
  return json.routes.map((r) => ({ line: r.geometry.coordinates, seconds: r.duration, metres: r.distance }));
}

// ---------------------------------------------------------------- renderer
async function render(page: any, shot: Shot) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const w = shot.width ?? W;
  const h = shot.height ?? H;
  const style = shot.noMap ? null : JSON.parse(readFileSync(`src/map-v2/styles/trackline-${shot.scheme}.json`, "utf8"));
  const colours = routeColoursFor(shot.scheme === "dark" ? "dark" : "light", false);
  await page.setViewportSize({ width: w, height: h });
  await page.goto("about:blank");
  await page.setContent(`<html><head><style>${css} body{margin:0;overflow:hidden;background:${shot.noMap ? "#F4F5F7" : shot.scheme === "dark" ? "#1C1D20" : "#fff"}} #m{width:${w}px;height:${h}px} #o{position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none}</style></head><body><script>window.__name=(f)=>f;</script><div id="m"></div><div id="o">${shot.overlay}</div><script>${lib}</script></body></html>`);
  if (shot.noMap) return {};
  return page.evaluate(
    async ({ token, style, shot, arrowPng, colours }: { token: string; style: unknown; shot: Shot; arrowPng: string; colours: { route: string; routeCasing: string; routeAlt: string } }) => {
      mapboxgl.accessToken = token;
      const cam = shot.camera;
      const map = new mapboxgl.Map({ container: "m", style, center: cam?.center ?? shot.fit!.coords[0], zoom: cam?.zoom ?? 13, pitch: cam?.pitch ?? 0, bearing: cam?.bearing ?? 0, preserveDrawingBuffer: true });
      await new Promise((r) => map.on("load", r));
      const arrow = new Image();
      arrow.src = arrowPng;
      await arrow.decode();
      map.addImage("user-arrow", arrow, { pixelRatio: 3 });
      const below = map.getLayer("road-label-service") ? "road-label-service" : undefined;
      const order = [...(shot.routes ?? [])].map((r, i) => ({ r, i })).sort((a, b) => Number(a.r.selected) - Number(b.r.selected));
      for (const { r, i } of order) {
        map.addSource(`route-${i}`, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.line } } });
        if (r.selected) map.addLayer({ id: `casing-${i}`, type: "line", source: `route-${i}`, paint: { "line-color": colours.routeCasing, "line-width": 12 }, layout: { "line-cap": "round", "line-join": "round" } }, below);
        map.addLayer({ id: `route-${i}`, type: "line", source: `route-${i}`, paint: { "line-color": r.selected ? colours.route : colours.routeAlt, "line-width": r.selected ? 8 : 6 }, layout: { "line-cap": "round", "line-join": "round" } }, below);
      }
      if (shot.driver && !shot.driver.dot) {
        map.addSource("me", { type: "geojson", data: { type: "Feature", properties: { heading: shot.driver.heading }, geometry: { type: "Point", coordinates: shot.driver.at } } });
        map.addLayer({ id: "me", type: "symbol", source: "me", layout: { "icon-image": "user-arrow", "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-allow-overlap": true } });
      }
      if (shot.fit) map.fitBounds(shot.fit.coords.reduce((b: any, c: [number, number]) => b.extend(c), new mapboxgl.LngLatBounds(shot.fit.coords[0], shot.fit.coords[0])), { padding: shot.fit.padding, duration: 0, bearing: 0, pitch: 0 }); // eslint-disable-line @typescript-eslint/no-explicit-any
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
      if (shot.driver?.dot) at(shot.driver.at, `<div style="width:40px;height:40px;border-radius:20px;background:rgba(110,116,128,.22);display:flex;align-items:center;justify-content:center"><div style="width:18px;height:18px;border-radius:9px;background:#0098FF;border:3px solid #fff;box-sizing:border-box"></div></div>`, -20, -20);
      if (shot.flag) at(shot.flag, `<svg width="40" height="48" viewBox="0 0 40 48"><path d="M8 46V6" stroke="#1F2125" stroke-width="3"/><path d="M9 6h24v16H9z" fill="#fff" stroke="#1F2125"/><path d="M9 6h6v4H9zM21 6h6v4h-6zM15 10h6v4h-6zM27 10h6v4h-6zM9 14h6v4H9zM21 14h6v4h-6zM15 18h6v4h-6zM27 18h6v4h-6z" fill="#1F2125"/></svg>`, -9, -46);
      for (const p of shot.pins ?? []) at(p.at, p.html, p.ax, p.ay);
      let inside: boolean | null = null;
      if (shot.measure) {
        const f = shot.measure.free;
        inside = shot.measure.points.every((c) => {
          const p = map.project(c);
          return p.x >= f.left - 1 && p.x <= 390 - f.right + 1 && p.y >= f.top - 1 && p.y <= 844 - f.bottom + 1;
        });
      }
      const me = shot.driver ? map.project(shot.driver.at) : null;
      return { zoom: +map.getZoom().toFixed(2), pitch: map.getPitch(), bearing: Math.round(map.getBearing()), inside, arrowFraction: me ? +(me.y / 844).toFixed(3) : null };
    },
    { token, style, shot, arrowPng, colours }
  );
}

// ---------------------------------------------------------------- drawn pieces
/** The time bubble with its tail on `side` (RouteTimeBubble). Positioned so the tail tip is the anchor. */
function bubble(text: string, tag: string | null, selected: boolean, side: BubbleSide, compact: boolean) {
  const kind = compact ? "compact" : selected ? "selected" : "alternative";
  const size = bubbleBody(text, kind);
  const bg = selected ? "#3B0C8C" : "#fff";
  const fg = selected ? "#fff" : "#1F2125";
  const tail =
    side === "above"
      ? `<div style="position:absolute;left:${size.width / 2 - 8}px;top:${size.height}px;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:8px solid ${bg}"></div>`
      : side === "below"
        ? `<div style="position:absolute;left:${size.width / 2 - 8}px;top:-8px;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:8px solid ${bg}"></div>`
        : side === "right"
          ? `<div style="position:absolute;left:-8px;top:${size.height / 2 - 8}px;width:0;height:0;border-top:8px solid transparent;border-bottom:8px solid transparent;border-right:8px solid ${bg}"></div>`
          : `<div style="position:absolute;left:${size.width}px;top:${size.height / 2 - 8}px;width:0;height:0;border-top:8px solid transparent;border-bottom:8px solid transparent;border-left:8px solid ${bg}"></div>`;
  const html = `<div style="position:relative;width:${size.width}px;height:${size.height}px;box-sizing:border-box;border-radius:${compact ? 14 : 14}px;background:${bg};border:${selected ? "none" : "1px solid #DADDE2"};box-shadow:0 2px 6px rgba(0,0,0,.2);display:flex;flex-direction:column;align-items:center;justify-content:center;font:700 ${compact ? 14 : 17}px ${FONT};color:${fg}">${text}${tag && !compact ? `<div style="font:500 13px ${FONT};color:#fff">${tag}</div>` : ""}${tail}</div>`;
  const ax = side === "above" || side === "below" ? -size.width / 2 : side === "right" ? 8 : -size.width - 8;
  const ay = side === "above" ? -size.height - 8 : side === "below" ? 8 : -size.height / 2;
  return { html, ax, ay };
}

function roundaboutSvg(size: number, exit: number | null, angle: number, color: string, dim: string) {
  const d = roundaboutDrawing(angle, "left");
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><circle cx="32" cy="32" r="13" stroke="${dim}" stroke-width="5" fill="none"/><path d="${d.route}" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="${d.arrow}" fill="${color}"/>${exit != null ? `<text x="32" y="37" font-size="14" font-weight="800" fill="${color}" text-anchor="middle" font-family="Helvetica">${exit}</text>` : ""}</svg>`;
}
const TURN_SVG: Record<string, string> = {
  left: "M44 50V30a8 8 0 0 0-8-8H18M26 12L16 22l10 10",
  right: "M20 50V30a8 8 0 0 1 8-8h18M38 12l10 10-10 10",
  straight: "M32 54V12M22 22l10-10 10 10",
  slightLeft: "M40 54V36L24 18M22 30V16h14",
  slightRight: "M24 54V36l16-18M42 30V16H28",
  merge: "M22 54c0-14 10-18 10-30V12M22 22l10-10 10 10M44 54c0-10-6-14-10-18",
};
const turnSvg = (m: string | undefined, size: number, color: string) => {
  const key = m === "turn-left" ? "left" : m === "turn-right" ? "right" : m === "turn-slight-left" || m === "fork-left" || m === "ramp-left" ? "slightLeft" : m === "turn-slight-right" || m === "fork-right" || m === "ramp-right" ? "slightRight" : m === "merge" ? "merge" : "straight";
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><path d="${TURN_SVG[key]}" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};

/** The black instruction bar: up behind the status bar (light status-bar text), content under it. */
function topBar(icon: string, distance: string, street: string, shield: string | null) {
  const status = `<div style="position:absolute;left:0;right:0;top:0;height:${SAFE_TOP}px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;font:600 16px ${FONT};color:#fff"><span>9:41</span><span style="font-size:13px">●●● ▮</span></div>`;
  return `<div style="position:absolute;left:0;right:0;top:0;background:#000;padding:${SAFE_TOP + 6}px 16px 14px;display:flex;align-items:center;gap:14px">
    <div style="width:72px;height:72px;display:flex;align-items:center;justify-content:center">${icon}</div>
    <div style="flex:1;min-width:0"><div style="font:800 38px/44px ${FONT};color:#fff">${distance}</div>
    <div style="display:flex;align-items:center;gap:8px">${shield ? `<span style="background:${GREEN_TEXT};border:1.5px solid #fff;border-radius:5px;padding:1px 6px;font:800 16px ${FONT};color:#fff">${shield}</span>` : ""}<span style="font:700 24px ${FONT};color:#41D8F5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${street}</span></div></div></div>${status}`;
}
const TOP_BAR_H = 6 + 72 + 14; // below the safe area
function bottomBar() {
  return `<div style="position:absolute;left:0;right:0;bottom:0;height:${110 + SAFE_BOTTOM}px;background:#1C1D20;border-top-left-radius:20px;border-top-right-radius:20px;display:flex;align-items:flex-start;justify-content:space-between;padding:22px 18px 0;box-sizing:border-box">
    <div style="width:56px;height:56px;border-radius:28px;background:#33363B;display:flex;align-items:center;justify-content:center"><svg width="26" height="26" viewBox="0 0 24 24"><circle cx="10" cy="10" r="6" stroke="#fff" stroke-width="2.4" fill="none"/><path d="M15 15l5 5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg></div>
    <div style="text-align:center"><div style="font:800 30px ${FONT};color:#fff">10:12 am</div><div style="font:500 15px ${FONT};color:#B8BCC4">24 min • 18.4 km</div></div>
    <div style="width:56px;height:56px;border-radius:28px;background:#33363B;display:flex;align-items:center;justify-content:center"><svg width="26" height="26" viewBox="0 0 24 24"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg></div></div>`;
}
const fbox = (f: Frame, inner: string, bg = "#2A2C30", radius = "50%", extra = "") =>
  `<div style="position:absolute;left:${f.x}px;top:${f.y}px;width:${f.width}px;height:${f.height}px;border-radius:${radius};background:${bg};box-shadow:0 3px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;${extra}">${inner}</div>`;
function navControls(free: boolean, ringed: boolean, toast: string | null) {
  const frames = navControlFrames({ width: W, height: H, safeTop: SAFE_TOP, safeBottom: SAFE_BOTTOM, bottomBarHeight: 110, topBarHeight: TOP_BAR_H, showSpeedLimit: true, showRecenter: free, showCompass: true, showSound: true, showVoice: true, showStreetChip: true, showInfoBanner: false });
  let html = "";
  html += fbox(frames.compass!, `<svg width="30" height="30" viewBox="0 0 24 24"><path d="M12 3l3 9h-6z" fill="#E5484D"/><path d="M12 21l-3-9h6z" fill="#fff"/></svg>`, "#2A2C30", "50%", ringed ? `border:3px solid ${BLUE};box-sizing:border-box` : "");
  html += fbox(frames.sound!, `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#fff"/></svg>`);
  html += fbox(frames.voice!, `<svg width="22" height="22" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="#fff"/><path d="M6 11a6 6 0 0012 0M12 17v4" stroke="#fff" stroke-width="2" fill="none"/></svg>`);
  html += fbox(frames.speedometer!, `<div style="text-align:center;color:#1F2125"><div style="font:800 24px ${FONT}">58</div><div style="font:600 11px ${FONT}">km/h</div></div>`, "#fff");
  html += fbox(frames.speedLimit!, `<div style="width:84%;height:84%;border-radius:50%;border:5px solid #E5484D;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font:800 18px ${FONT};color:#1F2125">60</div>`, "#fff");
  html += fbox(frames.report!, `<svg width="30" height="30" viewBox="0 0 48 48"><path d="M24 7 L43 40 L5 40 Z" fill="none" stroke="#000" stroke-width="3.5" stroke-linejoin="round"/><path d="M24 20v14M17 27h14" stroke="#000" stroke-width="3.5" stroke-linecap="round"/></svg>`, "#FFC800", "16px");
  if (frames.streetChip) html += fbox(frames.streetChip, `<span style="font:600 15px ${FONT};color:#fff">Rookwood Rd</span>`, "rgba(28,29,32,.92)", "16px");
  if (free && frames.recenter) html += fbox(frames.recenter, `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M3 11l18-8-8 18-2-8z" fill="#0062B8"/></svg><span style="margin-left:6px;font:700 16px ${FONT};color:#0062B8">Re-centre</span>`, "#fff", "22px");
  if (toast) html += `<div style="position:absolute;left:0;right:0;top:${SAFE_TOP + TOP_BAR_H + 12}px;display:flex;justify-content:center"><div style="padding:8px 14px;border-radius:18px;background:rgba(20,22,26,.88);font:600 15px ${FONT};color:#fff">${toast}</div></div>`;
  return { html, frames };
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const notes: Record<string, unknown> = {};
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const shoot = async (shot: Shot) => {
    const r = await render(page, shot);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
    notes[shot.name] = r;
    console.log(shot.name, JSON.stringify(r).slice(0, 160));
  };

  // ======== 1-2. Route preview: every route + start + destination fitted, bubbles by the solver
  const TOP_CARD_BOTTOM = SAFE_TOP + 8 + 117 + 8 + 36;
  const previewCard = (from: string, to: string, mode: string) =>
    `<div style="position:absolute;left:12px;right:12px;top:${SAFE_TOP + 8}px;background:#fff;border-radius:32px;padding:10px 14px;box-shadow:0 6px 18px rgba(0,0,0,.18);font:500 18px ${FONT};color:#1F2125"><div style="height:48px;display:flex;align-items:center">● ${from}</div><div style="height:1px;background:#DADDE2"></div><div style="height:48px;display:flex;align-items:center">⚑ ${to}</div></div>
     <div style="position:absolute;left:12px;top:${SAFE_TOP + 8 + 117 + 8}px;height:36px;border-radius:18px;background:#fff;box-shadow:0 3px 10px rgba(0,0,0,.2);display:flex;align-items:center;padding:0 14px;font:600 16px ${FONT};color:#1F2125">${mode}</div>`;
  const previewSheet = (h: number, rows: { t: string; d: string; sel: boolean }[]) =>
    `<div style="position:absolute;left:0;right:0;bottom:0;height:${h}px;background:#fff;border-top-left-radius:24px;border-top-right-radius:24px;box-shadow:0 -4px 16px rgba(0,0,0,.12);padding:10px 20px 0;box-sizing:border-box"><div style="width:40px;height:5px;border-radius:3px;background:#DADDE2;margin:0 auto 12px"></div>${rows
      .map((r) => `<div style="display:flex;justify-content:space-between;align-items:center;height:52px;border-bottom:1px solid #E6E8EB"><span style="font:800 22px ${FONT};color:${r.sel ? "#3B0C8C" : "#1F2125"}">${r.t}</span><span style="font:500 15px ${FONT};color:#6B7078">${r.d}</span></div>`)
      .join("")}<div style="position:absolute;left:20px;right:20px;bottom:${SAFE_BOTTOM + 8}px;height:52px;border-radius:26px;background:#0098FF;display:flex;align-items:center;justify-content:center;font:700 18px ${FONT};color:#fff">Go now</div></div>`;
  const cases: { name: string; mode: string; profile: string; from: LngLat; to: LngLat; fromName: string; toName: string; sheet: number }[] = [
    { name: "1-preview-drive", mode: "Drive", profile: "driving-traffic", from: [151.0345, -33.9175], to: [151.0036, -33.8150], fromName: "Bankstown", toName: "Parramatta", sheet: 263 },
    { name: "1-preview-walk", mode: "Walk", profile: "walking", from: [151.2066, -33.8840], to: [151.2108, -33.8614], fromName: "Central Station", toName: "Circular Quay", sheet: 263 },
    { name: "1-preview-bike", mode: "Bike", profile: "cycling", from: [151.2066, -33.8840], to: [151.2153, -33.8568], fromName: "Central Station", toName: "Opera House", sheet: 263 },
    { name: "2-bubbles-sheet-half", mode: "Drive", profile: "driving-traffic", from: [151.0345, -33.9175], to: [151.0036, -33.8150], fromName: "Bankstown", toName: "Parramatta", sheet: 460 },
  ];
  for (const c of cases) {
    const rs = await mapboxRoutes(c.profile, c.from, c.to);
    const selected = 0;
    const lines = previewFitLines(rs, selected, (r) => r.line.map(lat));
    const fitPoints = previewFitCoordinates(lines, lat(c.from), lat(c.to));
    const padding = previewEdgePadding(TOP_CARD_BOTTOM, c.sheet);
    const sel = rs[selected];
    const routes = lines.map((line, i) => ({ line, text: i === selected ? mins(sel.seconds) : timeDifferenceText(rs[i].seconds, sel.seconds), compactText: i === selected ? mins(sel.seconds) : timeDifferenceText(rs[i].seconds, sel.seconds) }));
    const placed = layoutRouteBubbles(routes, selected, fitPoints, { width: W, height: H }, padding, [
      { at: lat(c.to), box: { x0: -11, x1: 33, y0: -50, y1: 2 } },
      { at: lat(c.from), box: { x0: -22, x1: 22, y0: -22, y1: 22 } },
    ]);
    const pins = placed.flatMap((p, i) => {
      if (!p) return [];
      const b = bubble(p.compact ? routes[i].compactText : routes[i].text, i === selected ? "Best" : null, i === selected, p.side, p.compact);
      return [{ at: ll(p.anchor), html: b.html, ax: b.ax, ay: b.ay }];
    });
    notes[`${c.name}-bubbles`] = placed.map((p) => (p ? { side: p.side, compact: p.compact } : null));
    await shoot({
      name: c.name,
      scheme: "light",
      fit: { coords: fitPoints.map(ll), padding },
      routes: lines.map((l, i) => ({ line: l.map(ll), selected: i === selected })),
      driver: { at: c.from, heading: 0, dot: true },
      flag: c.to,
      pins,
      overlay: previewCard(c.fromName, c.toName, c.mode) + previewSheet(c.sheet, rs.slice(0, 3).map((r, i) => ({ t: mins(r.seconds), d: fmtKm(r.metres), sel: i === 0 }))) + caption(`${c.mode} · ${rs.length} real routes, all fitted with start + flag · sheet ${c.sheet} pt · bubbles from layoutRouteBubbles · drawn`, H - SAFE_BOTTOM - 150),
      measure: { points: fitPoints.map(ll), free: padding },
    });
  }

  // ======== 3-4. Driving: the default view, then FREE with the hint
  const line: LngLat[] = recorded.line.map(ll);
  const k = Math.floor(line.length * 0.28);
  const here = line[k];
  const ahead = line[Math.min(line.length - 1, k + 3)];
  const heading = (Math.atan2((ahead[0] - here[0]) * Math.cos((here[1] * Math.PI) / 180), ahead[1] - here[1]) * 180) / Math.PI;
  const speed = 60;
  const gZoom = navZoomForSpeed(speed, H, here[1]);
  const navPad = navFollowPadding(H);
  const bar = topBar(turnSvg("turn-right", 60, "#fff"), "850 m", "St Hilliers Rd", null);
  notes.navCamera = { speedKmh: speed, googleZoom: gZoom, mapboxZoom: mapboxZoomFromGoogle(gZoom), pitch: NAV_FOLLOW_PITCH, aheadMetres: Math.round(metresAheadVisible(gZoom, NAV_FOLLOW_PITCH, H, here[1], NAV_ARROW_FRACTION)) };
  const def = navControls(false, false, null);
  notes.navDefaultOverlaps = overlaps(def.frames);
  await shoot({
    name: "3-nav-default-view",
    scheme: "light",
    camera: { center: here, zoom: mapboxZoomFromGoogle(gZoom), pitch: NAV_FOLLOW_PITCH, bearing: heading, padding: navPad },
    routes: [{ line, selected: true }],
    driver: { at: here, heading },
    overlay: bar + def.html + bottomBar() + caption(`Default: heading-up · 45° · arrow at 72% · ${speed} km/h → ~${(notes.navCamera as { aheadMetres: number }).aheadMetres} m ahead · drawn`, SAFE_TOP + TOP_BAR_H + 70),
  });
  const free = navControls(true, true, null);
  notes.navFreeOverlaps = overlaps(free.frames);
  await shoot({
    name: "4-nav-free-recentre-hint",
    scheme: "light",
    camera: { center: here, zoom: mapboxZoomFromGoogle(gZoom) - 0.9, pitch: 25, bearing: heading + 40, padding: navPad },
    routes: [{ line, selected: true }],
    driver: { at: here, heading },
    overlay: bar + free.html + bottomBar() + caption("Panned + rotated (FREE): Re-centre pill bottom-left, compass ringed blue · tap either → default view in 600 ms · drawn", SAFE_TOP + TOP_BAR_H + 70),
  });
  await shoot({
    name: "4b-nav-compass-toast",
    scheme: "light",
    camera: { center: here, zoom: mapboxZoomFromGoogle(gZoom), pitch: NAV_FOLLOW_PITCH, bearing: 0, padding: navPad },
    routes: [{ line, selected: true }],
    driver: { at: here, heading },
    overlay: bar + navControls(false, false, "North up").html + bottomBar() + caption("Compass tap while following: north-up, with a toast · drawn", SAFE_TOP + TOP_BAR_H + 70),
  });

  // ======== 5. Controls: every state on 320 / 375 / 390 / 430 pt, from navControlFrames
  {
    const phones = [
      { width: 320, height: 568, safeTop: 20, safeBottom: 0 },
      { width: 375, height: 667, safeTop: 20, safeBottom: 0 },
      { width: 390, height: 844, safeTop: 47, safeBottom: 34 },
      { width: 430, height: 932, safeTop: 59, safeBottom: 34 },
    ];
    const states = [
      { label: "following", showRecenter: false, banner: false },
      { label: "FREE", showRecenter: true, banner: false },
      { label: "FREE + banner", showRecenter: true, banner: true },
    ];
    const scale = 0.5;
    let html = "";
    let x = 16;
    const result: Record<string, string[]> = {};
    for (const p of phones) {
      let y = 40;
      for (const s of states) {
        const f = navControlFrames({ ...p, bottomBarHeight: 110, topBarHeight: 120, showSpeedLimit: true, showRecenter: s.showRecenter, showCompass: true, showSound: true, showVoice: true, showStreetChip: true, showInfoBanner: true, ...(s.banner ? { dropBy: 100, aheadBanner: { height: 88, progress: 1 } } : {}) });
        result[`${p.width}-${s.label}`] = overlaps(f);
        html += `<div style="position:absolute;left:${x}px;top:${y}px;width:${p.width * scale}px;height:${p.height * scale}px;border:2px solid #1F2125;border-radius:12px;background:#E9ECEF;overflow:hidden">`;
        const colour: Record<string, string> = { topBar: "#000", bottomBar: "#1C1D20", aheadBanner: "#26282C", report: "#FFC800", recenter: "#0098FF", speedometer: "#fff", speedLimit: "#E5484D", compass: "#6A1FD1", sound: "#2A2C30", voice: "#2A2C30", streetChip: "#555", infoBanner: "#1E8E3E" };
        for (const [name, fr] of Object.entries(f)) html += `<div title="${name}" style="position:absolute;left:${fr!.x * scale}px;top:${fr!.y * scale}px;width:${fr!.width * scale}px;height:${fr!.height * scale}px;background:${colour[name] ?? "#999"};opacity:.9;border-radius:3px;outline:1px solid rgba(255,255,255,.6)"></div>`;
        html += `</div><div style="position:absolute;left:${x}px;top:${y + p.height * scale + 4}px;font:600 11px ${FONT};color:#1F2125">${p.width} · ${s.label} · ${overlaps(f).length} overlaps</div>`;
        y += p.height * scale + 28;
      }
      x += p.width * scale + 24;
    }
    notes.controls = result;
    const legend = `<div style="position:absolute;left:16px;top:10px;font:600 13px ${FONT};color:#1F2125">navControlFrames on 4 phones × 3 states · <span style="color:#0098FF">■</span> Re-centre (bottom-left in FREE) <span style="color:#C9A000">■</span> Report <span style="color:#6A1FD1">■</span> compass <span style="color:#E5484D">■</span> speed sign · no frame overlaps another</div>`;
    await shoot({ name: "5-controls-all-states", scheme: "light", noMap: true, width: 880, height: 2120, overlay: legend + html });
  }

  // ======== 6. Our roundabout picture: exits 1-4 (left-hand traffic), in the bar, the list and on the route
  {
    const exits = [1, 2, 3, 4].map((n) => `<div style="text-align:center"><div style="width:96px;height:96px;border-radius:20px;background:#000;display:flex;align-items:center;justify-content:center">${roundaboutSvg(80, n, roundaboutExitAngle({ exit: n, drivingSide: "left" }), "#fff", "rgba(255,255,255,.38)")}</div><div style="font:600 13px ${FONT};margin-top:6px;color:#1F2125">exit ${n}</div></div>`).join("");
    const rb = recorded.steps.findIndex((s: { maneuver: string }) => s.maneuver.startsWith("roundabout"));
    const step = recorded.steps[rb];
    const exit = extractRoundaboutExitNumber(step.instruction) ?? null;
    const angle = roundaboutExitAngle({ exit, drivingSide: step.drivingSide ?? "left", ...roundaboutGeometryFor(recorded.steps, rb) });
    notes.roundabout = { instruction: step.instruction, exit, angleFromGeometry: angle };
    const barDemo = `<div style="position:relative;width:390px;height:${SAFE_TOP + TOP_BAR_H}px;border-radius:18px;overflow:hidden">${topBar(roundaboutSvg(64, exit, angle, "#fff", "rgba(255,255,255,.38)"), "240 m", step.targetStreetName ?? "Chapel Rd", null)}</div>`;
    const listDemo = `<div style="width:390px;background:#fff;border-radius:18px;padding:12px 20px;box-sizing:border-box;display:flex;gap:16px;align-items:center"><div style="width:48px;height:48px">${roundaboutSvg(44, exit, angle, BLUE, "#E6E8EB")}</div><div><div style="font:800 20px ${FONT};color:#1F2125">240 m</div><div style="font:700 17px ${FONT};color:#1F2125">${step.targetStreetName ?? ""}</div><div style="font:400 14px ${FONT};color:#6B7078">${step.instruction.replace(/[.\s]+$/, "")}</div></div></div>`;
    const calloutDemo = `<div style="display:inline-flex;align-items:center;gap:4px;padding:5px 8px 5px 4px;border-radius:999px;background:#3B0764;border:1px solid rgba(255,255,255,.25)">${roundaboutSvg(22, exit, angle, "#fff", "rgba(255,255,255,.4)")}<span style="font:700 12px ${FONT};color:#fff">${step.targetStreetName ?? ""}</span></div>`;
    const html = `<div style="position:absolute;left:24px;right:24px;top:20px;font:700 16px ${FONT};color:#1F2125">TrackLine roundabout · clockwise (left-hand traffic) · exit arm highlighted · exit number in the middle</div>
      <div style="position:absolute;left:24px;top:84px;display:flex;gap:18px">${exits}</div>
      <div style="position:absolute;left:24px;right:24px;top:226px;font:600 13px ${FONT};color:#6B7078">Real step from the recorded route: "${step.instruction}" (exit direction from its geometry: ${angle}°)</div>
      <div style="position:absolute;left:24px;top:276px">${barDemo}</div>
      <div style="position:absolute;left:24px;top:${286 + SAFE_TOP + TOP_BAR_H}px">${listDemo}</div>
      <div style="position:absolute;left:24px;top:${400 + SAFE_TOP + TOP_BAR_H}px">${calloutDemo} <span style="font:600 12px ${FONT};color:#6B7078;margin-left:8px">← turn callout on the route</span></div>`;
    await shoot({ name: "6-roundabout-icon", scheme: "light", noMap: true, width: 460, height: 640, overlay: html });
  }

  // ======== 7. Directions list (rows from directionsRows on the recorded route), light + dark
  const rows = directionsRows(recorded.steps);
  notes.directionsRows = rows.map((r) => ({ meters: Math.round(r.meters), street: r.street, shield: r.shield, detail: r.detail, maneuver: r.maneuver }));
  notes.directionsMerged = { steps: recorded.steps.length, rows: rows.length };
  for (const scheme of ["light", "dark"] as const) {
    const s = SURFACES[scheme];
    const current = 3;
    const rowHtml = rows
      .slice(0, 9)
      .map((r, i) => {
        const active = i === current;
        const ink = i < current ? s.textFaint : s.text;
        const color = active ? BLUE : ink;
        const icon = r.final
          ? `<svg width="40" height="40" viewBox="0 0 40 48"><path d="M8 46V6" stroke="${color}" stroke-width="3"/><path d="M9 6h24v16H9z" fill="none" stroke="${color}" stroke-width="2.5"/></svg>`
          : r.maneuver?.startsWith("roundabout")
            ? roundaboutSvg(44, r.roundaboutExit, roundaboutExitAngle({ exit: r.roundaboutExit, drivingSide: r.drivingSide, ...roundaboutGeometryFor(recorded.steps, r.firstStep) }), color, s.divider)
            : turnSvg(r.maneuver, 44, color);
        return `<div style="display:flex;gap:16px;align-items:center;padding:12px 20px;border-bottom:1px solid ${s.divider};background:${active ? (scheme === "dark" ? "#0F2A40" : "#E5F4FF") : "transparent"}"><div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center">${icon}</div><div style="flex:1;min-width:0"><div style="font:800 20px/24px ${FONT};color:${ink}">${fmtKm(r.meters)}</div><div style="display:flex;gap:6px;align-items:center">${r.shield ? `<span style="background:${GREEN_TEXT};border:1.5px solid #fff;border-radius:5px;padding:1px 5px;font:800 14px ${FONT};color:#fff">${r.shield}</span>` : ""}<span style="font:700 17px ${FONT};color:${ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.street}</span></div>${r.detail ? `<div style="font:400 14px/18px ${FONT};color:${s.textMuted}">${r.detail}</div>` : ""}</div></div>`;
      })
      .join("");
    const sheetH = Math.round(H * 0.65);
    const sheet = `<div style="position:absolute;left:0;right:0;bottom:0;height:${sheetH}px;background:${s.sheet};border-top-left-radius:24px;border-top-right-radius:24px;box-shadow:0 -4px 16px rgba(0,0,0,.2);overflow:hidden"><div style="width:40px;height:5px;border-radius:3px;background:${s.divider};margin:8px auto"></div><div style="display:flex;align-items:center;padding:4px 20px 12px;border-bottom:1px solid ${s.divider}"><div style="flex:1"><div style="font:800 20px ${FONT};color:${s.text}">Directions</div><div style="font:400 14px ${FONT};color:${s.textMuted}">${recorded.distanceText} · ${recorded.etaText}</div></div><div style="font:600 22px ${FONT};color:${s.textMuted}">✕</div></div>${rowHtml}</div>`;
    await shoot({
      name: `7-directions-list-${scheme}`,
      scheme,
      camera: { center: here, zoom: mapboxZoomFromGoogle(gZoom), pitch: NAV_FOLLOW_PITCH, bearing: heading, padding: navPad },
      routes: [{ line, selected: true }],
      driver: { at: here, heading },
      overlay: bar + sheet + caption(`Directions · ${recorded.steps.length} route steps → ${rows.length} rows (repeats merged) · recorded route · ${scheme} · drawn`, SAFE_TOP + TOP_BAR_H + 20),
    });
  }

  // ======== 8. Options / ETA sheet: half and full, light and dark. Chart: real predictions.
  {
    const from = line[k];
    const to = line[line.length - 1];
    const now = Date.now();
    const slot0 = Math.ceil(now / (15 * 60_000)) * 15 * 60_000;
    const preds: { departMs: number; durationSeconds: number | null }[] = [];
    for (let i = 0; i < 6; i++) {
      const departMs = i === 0 ? now : slot0 + (i - 1) * 15 * 60_000;
      try {
        const iso = new Date(departMs + (i === 0 ? 60_000 : 0)).toISOString().slice(0, 16);
        const r = await mapboxRoutes("driving-traffic", from, to, iso);
        preds.push({ departMs, durationSeconds: r[0]?.seconds ?? null });
      } catch {
        preds.push({ departMs, durationSeconds: null });
      }
    }
    notes.leavePredictions = { source: "Mapbox driving-traffic depart_at (the app asks Google; same shape)", preds };
    const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" }).replace(/\s?([ap])m/i, " $1m");
    const bars = leaveChartBars(preds, 72, clock);
    const topBarBottom = SAFE_TOP + TOP_BAR_H;
    const heights = optionsSheetHeights(H, topBarBottom);
    notes.optionsSheet = { topBarBottom, ...heights, gapBelowBar: H - heights.full - topBarBottom };
    for (const scheme of ["light", "dark"] as const) {
      const s = SURFACES[scheme];
      const chart = preds.every((p) => p.durationSeconds == null)
        ? `<div style="font:500 14px ${FONT};color:#E5484D;padding:8px 0">${LEAVE_ERROR_TEXT}</div>`
        : `<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:6px;height:136px">${bars
            .map((b) => `<div style="flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end">${b.best ? `<div style="background:#1E7A34;border-radius:8px;padding:1px 6px;margin-bottom:3px;font:800 11px ${FONT};color:#fff">Best</div>` : ""}${b.minutes != null ? `<div style="font:700 12px ${FONT};color:${s.text};margin-bottom:2px">${b.minutes}</div>` : ""}<div style="width:24px;height:${b.height}px;border-radius:6px;background:${b.minutes == null ? s.divider : b.slow ? "#E5484D" : "#FFC800"};${b.best ? "outline:2px solid #1E7A34;" : ""}"></div><div style="font:${b.best ? 700 : 400} 12px ${FONT};color:${b.best ? "#1E7A34" : s.textMuted};margin-top:4px;white-space:nowrap">${b.label}</div></div>`)
            .join("")}</div><div style="font:400 13px ${FONT};color:${s.textMuted};margin-top:4px">Minutes of driving if you leave then. Predictions from Google traffic data.</div>`;
      const row = (label: string, value = "") => `<div style="display:flex;align-items:center;gap:12px;height:56px;border-bottom:1px solid ${s.divider}"><div style="width:32px;height:32px;border-radius:16px;background:${BLUE}"></div><div style="flex:1;font:600 16px ${FONT};color:${s.text}">${label}</div><div style="font:400 15px ${FONT};color:${s.textMuted}">${value}</div></div>`;
      const content = `<div style="display:flex;align-items:center;justify-content:space-between"><div style="width:44px;height:44px;border-radius:22px;background:${s.muted}"></div><div style="text-align:center"><div style="font:800 30px ${FONT};color:${s.text}">10:12 am</div><div style="font:400 15px ${FONT};color:${s.textMuted}">24 min • 18.4 km</div></div><div style="width:44px;height:44px;border-radius:22px;background:${s.muted}"></div></div>
        <div style="background:${s.muted};border-radius:16px;padding:8px 12px;margin-top:10px"><div style="font:700 16px ${FONT};color:${s.text}">To · Church St, Parramatta</div><div style="font:500 14px ${FONT};color:${s.textMuted}">Via · Rookwood Rd</div></div>
        <div style="font:700 15px ${FONT};color:${s.textMuted};margin-top:14px">On your route</div><div style="font:400 15px ${FONT};color:${s.text};padding:6px 0">Nothing reported ahead</div>
        <div style="font:700 15px ${FONT};color:${s.textMuted};margin-top:10px">Find the best time to leave</div>${chart}
        <div style="background:${s.muted};border-radius:16px;padding:0 12px;margin-top:12px">${row("Share drive")}${row("Add a stop")}${row("Report")}${row("Sound & voice")}${row("Map view", "3D")}${row("Satellite", "Off")}${row("Dashcam & AI detection")}${row("Avoid", "None")}</div>`;
      for (const which of ["half", "full"] as const) {
        const h = heights[which];
        const sheet = `<div style="position:absolute;left:0;right:0;bottom:0;height:${h}px;background:${s.sheet};border-top-left-radius:24px;border-top-right-radius:24px;box-shadow:0 -4px 16px rgba(0,0,0,.25);overflow:hidden"><div style="width:40px;height:5px;border-radius:3px;background:${s.textFaint};margin:8px auto"></div><div style="padding:0 16px">${content}</div></div>`;
        await shoot({
          name: `8-options-sheet-${which}-${scheme}`,
          scheme,
          camera: { center: here, zoom: mapboxZoomFromGoogle(gZoom), pitch: NAV_FOLLOW_PITCH, bearing: heading, padding: navPad },
          routes: [{ line, selected: true }],
          driver: { at: here, heading },
          overlay: bar + sheet + caption(`Options sheet ${which} (${h} pt) · ${H - h - topBarBottom} pt clear under the bar (≥120) · content scrolls · ${scheme} · drawn`, topBarBottom + 12),
        });
      }
    }
  }

  writeFileSync(`${OUT}/shots.json`, JSON.stringify(notes, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
