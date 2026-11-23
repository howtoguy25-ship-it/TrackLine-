// Live road view frames for docs/live-road-view: the panel as LiveRoadView draws it (same
// projection, sizes and colours from nav/liveScene.ts), over a navigation screen, light and dark.
// The vehicles are an example scene (what three tracked boxes from the camera turn into) — on the
// phone only what the camera really tracks is drawn. Run: npx tsx scripts/live-road-view-frames.ts
import { mkdirSync, writeFileSync } from "fs";
import { KIND_SIZE, LANE_WIDTH_M, ME_Z_M, liveViewHeight, project, sceneFromTracks, type LocalPoint, type SceneVehicle } from "../src/nav/liveScene";
import { AMBER, PURPLE_BRIGHT } from "../src/theme/colors";

const OUT = "docs/live-road-view";
const W = 390;
const H = 844;
const PANEL_W = W - 24;
const PANEL_H = liveViewHeight(H);
const PAL = {
  dark: { sky: "#0E1218", ground: "#151A22", road: "#262D38", edge: "#5B6472", lane: "#7C8594", body: "#C9CED6", top: "#E6E9EE", me: "#5DB4FF", land: "#1B2230", mroad: "#3F4D66", text: "#FFFFFF" },
  light: { sky: "#E9EDF2", ground: "#DDE2E8", road: "#C3CAD3", edge: "#8A94A2", lane: "#F7F8FA", body: "#59616D", top: "#7A828E", me: "#1E6BD6", land: "#FAFAF9", mroad: "#DDE1E6", text: "#1F2125" },
};
const FONT = `font-family="Rubik, -apple-system, Helvetica, Arial, sans-serif"`;
const view = { width: PANEL_W, height: PANEL_H };

function offsetPath(path: LocalPoint[], o: number): LocalPoint[] {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: p.x + ((b.z - a.z) / len) * o, z: p.z - ((b.x - a.x) / len) * o };
  });
}
function d(path: LocalPoint[]): string {
  let s = "";
  for (const p of path) {
    const q = project(p, view);
    if (q) s += `${s ? "L" : "M"}${q.u.toFixed(1)} ${q.v.toFixed(1)} `;
  }
  return s;
}
function box(v: { x: number; z: number; kind: SceneVehicle["kind"]; close?: boolean }, c: (typeof PAL)["dark"], me = false): string {
  const s = KIND_SIZE[v.kind];
  const hw = s.w / 2;
  const P = (x: number, z: number, h = 0) => project({ x, z }, view, h)!;
  const pts = (a: { u: number; v: number }[]) => a.map((p) => `${p.u.toFixed(1)},${p.v.toFixed(1)}`).join(" ");
  const back = [P(v.x - hw, v.z), P(v.x + hw, v.z), P(v.x + hw, v.z, s.h), P(v.x - hw, v.z, s.h)];
  const top = [P(v.x - hw, v.z, s.h), P(v.x + hw, v.z, s.h), P(v.x + hw, v.z + s.l, s.h), P(v.x - hw, v.z + s.l, s.h)];
  const fill = me ? c.me : v.close ? AMBER : c.body;
  return `<polygon points="${pts(top)}" fill="${me ? c.me : v.close ? AMBER : c.top}" opacity="0.95"/><polygon points="${pts(back)}" fill="${fill}"/>`;
}

function frame(scheme: "light" | "dark"): string {
  const c = PAL[scheme];
  // Route: straight 40 m, then bearing right (a gentle curve), in the car's frame.
  const route: LocalPoint[] = [];
  for (let z = 0; z <= 100; z += 5) route.push({ x: z < 40 ? 0 : ((z - 40) ** 2) / 220, z });
  // Three tracked camera boxes (720 px wide frame) -> scene vehicles, exactly as the app converts them.
  const vehicles = sceneFromTracks(
    [
      { id: 1, bbox: [318, 380, 84, 60], cls: "car", distanceM: 11 },
      { id: 2, bbox: [470, 330, 60, 40], cls: "truck", distanceM: 30 },
      { id: 3, bbox: [250, 340, 40, 28], cls: "car", distanceM: 34 },
    ],
    720
  );
  const half = LANE_WIDTH_M * 1.5;
  const L = offsetPath(route, -half);
  const R = offsetPath(route, half).reverse();
  const panelY = H - 34 - 76 - 8 - PANEL_H;
  const panel =
    `<g transform="translate(12,${panelY})"><clipPath id="pc"><rect width="${PANEL_W}" height="${PANEL_H}" rx="20"/></clipPath><g clip-path="url(#pc)">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.sky}"/><stop offset="0.25" stop-color="${c.ground}"/></linearGradient></defs>` +
    `<rect width="${PANEL_W}" height="${PANEL_H}" fill="url(#g)"/>` +
    `<path d="${d(L)} L${d(R).slice(1)} Z" fill="${c.road}"/>` +
    `<path d="${d(offsetPath(route, -half))}" stroke="${c.edge}" stroke-width="2" fill="none"/><path d="${d(offsetPath(route, half))}" stroke="${c.edge}" stroke-width="2" fill="none"/>` +
    [-LANE_WIDTH_M / 2, LANE_WIDTH_M / 2].map((o) => `<path d="${d(offsetPath(route, o))}" stroke="${c.lane}" stroke-width="2" stroke-dasharray="10 12" fill="none"/>`).join("") +
    `<path d="${d(route.filter((p) => p.z >= ME_Z_M))}" stroke="${PURPLE_BRIGHT}" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.9"/>` +
    vehicles.map((v) => box(v, c)).join("") +
    box({ x: 0, z: ME_Z_M, kind: "car" }, c, true) +
    `<rect x="10" y="8" width="150" height="26" rx="13" fill="${scheme === "dark" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.85)"}"/><text x="20" y="26" font-size="13" font-weight="600" fill="${c.text}" ${FONT}>Live view · ${vehicles.length} vehicles</text>` +
    `<text x="${PANEL_W - 26}" y="28" font-size="20" fill="${c.text}" ${FONT}>✕</text>` +
    `<rect x="${PANEL_W - 82}" y="${PANEL_H - 64}" width="72" height="54" rx="8" fill="#3A3F47" stroke="#fff"/><text x="${PANEL_W - 46}" y="${PANEL_H - 32}" font-size="9" fill="#fff" text-anchor="middle" ${FONT}>camera</text>` +
    `</g></g>`;
  const map =
    `<rect width="${W}" height="${H}" fill="${c.land}"/>` +
    [140, 360].map((y) => `<rect x="0" y="${y}" width="${W}" height="14" fill="${c.mroad}"/>`).join("") +
    [90, 280].map((x) => `<rect x="${x}" y="0" width="12" height="${H}" fill="${c.mroad}"/>`).join("") +
    `<path d="M195 ${panelY} L195 230 L286 230 L286 0" stroke="#8A3FFC" stroke-width="12" fill="none"/>` +
    `<path d="M195 ${panelY - 70} l-14 26 14 -8 14 8z" fill="#0099FF" stroke="#fff" stroke-width="2"/>`;
  const top = `<rect x="8" y="47" width="${W - 16}" height="104" rx="20" fill="#1C1D20"/><text x="84" y="93" font-size="28" font-weight="700" fill="#fff" ${FONT}>350 m</text><text x="84" y="125" font-size="17" font-weight="600" fill="#6CC0FF" ${FONT}>Keep right onto M5</text>`;
  const eta = `<rect x="0" y="${H - 34 - 76}" width="${W}" height="${76 + 34}" fill="${scheme === "dark" ? "#1C1D20" : "#FFFFFF"}"/><text x="24" y="${H - 34 - 34}" font-size="22" font-weight="700" fill="${c.text}" ${FONT}>12 min · 8.4 km</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 40}">${map}${top}${panel}${eta}<rect y="${H}" width="${W}" height="40" fill="#111"/><text x="12" y="${H + 25}" font-size="12" fill="#ddd" ${FONT}>Live road view, ${scheme}: example of 3 tracked boxes (car 11 m, truck 30 m, car 34 m)</text></svg>`;
}

mkdirSync(OUT, { recursive: true });
for (const s of ["light", "dark"] as const) writeFileSync(`${OUT}/live-road-view-${s}.svg`, frame(s));
console.log("frames written to", OUT);
