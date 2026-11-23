// Renders the ahead-alerts acceptance drive as frames in docs/ahead-alerts/: the real recorded
// Sydney route (323 Stacey St -> 40 Bazentin St, __tests__/fixtures/manoeuvres/stacey-to-bazentin.json)
// driven second by second through the app's own nav pipeline, with injected data in the real
// formats: a mapped speed hump (OSM), a Live Traffic NSW roadwork, a driver's broken-traffic-light
// report, a driver's crash report, and a jam stretch in the route's own speed annotations.
//
// Everything a banner does comes from the app's own code: collectApproachFeatures ->
// aheadSourcesFrom -> projectFeed/aheadOf -> AheadBannerController (on a 100 ms simulated clock),
// and every frame's control positions from navControlFrames (raise + banner progress, the same
// maths the layout test checks). These are SIMULATION FRAMES, not app screenshots: no iOS
// simulator or map tiles in this container.
//   npx jest --roots . --testMatch '**/scripts/sim-drive-ahead-alerts.ts'
import { expect, test } from "@jest/globals";
import { mkdirSync, writeFileSync } from "fs";
import fx from "../__tests__/fixtures/manoeuvres/stacey-to-bazentin.json";
import { parseMapboxResponse } from "../src/services/mapboxDirections";
import { detailedRoutePolyline } from "../src/services/directions";
import { driveNav } from "../__tests__/support/navDrive";
import { collectApproachFeatures } from "../src/alerts/collectFeatures";
import { DEFAULT_SETTINGS } from "../src/services/settings";
import { aheadSourcesFrom } from "../src/nav/ahead/aheadSources";
import { aheadOf, projectFeed, trafficSources, type AheadAlert } from "../src/nav/ahead/aheadFeed";
import { AheadBannerController, type BannerState } from "../src/nav/ahead/bannerController";
import { aheadSourceLine, aheadSubtitle, roadAtAlong } from "../src/nav/ahead/aheadText";
import { distanceText } from "../src/nav/ahead/aheadTiming";
import { AHEAD_BANNER_HEIGHT, aheadRoom, navControlFrames, overlaps, type Frame } from "../src/nav/navControlsLayout";
import { AHEAD_COLOURS } from "../src/theme/colors";
import type { LatLng } from "../src/utils/polyline";

const OUT = "docs/ahead-alerts";
const P = { width: 390, height: 844, safeTop: 47, safeBottom: 34 };
const BAR = 110;
const TOP_BAR = 120;
const ROOM_MS = 160;
const ENTER_MS = 220;
const LEAVE_MS = 220;

test("render the ahead-alerts drive", () => {
  mkdirSync(OUT, { recursive: true });
  const route = parseMapboxResponse(fx)[0];
  const line = detailedRoutePolyline(route);
  const poly = route.polyline;

  // A point on the route at a distance along it.
  const cum = [0];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const k = Math.cos((a.latitude * Math.PI) / 180);
    cum.push(cum[i - 1] + Math.hypot((b.latitude - a.latitude) * 111320, (b.longitude - a.longitude) * 111320 * k));
  }
  const total = cum[cum.length - 1];
  const at = (m: number): LatLng & { index: number } => {
    const i = Math.max(1, cum.findIndex((c) => c >= m));
    const t = (m - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return { latitude: poly[i - 1].latitude + (poly[i].latitude - poly[i - 1].latitude) * t, longitude: poly[i - 1].longitude + (poly[i].longitude - poly[i - 1].longitude) * t, index: i - 1 };
  };

  // ---- injected data, real formats ----
  const NOW = Date.UTC(2026, 10, 22, 22, 0);
  const hump = at(total * 0.18);
  const roadwork = at(total * 0.38);
  const light = at(total * 0.56);
  const jamStart = at(total * 0.72);
  const jamEnd = at(total * 0.8);
  const crash = at(total * 0.75);
  const osm = { trafficLights: [], speedCameras: [], features: { speedBump: [{ id: 501, lat: hump.latitude, lng: hump.longitude }] } } as never;
  const alerts = [
    { id: "lightRpt", type: "traffic_light", item: "trafficLights", lat: light.latitude, lng: light.longitude, createdBy: "someoneElse", createdAt: NOW - 6 * 60000, confirmCount: 2 },
    { id: "crashRpt", type: "crash", item: "crash", lat: crash.latitude, lng: crash.longitude, createdBy: "someoneElse", createdAt: NOW - 3 * 60000, confirmCount: 1 },
  ] as never[];
  const incidents = [
    { id: "ltn-77", kind: "roadwork", category: "Roadwork", headline: "ROADWORK Belfield", where: "Punchbowl Rd, Belfield", delay: "", advice: "2 lanes closed", major: false, lat: roadwork.latitude, lng: roadwork.longitude, updatedAt: NOW - 3600000 },
  ] as never[];
  const settings = { ...DEFAULT_SETTINGS, reportPrefs: { speedBump: { show: true, alert: true }, trafficLights: { show: true, alert: true }, traffic: { show: true, alert: true } } } as never;
  const features = collectApproachFeatures(settings, { osm, alerts, incidents, ownUid: "me" });
  const sources = [
    ...aheadSourcesFrom(features, alerts as never, incidents as never),
    ...trafficSources(poly, [{ startIndex: jamStart.index, endIndex: jamEnd.index + 1, speed: "TRAFFIC_JAM" }], () => 300),
  ];
  const projected = projectFeed(sources, poly);
  expect(projected.map((a) => a.kind)).toEqual(["hump", "roadwork", "brokenLight", "crash"]);

  // ---- drive it ----
  const o = driveNav(route, line, { speedKmh: 50 });
  let clock = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const ctl = new AheadBannerController(
    { setTimeout: (fn, ms) => (timers.push({ at: clock + ms, fn, id: nextId }), nextId++), clearTimeout: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    },
    () => clock
  );
  const spoken: string[] = [];
  ctl.setOnShow((a, reminder) => spoken.push(`${(clock / 1000).toFixed(1)} s  ${reminder ? "reminder" : "show"}  ${a.title}`));
  const timeline: { t: number; s: BannerState; along: number }[] = [];
  let along = 0;
  for (let sec = 0; sec < o.ticks.length; sec++) {
    for (let step = 0; step < 10; step++) {
      clock = sec * 1000 + step * 100;
      timers.sort((a, b) => a.at - b.at);
      while (timers.length && timers[0].at <= clock) timers.shift()!.fn();
      if (step === 0) {
        along = o.ticks[sec].match.along;
        ctl.update({ feed: aheadOf(projected, along), carAlongM: along, speedMps: 50 / 3.6, manoeuvreBusy: false });
      }
      timeline.push({ t: clock, s: ctl.getState(), along });
    }
  }
  ctl.reset("end");
  expect(ctl.activeTimers()).toBe(0);

  // Phase start times, for the motion each frame shows (the banner component's choreography).
  const starts = new Map<string, { enter: number; leave: number | null }>();
  for (const { t, s } of timeline) {
    if (!s.alert) continue;
    const k = `${s.seq}`;
    if (!starts.has(k)) starts.set(k, { enter: t, leave: null });
    if (s.phase === "leaving" && starts.get(k)!.leave === null) starts.get(k)!.leave = t;
  }
  const motion = (t: number, s: BannerState) => {
    const st = starts.get(`${s.seq}`);
    if (!s.alert || !st) return { room: 0, banner: 0 };
    if (st.leave !== null && t >= st.leave) {
      const b = Math.max(0, 1 - (t - st.leave) / LEAVE_MS);
      const r = t - st.leave < LEAVE_MS ? 1 : Math.max(0, 1 - (t - st.leave - LEAVE_MS) / ROOM_MS);
      return { room: r, banner: b };
    }
    return { room: Math.min(1, (t - st.enter) / ROOM_MS), banner: Math.max(0, Math.min(1, (t - st.enter - ROOM_MS) / ENTER_MS)) };
  };

  // ---- draw ----
  // One line each, as the app draws them (numberOfLines={1}).
  const clip = (x: string, n: number) => (x.length > n ? `${x.slice(0, n - 1)}…` : x);
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const box = (f: Frame | undefined, fill: string, label: string, r = 12) =>
    f ? `<rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" rx="${r}" fill="${fill}" opacity="0.95"/><text x="${f.x + f.width / 2}" y="${f.y + f.height / 2 + 4}" font-size="11" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text>` : "";
  const M_PER_PX = 0.55;
  const frameSvg = (t: number, s: BannerState, carAlong: number, title: string) => {
    const m = motion(t, s);
    const f = navControlFrames({
      ...P,
      bottomBarHeight: BAR,
      topBarHeight: TOP_BAR,
      showSpeedLimit: true,
      showRecenter: false,
      showCompass: true,
      showSound: true,
      showVoice: true,
      showStreetChip: true,
      raiseBy: m.room * aheadRoom(AHEAD_BANNER_HEIGHT),
      aheadBanner: s.alert ? { height: AHEAD_BANNER_HEIGHT, progress: m.banner } : null,
    });
    expect(overlaps(f)).toEqual([]);
    // The map: route ahead, heading-up, car at 70% of the height; ahead pins within 1.5 km.
    const car = at(carAlong);
    const nxt = at(Math.min(total, carAlong + 30));
    const k = Math.cos((car.latitude * Math.PI) / 180);
    const hdg = Math.atan2((nxt.longitude - car.longitude) * k, nxt.latitude - car.latitude);
    const cx = P.width / 2;
    const cy = P.height * 0.7;
    const proj = (p: LatLng) => {
      const dx = (p.longitude - car.longitude) * 111320 * k;
      const dy = (p.latitude - car.latitude) * 111320;
      const x = dx * Math.cos(hdg) - dy * Math.sin(hdg);
      const y = dx * Math.sin(hdg) + dy * Math.cos(hdg);
      return { x: cx + x / M_PER_PX, y: cy - y / M_PER_PX };
    };
    const ahead = poly.filter((_, i) => cum[i] >= carAlong - 5).map(proj);
    const pins = aheadOf(projected, carAlong).filter((a) => a.aheadM <= 1500).slice(0, 3);
    const pinSvg = pins
      .map((a) => {
        const p = proj({ latitude: a.lat, longitude: a.lng });
        const c = AHEAD_COLOURS[a.kind];
        return `<line x1="${p.x}" y1="${p.y}" x2="${p.x}" y2="${p.y - 14}" stroke="${c.fill}" stroke-width="3"/><circle cx="${p.x}" cy="${p.y - 30}" r="17" fill="${c.fill}" stroke="#fff" stroke-width="3"/><text x="${p.x}" y="${p.y - 26}" font-size="10" text-anchor="middle" fill="${c.glyph}" font-family="sans-serif">${a.kind.slice(0, 4)}</text>`;
      })
      .join("");
    let bannerSvg = "";
    if (s.alert && f.aheadBanner) {
      const b = f.aheadBanner;
      const a: AheadAlert = s.alert;
      const c = AHEAD_COLOURS[a.kind];
      const sub = aheadSubtitle(a, roadAtAlong(route.steps, a.alongM), "km", NOW) ?? "";
      bannerSvg = `<g opacity="${m.banner.toFixed(2)}"><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="20" fill="#26282C"/><rect x="${b.x}" y="${b.y}" width="6" height="${b.height}" fill="${c.fill}"/>
<circle cx="${b.x + 42}" cy="${b.y + 40}" r="28" fill="${c.fill}"/><text x="${b.x + 42}" y="${b.y + 44}" font-size="11" text-anchor="middle" fill="${c.glyph}" font-family="sans-serif">${a.kind}</text>
<text x="${b.x + 82}" y="${b.y + 30}" font-size="20" font-weight="700" fill="#fff" font-family="sans-serif">${esc(clip(a.title, 20))}</text>
<text x="${b.x + 82}" y="${b.y + 52}" font-size="14" fill="#BDC1C6" font-family="sans-serif">${esc(clip(sub, 30))}</text>
<text x="${b.x + 82}" y="${b.y + 70}" font-size="12" fill="#BDC1C6" font-family="sans-serif">${esc(aheadSourceLine(a))}${s.reminder ? " · reminder" : ""}</text>
<text x="${b.x + b.width - 14}" y="${b.y + 46}" font-size="22" font-weight="700" text-anchor="end" fill="#fff" font-family="sans-serif">${distanceText(Math.max(0, s.aheadM), "km")}</text></g>`;
    }
    const body = `<polyline points="${ahead.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" fill="none" stroke="#6A1FD1" stroke-width="11" stroke-linejoin="round"/>
${pinSvg}<polygon points="${cx},${cy - 16} ${cx - 11},${cy + 10} ${cx},${cy + 4} ${cx + 11},${cy + 10}" fill="#14B8C8" stroke="#fff" stroke-width="2"/>
${box(f.topBar, "#1C1D20", "turn instruction", 0)}${box(f.bottomBar, "#1C1D20", "ETA bar", 0)}${box(f.compass, "#555", "compass", 26)}${box(f.sound, "#555", "sound", 26)}${box(f.voice, "#555", "voice", 26)}
${box(f.speedLimit, "#C62828", "limit", 28)}${box(f.speedometer, "#1C1D20", "50", 42)}${box(f.report, "#E0A800", "Report", 14)}${box(f.streetChip, "#26282C", "street", 14)}${bannerSvg}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${P.width}" height="${P.height}" viewBox="0 0 ${P.width} ${P.height}"><rect width="100%" height="100%" fill="#E9ECEF"/>${body}<text x="8" y="${P.height - 6}" font-size="10" fill="#555" font-family="sans-serif">${esc(title)} (simulation frame, not an app screenshot)</text></svg>`;
  };

  // Each banner's first "shown" frame (+ the map pins), and for the first three in a row the
  // whole slide in / hold / slide out.
  const shownOnce = new Set<number>();
  const log: string[] = [];
  let n = 1;
  for (const { t, s, along: a } of timeline) {
    if (!s.alert || shownOnce.has(s.seq)) continue;
    const st = starts.get(`${s.seq}`)!;
    if (t < st.enter + 1500) continue;
    shownOnce.add(s.seq);
    const name = `${String(n).padStart(2, "0")}-${s.alert.kind}${s.reminder ? "-reminder" : ""}.svg`;
    writeFileSync(`${OUT}/${name}`, frameSvg(t, s, a, `${s.alert.title}, ${Math.round(s.aheadM)} m ahead, ${(t / 1000).toFixed(1)} s`));
    log.push(`${name}: ${s.alert.title} · ${aheadSubtitle(s.alert, roadAtAlong(route.steps, s.alert.alongM), "km", NOW) ?? ""} · ${distanceText(s.aheadM, "km")}`);
    n++;
  }
  const seqs = [...starts.keys()].slice(0, 3);
  const seqFrames: string[] = [];
  for (const k of seqs) {
    const st = starts.get(k)!;
    const marks = [st.enter + 80, st.enter + ROOM_MS + 110, st.enter + 1000, ...(st.leave !== null ? [st.leave + 110, st.leave + LEAVE_MS + 80] : [])];
    for (const mt of marks) {
      const row = timeline.find((r) => r.t >= mt - 50 && r.t <= mt + 50) ?? timeline.find((r) => r.t >= mt);
      if (!row) continue;
      const s = row.s;
      const name = `seq-${k}-${String(mt - st.enter).padStart(5, "0")}ms.svg`;
      writeFileSync(`${OUT}/${name}`, frameSvg(row.t, s, row.along, `Banner ${k}: ${(row.t - st.enter)} ms after it starts`));
      seqFrames.push(name);
    }
  }
  writeFileSync(`${OUT}/drive-log.json`, JSON.stringify({ route: "323 Stacey St -> 40 Bazentin St (recorded)", lengthM: Math.round(total), spoken, frames: log, sequence: seqFrames }, null, 2));
  expect(spoken.filter((l) => l.includes("show")).length).toBeGreaterThanOrEqual(4);
});
