// Fix pass 5 §6: TrackLine's own roundabout picture -- a circular junction, the way in from the
// bottom, the exit arm highlighted with the path round the circle, and the exit number in the
// middle. Left-hand traffic (Australia, UK...) goes round clockwise; right-hand anticlockwise.
// Pure geometry here (tested in __tests__/fixPass5/roundabout.test.ts); the SVG is
// components/icons/RoundaboutIcon.tsx. Used by the top bar, the directions list and the turn
// callout on the route.
import type { LatLng } from "@/utils/polyline";
import { bearingDegrees, distanceKm } from "@/utils/geo";

export function isRoundabout(maneuver: string | null | undefined): boolean {
  return maneuver === "roundabout-left" || maneuver === "roundabout-right";
}

const norm180 = (d: number) => {
  const x = ((d % 360) + 360) % 360;
  return x > 180 ? x - 360 : x;
};

/**
 * Exit direction relative to the way in: 0 straight on, -90 left, +90 right, 180 back the way
 * you came. From the real geometry when there's enough of it (the road just before the
 * roundabout and the road after it), otherwise from the exit number on a four-arm roundabout.
 */
export function roundaboutExitAngle(o: { exit?: number | null; drivingSide?: "left" | "right"; approach?: LatLng[]; after?: LatLng[] }): number {
  const side = o.drivingSide ?? "left";
  const fromGeometry = geometryAngle(o.approach, o.after);
  if (fromGeometry != null) return fromGeometry;
  const k = Math.min(4, Math.max(1, Math.round(o.exit ?? 2)));
  // Left-hand traffic, clockwise: 1st exit left, 2nd straight on, 3rd right, 4th back.
  const left = [-90, 0, 90, 180][k - 1];
  return side === "left" ? left : left === 180 ? 180 : -left;
}

const metres = (a: LatLng, b: LatLng) => distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;

function geometryAngle(approach?: LatLng[], after?: LatLng[]): number | null {
  if (!approach || approach.length < 2 || !after || after.length < 2) return null;
  const entry = approach[approach.length - 1];
  // The way in: the last ~30 m before the roundabout.
  let back = approach[approach.length - 2];
  for (let i = approach.length - 2; i >= 0; i--) {
    back = approach[i];
    if (metres(back, entry) >= 30) break;
  }
  if (metres(back, entry) < 5) return null;
  // The way out: the road 50-90 m from the entry, well past the circle on a normal roundabout.
  let a: LatLng | null = null;
  let b: LatLng | null = null;
  for (const p of after) {
    const d = metres(entry, p);
    if (!a && d >= 50) a = p;
    else if (a && d >= 90) {
      b = p;
      break;
    }
  }
  if (!a || !b || metres(a, b) < 10) return null;
  const inB = bearingDegrees(back.latitude, back.longitude, entry.latitude, entry.longitude);
  const outB = bearingDegrees(a.latitude, a.longitude, b.latitude, b.longitude);
  return Math.round(norm180(outB - inB));
}

export interface RoundaboutDrawing {
  /** SVG path data on a 64-unit canvas. */
  ring: { cx: number; cy: number; r: number };
  entry: string;
  /** The path from the way in, round the circle the right way, out along the exit arm. */
  route: string;
  arrow: string;
}

const C = 32;
const R_RING = 13;
const R_ARM = 25;
const pt = (thetaDeg: number, r: number) => {
  const t = (thetaDeg * Math.PI) / 180;
  return { x: +(C + r * Math.sin(t)).toFixed(2), y: +(C - r * Math.cos(t)).toFixed(2) };
};

/** How far round the circle you go (degrees, always > 0) to reach an exit at `angle`. */
export function sweepDegrees(angle: number, drivingSide: "left" | "right" = "left"): number {
  // The way in meets the circle at the bottom (θ = 180, clockwise from up).
  const s = drivingSide === "left" ? (((angle - 180) % 360) + 360) % 360 : (((180 - angle) % 360) + 360) % 360;
  return s === 0 ? 340 : s; // a full U-turn: nearly all the way round
}

export function roundaboutDrawing(angle: number, drivingSide: "left" | "right" = "left"): RoundaboutDrawing {
  const sweep = sweepDegrees(angle, drivingSide);
  const clockwise = drivingSide === "left";
  const exitTheta = clockwise ? 180 + sweep : 180 - sweep;
  const enter = pt(180, R_RING);
  const leave = pt(exitTheta, R_RING);
  const end = pt(exitTheta, R_ARM - 4);
  const bottom = pt(180, 31);
  const large = sweep > 180 ? 1 : 0;
  const sweepFlag = clockwise ? 1 : 0;
  // Arrowhead pointing out along the exit arm.
  const tip = pt(exitTheta, R_ARM + 5);
  const t = (exitTheta * Math.PI) / 180;
  const base = pt(exitTheta, R_ARM - 4);
  const px = Math.cos(t) * 7;
  const py = Math.sin(t) * 7;
  return {
    ring: { cx: C, cy: C, r: R_RING },
    entry: `M${bottom.x} ${bottom.y} L${enter.x} ${enter.y}`,
    route: `M${bottom.x} ${bottom.y} L${enter.x} ${enter.y} A${R_RING} ${R_RING} 0 ${large} ${sweepFlag} ${leave.x} ${leave.y} L${end.x} ${end.y}`,
    arrow: `M${tip.x} ${tip.y} L${+(base.x + px).toFixed(2)} ${+(base.y + py).toFixed(2)} L${+(base.x - px).toFixed(2)} ${+(base.y - py).toFixed(2)} Z`,
  };
}
