// Renders the nav-fix acceptance drive (323 Stacey St -> 40 Bazentin St, the real recorded route in
// __tests__/fixtures/manoeuvres/stacey-to-bazentin.json) as frames in docs/nav-fix/. These are
// SIMULATION FRAMES drawn from the app's own pipeline and layout maths (route matcher, preview
// fit, follow camera padding, control frames) -- not screenshots of the app: there is no iOS
// simulator or Mapbox token in this container, so no map tiles. Each frame shows exactly what the
// tests check: the route on screen, the arrow, the line starting at the arrow, and every control.
//   npx jest --roots . --testMatch '**/scripts/sim-drive-nav-fix.ts'   (Jest, for its React Native mocks)
import { test } from "@jest/globals";
import { writeFileSync, mkdirSync } from "fs";
import fx from "../__tests__/fixtures/manoeuvres/stacey-to-bazentin.json";
import { parseMapboxResponse } from "../src/services/mapboxDirections";
import { detailedRoutePolyline } from "../src/services/directions";
import { driveNav } from "../__tests__/support/navDrive";
import { boundsOf, previewEdgePadding, previewFitCoordinates, projectFitted, MAX_SHEET_FRACTION } from "../src/nav/previewCamera";
import { navFollowPadding } from "../src/nav/navCamera";
import { navControlFrames, type Frame } from "../src/nav/navControlsLayout";
import { routeAheadOf } from "../src/map-v2/geo";
import type { LatLng } from "../src/utils/polyline";

test("render the nav-fix acceptance drive frames", () => {
const OUT = "docs/nav-fix";
mkdirSync(OUT, { recursive: true });
const route = parseMapboxResponse(fx)[0];
const line = detailedRoutePolyline(route);
const P = { width: 390, height: 844, safeTop: 47, safeBottom: 34 };
const o = driveNav(route, line, { noise: { seed: 11, jitterMeters: 12, jumpChance: 0.02, signalLoss: [[40, 3], [120, 5]] } });

const poly = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const rect = (f: Frame | undefined, fill: string, label: string, r = 12) =>
  f ? `<rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" rx="${r}" fill="${fill}" opacity="0.92"/><text x="${f.x + f.width / 2}" y="${f.y + f.height / 2 + 4}" font-size="11" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text>` : "";
const svg = (body: string, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${P.width}" height="${P.height}" viewBox="0 0 ${P.width} ${P.height}"><rect width="100%" height="100%" fill="#E9ECEF"/>${body}<text x="8" y="${P.height - 6}" font-size="10" fill="#555" font-family="sans-serif">${title} (simulation frame, not an app screenshot)</text></svg>`;

// 1. Route preview: fitted flat into the space the top card and sheet leave.
{
  const topCard = P.safeTop + 150;
  const sheet = Math.round(P.height * 0.42);
  const pad = previewEdgePadding(topCard, Math.min(sheet, P.height * MAX_SHEET_FRACTION));
  const pts = previewFitCoordinates([line], line[0], line[line.length - 1]);
  const s = projectFitted(line, boundsOf(pts)!, P, pad);
  const body = `<rect x="${pad.left}" y="${pad.top}" width="${P.width - pad.left - pad.right}" height="${P.height - pad.top - pad.bottom}" fill="none" stroke="#999" stroke-dasharray="4 4"/>
<polyline points="${poly(s)}" fill="none" stroke="#6A1FD1" stroke-width="7" stroke-linejoin="round"/>
<circle cx="${s[0].x}" cy="${s[0].y}" r="7" fill="#14B8C8" stroke="#fff" stroke-width="2"/><rect x="${s[s.length - 1].x - 7}" y="${s[s.length - 1].y - 7}" width="14" height="14" fill="#222"/>
<rect x="12" y="${P.safeTop}" width="${P.width - 24}" height="138" rx="16" fill="#1C1D20"/><text x="28" y="${P.safeTop + 40}" fill="#fff" font-size="16" font-family="sans-serif">323 Stacey St → 40 Bazentin St</text>
<rect x="0" y="${P.height - sheet}" width="${P.width}" height="${sheet}" rx="20" fill="#fff"/><text x="24" y="${P.height - sheet + 44}" font-size="22" font-weight="700" font-family="sans-serif">${Math.round(route.durationSeconds / 60)} min · ${(route.distanceMeters / 1000).toFixed(1)} km</text>`;
  writeFileSync(`${OUT}/01-route-preview.svg`, svg(body, "Route preview, fitted"));
}

// 2-5. Driving frames: heading-up, arrow at 70% of the height, route ahead starts at the arrow.
const M_PER_PX = 0.55; // ~zoom 17 at Sydney's latitude
const picks = [0.15, 0.4, 0.65, 0.9].map((f) => Math.floor(o.ticks.length * f));
picks.forEach((idx, n) => {
  const t = o.ticks[idx];
  const at = t.match.snapped;
  const ahead = routeAheadOf(line, at);
  // Heading: along the route a little ahead.
  const nxt = ahead[Math.min(3, ahead.length - 1)];
  const k = Math.cos((at.latitude * Math.PI) / 180);
  const hdg = Math.atan2((nxt.longitude - at.longitude) * k, nxt.latitude - at.latitude);
  const cy = (P.height + navFollowPadding(P.height).top) / 2;
  const toScreen = (p: LatLng) => {
    const dx = ((p.longitude - at.longitude) * k * 111320) / M_PER_PX;
    const dy = ((p.latitude - at.latitude) * 111320) / M_PER_PX;
    const rx = dx * Math.cos(hdg) - dy * Math.sin(hdg);
    const ry = dx * Math.sin(hdg) + dy * Math.cos(hdg);
    return { x: P.width / 2 + rx, y: cy - ry };
  };
  const frames = navControlFrames({ ...P, bottomBarHeight: 110, topBarHeight: 120, showSpeedLimit: true, showRecenter: n === 2 });
  const step = route.steps[Math.min(t.activeStepIndex + 1, route.steps.length - 1)];
  const body = `<polyline points="${poly(ahead.map(toScreen))}" fill="none" stroke="#6A1FD1" stroke-width="11" stroke-linejoin="round" stroke-linecap="round"/>
<g transform="translate(${P.width / 2},${cy})"><path d="M0,-18 L12,14 L0,7 L-12,14 Z" fill="#14B8C8" stroke="#fff" stroke-width="2.5"/></g>
${rect(frames.topBar, "#111", step?.instruction?.slice(0, 44) ?? "", 0)}
${rect(frames.bottomBar, "#2A2C30", "Arrive · ETA", 0)}${rect(frames.speedometer, "#26282C", "Speed", 42)}${rect(frames.speedLimit, "#C0392B", "Limit", 28)}${rect(frames.report, "#E0B400", "Report", 16)}${rect(frames.recenter, "#3C3F44", "Re-centre", 26)}${rect(frames.sound, "#2A2C30", "Sound", 26)}`;
  writeFileSync(`${OUT}/0${n + 2}-driving-${Math.round((t.match.along / route.distanceMeters) * 100)}pct.svg`, svg(body, `Driving, ${Math.round(t.match.along)} m along, step ${t.activeStepIndex}`));
});

writeFileSync(
  `${OUT}/drive-log.json`,
  JSON.stringify(
    {
      route: { from: "Stacey St, Bankstown (near no. 323)", to: "40 Bazentin St, Belfield", meters: route.distanceMeters, steps: route.steps.length },
      gps: "simulated phone GPS: 12 m drift, 2% wild fixes, signal lost for 3 s at 40 s and 5 s at 120 s (seed 11)",
      seconds: o.ticks.length,
      arrived: o.arrived,
      reroutes: o.reroutes.length,
      turnsMissed: [...o.missed],
      progressEvery10s: o.along.filter((_, i) => i % 10 === 0).map((a) => Math.round(a)),
    },
    null,
    2
  ) + "\n"
);
console.log(`wrote ${OUT}: preview + ${picks.length} driving frames, ${o.ticks.length} s, arrived=${o.arrived}, reroutes=${o.reroutes.length}`);
});
