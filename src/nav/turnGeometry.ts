// The real turn angle at a manoeuvre, measured from the route geometry: the bearing of the last
// stretch of road coming in against the first stretch going out. + = right (clockwise).
// Used by crossCheckTurn (nav/manoeuvre.ts) to double-check the provider's left/right.
import { crossCheckTurn } from "@/nav/manoeuvre";
import type { RouteStep } from "@/services/directions";
import type { LatLng } from "@/map-v2/geo";

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

function metres(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.longitude - a.longitude)) * Math.cos(toRad(b.latitude));
  const x =
    Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) -
    Math.sin(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.cos(toRad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Look back/ahead this far from the manoeuvre point, so a kink in the last metre doesn't decide. */
const SPAN_METRES = 25;

function pointBack(line: LatLng[], span: number): { from: LatLng; to: LatLng } | null {
  if (line.length < 2) return null;
  const to = line[line.length - 1];
  let acc = 0;
  for (let i = line.length - 2; i >= 0; i--) {
    acc += metres(line[i], line[i + 1]);
    if (acc >= span || i === 0) return metres(line[i], to) > 0.5 ? { from: line[i], to } : null;
  }
  return null;
}

function pointAhead(line: LatLng[], span: number): { from: LatLng; to: LatLng } | null {
  if (line.length < 2) return null;
  const from = line[0];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    acc += metres(line[i - 1], line[i]);
    if (acc >= span || i === line.length - 1) return metres(from, line[i]) > 0.5 ? { from, to: line[i] } : null;
  }
  return null;
}

/** Signed turn in degrees, (-180, 180], + = right; null when either side is too short. */
export function turnAngleDeg(incoming: LatLng[], outgoing: LatLng[]): number | null {
  const a = pointBack(incoming, SPAN_METRES);
  const b = pointAhead(outgoing, SPAN_METRES);
  if (!a || !b) return null;
  let d = bearing(b.from, b.to) - bearing(a.from, a.to);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Each step's manoeuvre (at the step's end) checked against the geometry into the next step.
 * Mismatches are fixed (geometry wins) and reported through onMismatch for logging.
 */
export function crossCheckSteps(steps: RouteStep[], onMismatch?: (info: { index: number; provider: RouteStep["maneuver"]; turnDeg: number }) => void): RouteStep[] {
  return steps.map((step, i) => {
    const next = steps[i + 1];
    if (!next) return step;
    const turnDeg = turnAngleDeg(step.polyline, next.polyline);
    const { maneuver, corrected } = crossCheckTurn(step.maneuver, turnDeg);
    if (!corrected) return step;
    onMismatch?.({ index: i, provider: step.maneuver, turnDeg: turnDeg as number });
    const side = maneuver?.endsWith("left") ? "left" : "right";
    // The provider's instruction text (and what the voice reads) says the old side: swap it too.
    return { ...step, maneuver, instruction: swapDirectionWords(step.instruction), maneuverSide: step.maneuverSide ? side : step.maneuverSide };
  });
}

/** Logs a provider/geometry disagreement (the geometry was used). */
export function logTurnMismatch(info: { index: number; provider: RouteStep["maneuver"]; turnDeg: number }): void {
  console.warn(`[nav] step ${info.index}: provider said ${info.provider} but the road turns ${Math.round(info.turnDeg)}°; using the geometry`);
}

// Left <-> right words in every voice language the app speaks (services/navLanguage.ts): English,
// Arabic, Spanish, Russian, Turkish. Whole words only, swapped in one pass so they don't undo
// each other. Arabic: يسار / يمين cover يسارًا, اليسار, يمينًا, اليمين.
const PAIRS: [string, string][] = [
  ["left", "right"],
  ["Left", "Right"],
  ["LEFT", "RIGHT"],
  ["يسار", "يمين"],
  ["izquierda", "derecha"],
  ["Izquierda", "Derecha"],
  ["налево", "направо"],
  ["Налево", "Направо"],
  ["левее", "правее"],
  ["левую", "правую"],
  ["левом", "правом"],
  ["левый", "правый"],
  ["sola", "sağa"],
  ["Sola", "Sağa"],
  ["solda", "sağda"],
  ["sol", "sağ"],
];
const SWAP = new Map<string, string>(PAIRS.flatMap(([a, b]) => [[a, b], [b, a]] as [string, string][]));
const WORDS = Array.from(SWAP.keys()).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const WORD_RE = new RegExp(`(?<![\\p{L}])(${WORDS.join("|")})(?![\\p{L}])`, "gu");

export function swapDirectionWords(text: string): string {
  return text.replace(WORD_RE, (w) => SWAP.get(w) ?? w);
}
