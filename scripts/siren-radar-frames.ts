// Siren radar frames for docs/siren-radar: the top banner, the question card and the report sheet,
// light and dark, drawn at iPhone size (390 x 844 pt) from the components' own sizes, colours and
// words (EmergencyVehicleBanner, SirenQuestionCard, SirenReportPicker, MapScreen placement bar).
// Words come from the same modules the app uses. Run: npx tsx scripts/siren-radar-frames.ts
import { mkdirSync, writeFileSync } from "fs";
import { ACTIONS, SELECTED_TINT, SURFACES, type Scheme } from "../src/theme/colors";
import { CLOSENESS_LABEL, TYPE_LABEL } from "../src/services/sirenTracker";
import { RADAR_DISCLAIMER, VEHICLE_LABEL, WHAT_LABEL, type SirenVehicle, type SirenWhat } from "../src/nav/sirenRadar";

const OUT = "docs/siren-radar";
const W = 390;
const H = 844;
const SAFE_TOP = 47;
const RED = "#D93025";
const BLUE = "#1E6BD6";
const MAP = { light: { land: "#FAFAF9", road: "#DDE1E6", park: "#D3F0CC", route: "#8A3FFC" }, dark: { land: "#1B2230", road: "#3F4D66", park: "#1F3A2A", route: "#A673FF" } };
const FONT = `font-family="Rubik, -apple-system, Helvetica, Arial, sans-serif"`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const text = (x: number, y: number, s: string, size: number, fill: string, weight = 400, anchor = "start") =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ${FONT}>${esc(s)}</text>`;
const shadow = `<filter id="sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.18"/></filter>`;
const siren = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${RED}" stroke="#fff" stroke-width="2"/>` +
  `<g transform="translate(${cx - 14 * (r / 24)},${cy - 14 * (r / 24)}) scale(${r / 24})"><path d="M8 19 V14 a6 6 0 0 1 12 0 V19 Z" fill="#fff"/><rect x="6" y="19.5" width="16" height="3.5" rx="1.5" fill="#fff"/><path d="M14 3 V6.5 M5.5 6.5 L7.8 8.8 M22.5 6.5 L20.2 8.8" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>`;

function map(s: Scheme, route: boolean): string {
  const m = MAP[s];
  return (
    `<rect width="${W}" height="${H}" fill="${m.land}"/>` +
    `<rect x="230" y="300" width="140" height="120" rx="10" fill="${m.park}"/>` +
    [120, 330, 560].map((y) => `<rect x="0" y="${y}" width="${W}" height="14" fill="${m.road}"/>`).join("") +
    [70, 260].map((x) => `<rect x="${x}" y="0" width="12" height="${H}" fill="${m.road}"/>`).join("") +
    (route ? `<path d="M195 ${H} L195 560 L276 560 L276 160" stroke="${m.route}" stroke-width="12" fill="none" stroke-linejoin="round"/>` : "") +
    `<circle cx="195" cy="660" r="14" fill="#0099FF" stroke="#fff" stroke-width="3"/>`
  );
}

function turnCard(): string {
  const top = SAFE_TOP;
  return `<rect x="8" y="${top}" width="${W - 16}" height="104" rx="20" fill="#1C1D20" filter="url(#sh)"/>` + text(84, top + 46, "200 m", 28, "#fff", 700) + text(84, top + 78, "Turn left onto Bexley Rd", 17, "#6CC0FF", 600) + `<path d="M44 ${top + 70} V${top + 40} H28 l16 -16 16 16 H48" stroke="#fff" stroke-width="5" fill="none" stroke-linejoin="round" transform="translate(0,0)"/>`;
}

function banner(s: Scheme, top: number, type: keyof typeof TYPE_LABEL, close: keyof typeof CLOSENESS_LABEL): string {
  const sf = SURFACES[s];
  const h = 96;
  return (
    `<g filter="url(#sh)"><rect x="12" y="${top}" width="${W - 24}" height="${h}" rx="20" fill="${sf.raised}"/></g>` +
    `<clipPath id="cb"><rect x="12" y="${top}" width="${W - 24}" height="${h}" rx="20"/></clipPath>` +
    `<g clip-path="url(#cb)"><rect x="12" y="${top}" width="6" height="${h / 2}" fill="${RED}"/><rect x="12" y="${top + h / 2}" width="6" height="${h / 2}" fill="${BLUE}"/></g>` +
    siren(54, top + h / 2, 24) +
    text(90, top + 30, "Emergency vehicle nearby", 18, sf.text, 700) +
    text(90, top + 54, `${TYPE_LABEL[type]} · ${CLOSENESS_LABEL[close]}`, 15, sf.text, 600) +
    text(90, top + 76, "Slow down and make way when safe", 13, sf.textMuted)
  );
}

function button(x: number, y: number, w: number, label: string, s: Scheme, primary: boolean, h = 44): string {
  const g = primary ? ACTIONS[s].go : ACTIONS[s].alternative;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${g.fill}"/>` + text(x + w / 2, y + h / 2 + 6, label, primary ? 18 : 17, g.on, 600, "middle");
}

function question(s: Scheme, top: number): string {
  const sf = SURFACES[s];
  return (
    `<g filter="url(#sh)"><rect x="12" y="${top}" width="${W - 24}" height="150" rx="20" fill="${sf.raised}"/></g>` +
    siren(48, top + 40, 20) +
    text(80, top + 34, "Did you see an emergency", 17, sf.text, 700) +
    text(80, top + 56, "vehicle or incident?", 17, sf.text, 700) +
    text(80, top + 76, "Say “yes” or “no”", 13, sf.textMuted) +
    button(28, top + 92, 162, "No", s, false) +
    button(200, top + 92, 162, "Yes", s, true)
  );
}

function chips(x0: number, y0: number, labels: string[], selected: string, s: Scheme): { svg: string; bottom: number } {
  let x = x0;
  let y = y0;
  let svg = "";
  for (const l of labels) {
    const w = Math.round(l.length * 7.4 + 28);
    if (x + w > W - 28) {
      x = x0;
      y += 44;
    }
    const sel = l === selected;
    svg += `<rect x="${x}" y="${y}" width="${w}" height="36" rx="18" fill="${sel ? SELECTED_TINT[s] : ACTIONS[s].alternative.fill}"/>` + text(x + w / 2, y + 23, l, 15, sel ? ACTIONS[s].alternative.on : SURFACES[s].text, 600, "middle");
    x += w + 8;
  }
  return { svg, bottom: y + 36 };
}

function reportSheet(): string {
  // The placement bar is drawn on the light sheet in both schemes (styles.placementBar: colors.surface).
  const s: Scheme = "light";
  const sf = SURFACES.light;
  const top = 300;
  let svg = "";
  svg += text(36, top + 30, "Drag the map to where it was", 14, sf.textMuted, 600);
  svg += text(36, top + 56, "What did you see?", 13, sf.textMuted, 600);
  const v = chips(36, top + 66, (Object.keys(VEHICLE_LABEL) as SirenVehicle[]).map((k) => VEHICLE_LABEL[k]), VEHICLE_LABEL.police, s);
  svg += v.svg;
  const ty = v.bottom + 10;
  svg += `<rect x="36" y="${ty}" width="${W - 72}" height="44" rx="12" fill="none" stroke="${sf.divider}"/>` + text(48, ty + 28, "Add a title (optional)", 16, sf.textFaint);
  svg += text(36, ty + 70, "Where was it?", 13, sf.textMuted, 600);
  const q = chips(36, ty + 80, ["↑ Ahead of me", "↓ Behind me", "Where I heard it"], "", s);
  svg += q.svg;
  svg += text(36, q.bottom + 24, "What happened?", 13, sf.textMuted, 600);
  const w2 = chips(36, q.bottom + 34, (Object.keys(WHAT_LABEL) as SirenWhat[]).map((k) => WHAT_LABEL[k]), WHAT_LABEL.passing, s);
  svg += w2.svg;
  const by = w2.bottom + 14;
  svg += button(36, by, 52, "✕", s, false) + button(W - 36 - 130, by, 130, "✓ Report", s, true);
  // The sheet wraps its content (the bar grows up from the bottom).
  return `<g filter="url(#sh)"><rect x="16" y="${top}" width="${W - 32}" height="${by + 44 + 20 - top}" rx="24" fill="${sf.sheet}"/></g>` + svg;
}

function frame(name: string, body: string, caption: string): void {
  writeFileSync(
    `${OUT}/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 40}" viewBox="0 0 ${W} ${H + 40}"><defs>${shadow}</defs>${body}<rect y="${H}" width="${W}" height="40" fill="#111"/>${text(12, H + 25, caption, 12, "#ddd")}</svg>`
  );
}

mkdirSync(OUT, { recursive: true });
for (const s of ["light", "dark"] as Scheme[]) {
  frame(`01-banner-${s}`, map(s, true) + turnCard() + banner(s, SAFE_TOP + 104 + 12, "police", "closer"), `Driving, ${s}: siren heard (3 of 5 windows), getting louder`);
  frame(`02-banner-home-${s}`, map(s, false) + banner(s, SAFE_TOP + 12, "ambulance", "away"), `Not navigating, ${s}: ambulance, moving away`);
  frame(`03-question-${s}`, map(s, false) + question(s, SAFE_TOP + 12), `Stopped after the siren ended, ${s}; goes away after 10 s`);
  frame(
    `04-report-${s}`,
    map(s, false) + `<g transform="translate(173,220)"><path d="M22 0 a18 18 0 0 1 18 18 c0 14 -18 30 -18 30 s-18 -16 -18 -30 a18 18 0 0 1 18 -18z" fill="${RED}"/><circle cx="22" cy="18" r="6" fill="#fff"/></g>` + reportSheet(),
    `Yes -> report, ${s} map: pin starts where it was loudest`
  );
}
writeFileSync(`${OUT}/disclaimer.txt`, RADAR_DISCLAIMER + "\n");
console.log("frames written to", OUT);
