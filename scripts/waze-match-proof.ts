// Proof renders for docs/waze-match-routes and docs/startup-trackys. There is no iOS simulator on
// the build machine (Linux), so -- like scripts/permanent-fix-proof.ts -- this draws the app's real
// map style (src/map-v2/styles/*.json) with real Mapbox tiles in headless Chromium, with REAL
// routes from Mapbox Directions, and puts the app's screens on top as HTML built from the app's
// own code: the same layout maths (previewEdgePadding, homeControlFrames), the same words
// (viaText, trackysPillText, the picker's title and line), the same colours (route palette,
// MAP_LOADING_GRID), the same heading filter (CompassFilter + HeadingTurret) and the same privacy
// rule (trackysCore.insideAnyZone). The HTML is a drawing of the React Native screens, not a phone
// screenshot -- every image says so in its caption.
//
// Run: MAPBOX_TOKEN_FILE=<file with a pk. token> MAPBOX_GL_DIR=<dir with mapbox-gl installed> \
//        npx tsx scripts/waze-match-proof.ts
// The token is read from the file and never printed.
/* global mapboxgl */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { previewEdgePadding, previewFitCoordinates, MAX_SHEET_FRACTION, bubbleSize } from "../src/nav/previewCamera";
import { screenBubbleAnchors } from "../src/map/routeChoices";
import { homeArrowTargetY, homeControlFrames, homeMapPadding, HOME_FOLLOW_ZOOM, whereToSnapFractions, type HomeFrame } from "../src/map/homeMapLogic";
import { mapboxZoomFromGoogle } from "../src/map-v2/geo";
import { viaText } from "../src/map/viaText";
import { routeColoursFor } from "../src/map-v2/styles/mapAppearance";
import { SURFACES, BLUE_TEXT } from "../src/theme/colors";
import { MAP_LOADING_GRID as MAP_LOADING_GRID_COLOURS, GRID_STEP as GRID_STEP_PX } from "../src/map-v2/loadingGridColours";
import { trackysPillText } from "../src/services/trackysPill";
import { CompassFilter, HeadingTurret, targetHeading } from "../src/nav/headingTurret";
import { VEHICLE_OPTIONS } from "../src/services/vehicle";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const trackysCore = require("../firebase/functions/trackysCore");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright");

declare const mapboxgl: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const W = 390;
const H = 844;
const SAFE_TOP = 47;
const SAFE_BOTTOM = 34;
const BANNER_HEIGHT = 50; // = BannerAdBar's BANNER_HEIGHT (pinned in __tests__/presses/homeScreen.test.tsx)
const FONT = "-apple-system,Helvetica,Arial";
const token = readFileSync(process.env.MAPBOX_TOKEN_FILE!, "utf8").trim();
const gl = path.join(process.env.MAPBOX_GL_DIR!, "node_modules/mapbox-gl/dist");
const lib = readFileSync(path.join(gl, "mapbox-gl.js"), "utf8");
const css = readFileSync(path.join(gl, "mapbox-gl.css"), "utf8");
const arrowPng = "data:image/png;base64," + readFileSync("assets/map/user-arrow@3x.png").toString("base64");
const trackyIcon = "data:image/png;base64," + readFileSync("assets/icon.png").toString("base64");

type LngLat = [number, number];
type Pad = { top: number; bottom: number; left: number; right: number };
interface Shot {
  name: string;
  scheme: "light" | "dark";
  camera?: { center: LngLat; zoom: number; pitch: number; bearing: number; padding?: Pad };
  fit?: { coords: LngLat[]; padding: Pad };
  routes?: { line: LngLat[]; selected: boolean }[];
  driver?: { at: LngLat; heading: number; dot?: boolean };
  others?: { at: LngLat; label: string }[];
  circles?: { at: LngLat; radiusM: number }[];
  flag?: LngLat;
  bubbles?: { at: LngLat; text: string; tag?: string; selected: boolean }[];
  overlay: string;
  noMap?: boolean;
  measure?: { points: LngLat[]; free: Pad };
}

const caption = (text: string, y: number) =>
  `<div style="position:absolute;left:50%;top:${y}px;transform:translateX(-50%);background:rgba(17,17,17,.82);color:#fff;font:600 11px ${FONT};padding:5px 9px;border-radius:9px;max-width:340px;text-align:center">${text}</div>`;
const box = (f: HomeFrame, bg: string, inner: string, radius = "50%") =>
  `<div style="position:absolute;left:${f.x}px;top:${f.y}px;width:${f.width}px;height:${f.height}px;border-radius:${radius};background:${bg};box-shadow:0 3px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center">${inner}</div>`;
const MAP_BTN = "#2A2C30";
const ICON = {
  menu: `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  compass: `<svg width="30" height="30" viewBox="0 0 24 24"><path d="M12 3l3 9h-6z" fill="#E5484D"/><path d="M12 21l-3-9h6z" fill="#fff"/></svg>`,
  sound: `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#fff"/></svg>`,
  report: `<svg width="30" height="30" viewBox="0 0 24 24"><path d="M5 18V6a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 3z" fill="#1A1A1A"/></svg>`,
  chevron: `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" stroke="#1F2125" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`,
  swap: `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" stroke="#1F2125" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  ring: `<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="#0098FF" stroke-width="2.4" fill="none"/><circle cx="12" cy="12" r="4.5" fill="#0098FF"/></svg>`,
  pin: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 22s7-7.5 7-13a7 7 0 10-14 0c0 5.5 7 13 7 13z" fill="#E5484D"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>`,
  car: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M5 16h14v-4l-2-5H7l-2 5z M7 16v2M17 16v2" stroke="#1F2125" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>`,
  down: (c: string) => `<svg width="14" height="14" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`,
  check: `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" stroke="${BLUE_TEXT}" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`,
};

// ---------------------------------------------------------------- real routes (Mapbox Directions)
interface RealRoute {
  line: LngLat[];
  seconds: number;
  metres: number;
  via: string | null;
}
async function realRoutes(from: LngLat, to: LngLat): Promise<RealRoute[]> {
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from.join(",")};${to.join(",")}?alternatives=true&geometries=geojson&overview=full&steps=true&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);
  type MbStep = { name: string; distance: number; maneuver: { location: LngLat }; geometry: { coordinates: LngLat[] } };
  const json = (await res.json()) as { routes: { geometry: { coordinates: LngLat[] }; duration: number; distance: number; legs: { steps: MbStep[] }[] }[] };
  return json.routes.map((r) => {
    // Each Mapbox step's `name` is the road it travels along -- the same as a Google step naming its
    // own road, so viaText runs with source "google" here (the app's toAppSteps shifts Mapbox names
    // onto the previous step, which viaText then shifts back).
    const steps = r.legs.flatMap((l) => l.steps).map((s) => {
      const c = s.geometry.coordinates;
      return { targetStreetName: s.name || undefined, distanceMeters: s.distance, startLocation: { latitude: c[0][1], longitude: c[0][0] }, endLocation: { latitude: c[c.length - 1][1], longitude: c[c.length - 1][0] } };
    });
    return { line: r.geometry.coordinates, seconds: r.duration, metres: r.distance, via: viaText(steps, "google") };
  });
}
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

// ---------------------------------------------------------------- renderer
async function render(page: any, shot: Shot) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const style = shot.noMap ? null : JSON.parse(readFileSync(`src/map-v2/styles/trackline-${shot.scheme}.json`, "utf8"));
  const colours = routeColoursFor(shot.scheme === "dark" ? "dark" : "light", false);
  await page.setContent(`<html><head><style>${css} body{margin:0;overflow:hidden;background:#fff} #m{width:${W}px;height:${H}px} #o{position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none}</style></head><body><script>window.__name=(f)=>f;</script><div id="m"></div><div id="o">${shot.overlay}</div><script>${lib}</script></body></html>`);
  if (shot.noMap) return {};
  return page.evaluate(
    async ({ token, style, shot, arrowPng, trackyIcon, colours }: { token: string; style: unknown; shot: Shot; arrowPng: string; trackyIcon: string; colours: { route: string; routeCasing: string; routeAlt: string } }) => {
      mapboxgl.accessToken = token;
      const cam = shot.camera;
      const map = new mapboxgl.Map({ container: "m", style, center: cam?.center ?? shot.fit!.coords[0], zoom: cam?.zoom ?? 13, pitch: cam?.pitch ?? 0, bearing: cam?.bearing ?? 0, preserveDrawingBuffer: true });
      await new Promise((r) => map.on("load", r));
      const arrow = new Image();
      arrow.src = arrowPng;
      await arrow.decode();
      map.addImage("user-arrow", arrow, { pixelRatio: 3 });
      const below = map.getLayer("road-label-service") ? "road-label-service" : undefined;
      (shot.circles ?? []).forEach((c, i) => {
        const pts: [number, number][] = [];
        for (let a = 0; a <= 360; a += 6) {
          const r = c.radiusM / 111320;
          pts.push([c.at[0] + (r / Math.cos((c.at[1] * Math.PI) / 180)) * Math.cos((a * Math.PI) / 180), c.at[1] + r * Math.sin((a * Math.PI) / 180)]);
        }
        map.addSource(`zone-${i}`, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } } });
        map.addLayer({ id: `zone-${i}`, type: "fill", source: `zone-${i}`, paint: { "fill-color": "#0098FF", "fill-opacity": 0.1 } }, below);
        map.addLayer({ id: `zone-line-${i}`, type: "line", source: `zone-${i}`, paint: { "line-color": "#0062B8", "line-width": 1.5, "line-dasharray": [2, 2] } }, below);
      });
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
      const at = (ll: [number, number], html: string, dx: number, dy: number) => {
        const p = map.project(ll);
        const d = document.createElement("div");
        d.style.cssText = `position:absolute;left:${p.x + dx}px;top:${p.y + dy}px`;
        d.innerHTML = html;
        o.insertBefore(d, o.firstChild);
        return p;
      };
      if (shot.driver?.dot) at(shot.driver.at, `<div style="width:40px;height:40px;border-radius:20px;background:rgba(110,116,128,.22);display:flex;align-items:center;justify-content:center"><div style="width:18px;height:18px;border-radius:9px;background:#0098FF;border:3px solid #fff;box-sizing:border-box"></div></div>`, -20, -20);
      if (shot.flag) at(shot.flag, `<svg width="40" height="48" viewBox="0 0 40 48"><path d="M8 46V6" stroke="#1F2125" stroke-width="3"/><path d="M9 6h24v16H9z" fill="#fff" stroke="#1F2125"/><path d="M9 6h6v4H9zM21 6h6v4h-6zM15 10h6v4h-6zM27 10h6v4h-6zM9 14h6v4H9zM21 14h6v4h-6zM15 18h6v4h-6zM27 18h6v4h-6z" fill="#1F2125"/></svg>`, -9, -46);
      for (const t of shot.others ?? []) at(t.at, `<div style="display:flex;flex-direction:column;align-items:center"><img src="${trackyIcon}" style="width:34px;height:34px;border-radius:17px;box-shadow:0 2px 6px rgba(0,0,0,.3)"/><div style="margin-top:2px;background:#fff;border-radius:8px;padding:1px 6px;font:600 11px -apple-system,Helvetica,Arial;color:#1F2125">${t.label}</div></div>`, -30, -17);
      const anchors: { x: number; y: number }[] = [];
      for (const b of shot.bubbles ?? []) {
        const html = `<div style="min-width:64px;text-align:center;padding:6px 12px;border-radius:14px;background:${b.selected ? "#3B0C8C" : "#fff"};border:${b.selected ? "none" : "1px solid #DADDE2"};box-shadow:0 2px 6px rgba(0,0,0,.2);font:700 17px -apple-system,Helvetica,Arial;color:${b.selected ? "#fff" : "#1F2125"}">${b.text}${b.tag ? `<div style="font:500 14px -apple-system,Helvetica,Arial;color:#fff">${b.tag}</div>` : ""}</div>`;
        anchors.push(at(b.at, html, -42, b.selected ? -60 : -40));
      }
      let inside: boolean | null = null;
      if (shot.measure) {
        const f = shot.measure.free;
        inside = shot.measure.points.every((c) => {
          const p = map.project(c);
          return p.x >= f.left - 1 && p.x <= 390 - f.right + 1 && p.y >= f.top - 1 && p.y <= 844 - f.bottom + 1;
        });
      }
      const me = shot.driver ? map.project(shot.driver.at) : null;
      return { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), inside, anchors, arrowY: me ? Math.round(me.y) : null, arrowFraction: me ? +(me.y / 844).toFixed(3) : null };
    },
    { token, style, shot, arrowPng, trackyIcon, colours }
  );
}

// ---------------------------------------------------------------- the route preview, drawn
const TOP_CARD_BOTTOM = SAFE_TOP + 8 + 10 + 48 + 1 + 48 + 10 + 8 + 36; // card + pill row
function topCard(origin: string, destination: string, vehicle: string): string {
  const top = SAFE_TOP + 8;
  return `<div style="position:absolute;left:12px;right:12px;top:${top}px;background:#fff;border-radius:32px;padding:10px;display:flex;align-items:center;gap:6px;box-shadow:0 6px 18px rgba(0,0,0,.18)">
    <div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center">${ICON.chevron}</div>
    <div style="flex:1;background:#F0F1F4;border-radius:22px;padding:0 14px;position:relative">
      <div style="height:48px;display:flex;align-items:center;gap:10px;font:500 18px ${FONT};color:#1F2125">${ICON.ring}${origin}</div>
      <div style="height:1px;background:#DADDE2;margin-left:30px;margin-right:44px"></div>
      <div style="height:48px;display:flex;align-items:center;gap:10px;font:500 18px ${FONT};color:#1F2125;padding-right:40px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ICON.pin}${destination}</div>
      <div style="position:absolute;right:4px;top:26px;width:44px;height:44px;display:flex;align-items:center;justify-content:center">${ICON.swap}</div>
    </div></div>
    <div style="position:absolute;left:12px;top:${top + 117 + 8}px;display:flex;gap:8px">
      <div style="height:36px;border-radius:18px;background:#fff;box-shadow:0 3px 10px rgba(0,0,0,.2);display:flex;align-items:center;gap:6px;padding:0 14px;font:600 16px ${FONT};color:${BLUE_TEXT}">Avoid ${ICON.down(BLUE_TEXT)}</div>
      <div style="height:36px;border-radius:18px;background:#fff;box-shadow:0 3px 10px rgba(0,0,0,.2);display:flex;align-items:center;gap:6px;padding:0 14px;font:600 16px ${FONT};color:#1F2125">${ICON.car}${vehicle} ${ICON.down("#1F2125")}</div>
    </div>`;
}
function footer(): string {
  return `<div style="border-top:1px solid #E3E5E9;display:flex;gap:12px;padding:10px 16px ${SAFE_BOTTOM + 12}px">
    <div style="flex:1;height:52px;border-radius:26px;background:#F0F1F4;display:flex;align-items:center;justify-content:center;font:600 18px ${FONT};color:${BLUE_TEXT}">Leave later</div>
    <div style="flex:1;height:52px;border-radius:26px;background:#0098FF;display:flex;align-items:center;justify-content:center;font:600 18px ${FONT};color:#fff">Go now</div></div>`;
}
const FOOTER_H = 10 + 52 + SAFE_BOTTOM + 12;
function collapsedSheet(r: RealRoute, sub: string): { html: string; height: number } {
  const body = 23 + 8 + 40 + 26 + 22 + 12;
  const height = body + FOOTER_H;
  return {
    height,
    html: `<div style="position:absolute;left:0;right:0;bottom:0;height:${height}px;background:#fff;border-radius:24px 24px 0 0;box-shadow:0 -6px 18px rgba(0,0,0,.14)">
      <div style="width:44px;height:5px;border-radius:3px;background:#D5D8DD;margin:8px auto 10px"></div>
      <div style="padding:0 20px 12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font:700 34px ${FONT};color:#1F2125">${mins(r.seconds)}</span><span style="font:400 18px ${FONT};color:#5F6570">${km(r.metres)}</span></div>
        <div style="font:500 20px ${FONT};color:#1F2125;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.via ?? ""}</div>
        <div style="font:400 17px ${FONT};color:#5F6570">${sub}</div>
      </div>${footer()}</div>`,
  };
}
function expandedSheet(rs: RealRoute[], selected: number): { html: string; height: number } {
  const rows = rs
    .map((r, i) => `<div style="position:relative;padding:14px 20px;${i > 0 ? "border-top:1px solid #E3E5E9;" : ""}${i === selected ? "background:#F0F1F4;" : ""}">
      ${i === selected ? `<div style="position:absolute;left:0;top:0;bottom:0;width:4px;background:#0098FF"></div>` : ""}
      <div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font:700 24px ${FONT};color:${i === selected ? BLUE_TEXT : "#1F2125"}">${mins(r.seconds)}</span><span style="font:400 17px ${FONT};color:#5F6570">${km(r.metres)}</span></div>
      <div style="font:500 18px ${FONT};color:#1F2125;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${r.via ?? ""}</div>
      <div style="font:400 16px ${FONT};color:#5F6570">${i === 0 ? "Best route" : "Alternative route"}</div></div>`)
    .join("");
  const height = Math.min(Math.round(H * MAX_SHEET_FRACTION) + FOOTER_H, 23 + rs.length * 104 + FOOTER_H);
  return {
    height,
    html: `<div style="position:absolute;left:0;right:0;bottom:0;height:${height}px;background:#fff;border-radius:24px 24px 0 0;box-shadow:0 -6px 18px rgba(0,0,0,.14);display:flex;flex-direction:column">
      <div style="width:44px;height:5px;border-radius:3px;background:#D5D8DD;margin:8px auto 10px"></div>
      <div style="flex:1;overflow:hidden">${rows}</div>${footer()}</div>`,
  };
}

// ---------------------------------------------------------------- home, drawn
// The "Where to?" peek exactly as the app works it out (threeSnapHeights with whereToSnapFractions).
const SHEET_PEEK = (() => {
  const banner = BANNER_HEIGHT + SAFE_BOTTOM;
  return whereToSnapFractions(H, SAFE_TOP, banner)[0] * (H - SAFE_TOP - banner);
})();
function homeOverlay(scheme: "light" | "dark", extra = "", label = "", streetPill = true): { html: string; frames: ReturnType<typeof homeControlFrames> } {
  const sheetPeek = SHEET_PEEK;
  const banner = BANNER_HEIGHT + SAFE_BOTTOM;
  const f = homeControlFrames({ width: W, height: H - banner, topInset: SAFE_TOP, scale: 1, sheetVisibleHeight: sheetPeek, bottomInset: 0, showCompass: true, showAudioPlayer: false, showSound: true, showRecenter: false, showStreetPill: streetPill });
  const s = SURFACES[scheme];
  let html = box(f.menu!, MAP_BTN, ICON.menu, "16px") + box(f.compass!, MAP_BTN, ICON.compass) + box(f.sound!, MAP_BTN, ICON.sound) + box(f.report!, "#FFD400", ICON.report, "16px");
  if (f.streetPill) html += `<div style="position:absolute;left:${f.streetPill.x}px;top:${f.streetPill.y}px;width:${f.streetPill.width}px;height:${f.streetPill.height}px;border-radius:${f.streetPill.height / 2}px;background:${s.sheet};box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;font:600 17px ${FONT};color:${s.text}">Stacey St</div>`;
  html += extra;
  html += `<div style="position:absolute;left:0;right:0;bottom:${banner}px;height:${sheetPeek}px;background:${s.sheet};border-radius:20px 20px 0 0;box-shadow:0 -4px 14px rgba(0,0,0,.12)"><div style="width:40px;height:5px;border-radius:3px;background:${s.divider};margin:8px auto"></div><div style="margin:4px 16px;height:48px;border-radius:24px;background:${s.muted};display:flex;align-items:center;padding-left:16px;font:500 17px ${FONT};color:${s.textMuted}">Where to?</div></div>`;
  html += `<div style="position:absolute;left:0;right:0;bottom:0;height:${banner}px;background:${s.sheet};border-top:1px solid ${s.divider}"></div>`;
  if (label) html += caption(label, SAFE_TOP + 132);
  return { html, frames: f };
}
const HOME_PAD = (() => {
  const banner = BANNER_HEIGHT + SAFE_BOTTOM;
  const p = homeMapPadding(H - banner, SHEET_PEEK, H, homeArrowTargetY(H - banner, SHEET_PEEK, 1));
  return { ...p, bottom: p.bottom + banner };
})();
function pill(text: string, scheme: "light" | "dark"): string {
  const s = SURFACES[scheme];
  // In the street pill's slot (PILL_ABOVE_SHEET = FLOATING_GAP), never wider than the gap to Report.
  const bottom = BANNER_HEIGHT + SAFE_BOTTOM + SHEET_PEEK + 12;
  return `<div style="position:absolute;left:50%;transform:translateX(-50%);max-width:${W - (56 + 16) * 2}px;bottom:${bottom}px;display:flex;align-items:center;gap:10px;background:${s.sheet};border-radius:24px;padding:8px 18px 8px 10px;box-shadow:0 4px 14px rgba(0,0,0,.22);font:600 16px ${FONT};color:${s.text};white-space:nowrap"><img src="${trackyIcon}" style="width:30px;height:30px;border-radius:15px"/>${text}</div>`;
}

// ---------------------------------------------------------------- main
(async () => {
  const notes: Record<string, unknown> = {};
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const shoot = async (dir: string, shot: Shot) => {
    mkdirSync(dir, { recursive: true });
    const r = await render(page, shot);
    await page.screenshot({ path: path.join(dir, `${shot.name}.png`) });
    notes[`${dir}/${shot.name}`] = r;
    console.log(shot.name, JSON.stringify(r).slice(0, 160));
  };

  // ======== docs/waze-match-routes ========
  const ROUTES = "docs/waze-match-routes";
  const from: LngLat = [151.0345, -33.9175]; // Stacey St, Bankstown
  const to: LngLat = [151.0757, -33.9201]; // Lakemba station
  const rs = await realRoutes(from, to);
  notes.routes = rs.map((r) => ({ minutes: Math.round(r.seconds / 60), km: +(r.metres / 1000).toFixed(1), via: r.via }));
  const fitCoords = previewFitCoordinates(rs.map((r) => r.line.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))), { latitude: from[1], longitude: from[0] }, { latitude: to[1], longitude: to[0] }).map((p) => [p.longitude, p.latitude] as LngLat);
  const asLatLng = (line: LngLat[]) => line.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  const top = topCard("Your location", "Lakemba Station", VEHICLE_OPTIONS[0].label);
  for (const state of ["collapsed", "pulled-up"] as const) {
    const sheet = state === "collapsed" ? collapsedSheet(rs[0], "Best route") : expandedSheet(rs, 0);
    const padding = previewEdgePadding(TOP_CARD_BOTTOM, sheet.height);
    // Where the app puts the time bubbles (screenBubbleAnchors, with each bubble's real size).
    const sizes = rs.map((r, i) => bubbleSize(mins(r.seconds), i === 0));
    const anchors = screenBubbleAnchors(rs.map((r) => asLatLng(r.line)), 0, asLatLng(fitCoords), { width: W, height: H }, padding, undefined, 6, sizes);
    const bubbles = rs.flatMap((r, i) => (anchors[i] ? [{ at: [anchors[i]!.longitude, anchors[i]!.latitude] as LngLat, text: mins(r.seconds), tag: i === 0 ? "Best" : undefined, selected: i === 0 }] : []));
    notes[`${state}-bubbles`] = { sizes, placed: anchors.map((a) => !!a) };
    await shoot(ROUTES, {
      name: `route-preview-${state}`,
      scheme: "light",
      fit: { coords: fitCoords, padding },
      routes: rs.map((r, i) => ({ line: r.line, selected: i === 0 })),
      driver: { at: from, heading: 0, dot: true },
      flag: to,
      bubbles,
      overlay: top + sheet.html + caption(`Preview ${state} · real routes · drawn screen`, TOP_CARD_BOTTOM + 8),
      measure: { points: fitCoords, free: padding },
    });
    notes[`${state}-padding`] = padding;
  }
  // The vehicle picker (first run).
  {
    const art = readFileSync("src/components/VehiclePicker.tsx", "utf8");
    const svg = art.slice(art.indexOf("<Svg"), art.indexOf("</Svg>") + 6).replace(/<Svg[^>]*>/, `<svg width="320" height="160" viewBox="0 0 320 160">`).replace("</Svg>", "</svg>").replace(/\{PURPLE\}/g, '"#6A1FD1"').replace(/\{BLUE_TEXT\}/g, '"#0062B8"').replace(/\{BLUE\}/g, '"#0098FF"').replace(/\{\/\*.*?\*\/\}/g, "").replace(/<(\/?)(Circle|Path|Rect)/g, (_m, s, t) => `<${s}${t.toLowerCase()}`).replace(/fill=\{"(.*?)"\}/g, 'fill="$1"').replace(/strokeWidth/g, "stroke-width").replace(/strokeLinecap/g, "stroke-linecap").replace(/strokeLinejoin/g, "stroke-linejoin");
    const title = /VEHICLE_PICKER_TITLE = "(.*?)"/.exec(art)![1];
    const line = /VEHICLE_PICKER_LINE = "(.*?)"/.exec(art)![1];
    const icons: Record<string, string> = {
      car: ICON.car.replace(/width="20" height="20"/, 'width="26" height="26"'),
      motorbike: `<svg width="26" height="26" viewBox="0 0 24 24"><circle cx="5" cy="16" r="3.2" stroke="#1F2125" stroke-width="2" fill="none"/><circle cx="19" cy="16" r="3.2" stroke="#1F2125" stroke-width="2" fill="none"/><path d="M5 16l5-6h5l4 6M14 10l2-4h2" stroke="#1F2125" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
      taxi: `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M10 3h4v3M5 17h14v-4l-2-5H7l-2 5z M7 17v2M17 17v2" stroke="#1F2125" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>`,
    };
    const rows = VEHICLE_OPTIONS.map((o, i) => `<div style="display:flex;align-items:center;gap:16px;min-height:60px;${i > 0 ? "border-top:1px solid #E3E5E9;" : ""}">${icons[o.icon]}<span style="flex:1;font:500 18px ${FONT};color:#1F2125">${o.label}</span>${i === 0 ? ICON.check : '<span style="width:24px"></span>'}</div>`).join("");
    await shoot(ROUTES, {
      name: "vehicle-picker",
      scheme: "light",
      noMap: true,
      overlay: `<div style="position:absolute;inset:0;background:#fff;padding:${SAFE_TOP + 24}px 24px 0"><div style="text-align:center">${svg}</div>
        <div style="text-align:center;font:700 28px ${FONT};color:#1F2125;margin-top:16px">${title}</div>
        <div style="text-align:center;font:400 17px/23px ${FONT};color:#5F6570;margin:8px 0 20px">${line}</div>${rows}</div>
        <div style="position:absolute;left:24px;right:24px;bottom:${SAFE_BOTTOM + 16}px"><div style="height:52px;border-radius:26px;background:#0098FF;display:flex;align-items:center;justify-content:center;font:600 18px ${FONT};color:#fff">Done</div><div style="height:44px;display:flex;align-items:center;justify-content:center;font:600 17px ${FONT};color:${BLUE_TEXT};margin-top:4px">Skip</div></div>
        ${caption("Drawn from the component: same words, rows and art", H - SAFE_BOTTOM - 150)}`,
    });
  }
  // Home map: no feature dots (the style draws no report dots; the app's pins follow the small-icon rule).
  const home: LngLat = [151.0345, -33.9175];
  const homeZoom = mapboxZoomFromGoogle(HOME_FOLLOW_ZOOM);
  await shoot(ROUTES, { name: "home-map", scheme: "light", camera: { center: home, zoom: homeZoom, pitch: 45, bearing: 20, padding: HOME_PAD }, driver: { at: home, heading: 20 }, overlay: homeOverlay("light", "", "Home map · real tiles · no feature dots").html });

  // ======== docs/startup-trackys ========
  const START = "docs/startup-trackys";
  // 1. Loading grid -> loaded map; the controls are at the same frames in both (no jumping).
  for (const scheme of ["light", "dark"] as const) {
    const g = MAP_LOADING_GRID_COLOURS[scheme];
    const grid = `<div style="position:absolute;inset:0;background-color:${g.ground};background-image:linear-gradient(${g.line} 1px,transparent 1px),linear-gradient(90deg,${g.line} 1px,transparent 1px),linear-gradient(${g.major} 1px,transparent 1px),linear-gradient(90deg,${g.major} 1px,transparent 1px);background-size:${GRID_STEP_PX}px ${GRID_STEP_PX}px,${GRID_STEP_PX}px ${GRID_STEP_PX}px,${GRID_STEP_PX * 4}px ${GRID_STEP_PX * 4}px,${GRID_STEP_PX * 4}px ${GRID_STEP_PX * 4}px"></div>`;
    const h = homeOverlay(scheme, "", `Loading · ${scheme} · grid until the first frame`);
    await shoot(START, { name: `1-loading-grid-${scheme}`, scheme, noMap: true, overlay: grid + h.html });
    const loaded = homeOverlay(scheme, "", `Loaded · ${scheme} · controls in the same place`);
    notes[`frames-${scheme}`] = { loading: h.frames, loaded: loaded.frames, same: JSON.stringify(h.frames) === JSON.stringify(loaded.frames) };
    await shoot(START, { name: `2-loaded-${scheme}`, scheme, camera: { center: home, zoom: homeZoom, pitch: 45, bearing: 20, padding: HOME_PAD }, driver: { at: home, heading: 20 }, overlay: loaded.html });
  }
  // 2. "N Trackys around you": the server's own counting code on 37 users seeded like the emulator test.
  {
    const now = Date.now();
    const people: { uid: string; lat: number; lng: number; lastActive: number }[] = [];
    for (let i = 0; i < 37; i++) people.push({ uid: `u${i}`, lat: home[1] + ((i % 7) - 3) * 0.01, lng: home[0] + (Math.floor(i / 7) - 2) * 0.012, lastActive: now - (i % 10) * 60_000 });
    for (let i = 0; i < 6; i++) people.push({ uid: `stale${i}`, lat: home[1], lng: home[0], lastActive: now - 30 * 60_000 }); // not active: not counted
    const result = trackysCore.trackysAround({ lat: home[1], lng: home[0] }, people, now, "me");
    notes.trackysCount = { seeded: people.length, active: 37, result, text: trackysPillText(result) };
    await shoot(START, { name: "3-trackys-banner", scheme: "light", camera: { center: home, zoom: homeZoom, pitch: 45, bearing: 20, padding: HOME_PAD }, driver: { at: home, heading: 20 }, overlay: homeOverlay("light", pill(trackysPillText(result), "light"), "Count from the server's code (trackysCore) on emulator-style seed data", false).html });
  }
  // 3. Standing still, turning the phone 0° -> 120° (with a 1-sample magnetic spike): the arrow turns turret-smooth.
  {
    const filter = new CompassFilter();
    const turret = new HeadingTurret();
    const samples: { t: number; raw: number; arrow: number | null }[] = [];
    for (let t = 0; t <= 2400; t += 50) {
      let raw = t < 300 ? 0 : Math.min(120, ((t - 300) / 600) * 120);
      if (t === 1200) raw = 300; // a spike: rejected
      const c = filter.push({ timeMs: t, heading: raw, accuracyDeg: 10 });
      turret.setTarget(targetHeading({ speedKmh: 0, gps: null, compass: c }));
      samples.push({ t, raw, arrow: turret.step(t) });
    }
    notes.turret = samples;
    const frames = [0, 600, 900, 1200, 1500, 2400];
    for (const t of frames) {
      const s = samples.find((x) => x.t === t)!;
      const chart = `<svg width="358" height="120" style="position:absolute;left:16px;top:${SAFE_TOP + 170}px;background:rgba(255,255,255,.92);border-radius:12px"><polyline fill="none" stroke="#C9CDD3" stroke-width="2" points="${samples.map((x) => `${10 + (x.t / 2400) * 338},${110 - (Math.min(x.raw, 140) / 140) * 100}`).join(" ")}"/><polyline fill="none" stroke="#0098FF" stroke-width="3" points="${samples.filter((x) => x.t <= t).map((x) => `${10 + (x.t / 2400) * 338},${110 - ((x.arrow ?? 0) / 140) * 100}`).join(" ")}"/><text x="14" y="16" font-size="11" font-family="Helvetica">grey: compass in · blue: arrow · spike at 1.2 s ignored</text></svg>`;
      await shoot(START, { name: `4-arrow-still-t${String(t).padStart(4, "0")}`, scheme: "light", camera: { center: home, zoom: homeZoom, pitch: 0, bearing: 0, padding: HOME_PAD }, driver: { at: home, heading: s.arrow ?? 0 }, overlay: homeOverlay("light", chart, `Stopped · t=${(t / 1000).toFixed(1)} s · compass ${Math.round(s.raw)}° · arrow ${Math.round(s.arrow ?? 0)}°`).html });
    }
  }
  // 4. Another driver leaving home: hidden inside their 400 m zone, shown once out, hidden again on arrival.
  {
    const theirHome: LngLat = [151.042, -33.914];
    const theirDest: LngLat = [151.0757, -33.9201];
    const [drive] = await realRoutes(theirHome, theirDest);
    const zones = trackysCore.privateZones({ home: { latitude: theirHome[1], longitude: theirHome[0] }, destination: { latitude: theirDest[1], longitude: theirDest[0] } });
    // Frames: still at home, the first point outside the home zone, mid-drive, and arrived.
    const inZone = drive.line.map((p) => trackysCore.insideAnyZone(p[1], p[0], zones));
    const firstOut = inZone.findIndex((z) => !z);
    const picks = [drive.line[0], drive.line[firstOut], drive.line[Math.floor(drive.line.length / 2)], drive.line[drive.line.length - 1]];
    const seen = picks.map((p) => !trackysCore.insideAnyZone(p[1], p[0], zones));
    notes.zoneFrames = picks.map((p, i) => ({ at: p, shown: seen[i] }));
    const labels = ["leaving home", "out of the zone", "driving", "arriving"];
    for (let i = 0; i < picks.length; i++) {
      await shoot(START, {
        name: `5-trackys-moving-${i + 1}`,
        scheme: "light",
        fit: { coords: [theirHome, theirDest, home], padding: { top: SAFE_TOP + 80, bottom: BANNER_HEIGHT + SAFE_BOTTOM + 170, left: 40, right: 40 } },
        circles: zones.map((z: { latitude: number; longitude: number }) => ({ at: [z.longitude, z.latitude] as LngLat, radiusM: trackysCore.PRIVACY_ZONE_M })),
        driver: { at: home, heading: 60 },
        others: seen[i] ? [{ at: picks[i], label: "Tracky" }] : [],
        overlay: homeOverlay("light", "", `${labels[i]} · ${seen[i] ? "shown" : "hidden (inside a 400 m private zone)"} · real route`).html,
      });
    }
  }
  // Next to your references: drop yours into docs/waze-match-routes/reference/<name>.png|jpg and
  // this writes compare-<name>.png (yours left, ours right).
  for (const name of ["route-preview-collapsed", "route-preview-pulled-up", "vehicle-picker", "home-map"]) {
    const ref = ["png", "jpg", "jpeg"].map((e) => `${ROUTES}/reference/${name}.${e}`).find((f) => existsSync(f));
    if (!ref) continue;
    const mime = ref.endsWith("png") ? "image/png" : "image/jpeg";
    const a = `data:${mime};base64,${readFileSync(ref).toString("base64")}`;
    const b = `data:image/png;base64,${readFileSync(`${ROUTES}/${name}.png`).toString("base64")}`;
    await page.setViewportSize({ width: W * 2 + 24, height: H + 30 });
    await page.setContent(`<body style="margin:0;background:#fff;font:600 13px -apple-system,Helvetica,Arial"><div style="display:flex;gap:24px"><div><div style="height:30px;line-height:30px">Your reference</div><img src="${a}" style="width:${W}px;height:${H}px;object-fit:contain;background:#eee"></div><div><div style="height:30px;line-height:30px">TrackLine (drawn on real tiles)</div><img src="${b}" style="width:${W}px;height:${H}px"></div></div></body>`);
    await page.screenshot({ path: `${ROUTES}/compare-${name}.png` });
    await page.setViewportSize({ width: W, height: H });
  }
  writeFileSync("docs/waze-match-routes/shots.json", JSON.stringify(notes, null, 2));
  writeFileSync("docs/startup-trackys/shots.json", JSON.stringify(notes, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
