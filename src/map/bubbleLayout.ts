// Fix pass 5 §2: where each route's time bubble goes in the route preview. One solver, pure,
// tested in __tests__/fixPass5/bubbles.test.ts.
//
//  * Each bubble anchors on a point of ITS route where that route is furthest from the others
//    (its own stretch), and sits BESIDE the line -- above, below, right or left of the point --
//    with an 8 pt tail touching the line. The bubble's box never crosses any route line (its own
//    included: only the tail touches it), another bubble, the destination flag or the start dot,
//    and stays inside the map area the top card and the sheet leave.
//  * No room at full size: other points along the route are tried; then (alternatives only) a
//    compact "+2 min" chip; still nothing: that alternative has no bubble (its line and its row
//    in the list remain). The selected route always gets its bubble.
//  * Text: the selected route shows its time and tag ("12 min" / "Best"); alternatives show
//    their difference from it ("+1 min", "−3 min", "Same time").
import type { LatLng } from "@/utils/polyline";
import { boundsOf, projectFitted, type EdgePadding } from "@/nav/previewCamera";
import { distanceToPolylineMeters, samplePolyline } from "@/map/routeChoices";

export type BubbleSide = "above" | "below" | "right" | "left";
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Pt {
  x: number;
  y: number;
}

export const BUBBLE_TAIL = 8;
export const BUBBLE_GAP = 6;

/** Body sizes (without the tail), matching RouteTimeBubble's padding and line heights. */
export function bubbleBody(text: string, kind: "selected" | "alternative" | "compact"): { width: number; height: number } {
  if (kind === "compact") return { width: Math.max(52, Math.round(20 + 8.5 * text.length)), height: 28 };
  return { width: Math.max(72, Math.round(26 + 10 * text.length)), height: kind === "selected" ? 52 : 34 };
}

/** "+1 min", "−3 min", "Same time": an alternative compared with the selected route. */
export function timeDifferenceText(altSeconds: number, selectedSeconds: number): string {
  const d = Math.round((altSeconds - selectedSeconds) / 60);
  if (d === 0) return "Same time";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} min`;
}

/** The bubble's box for a tail tip at `p` on the given side. */
export function bubbleRect(p: Pt, side: BubbleSide, size: { width: number; height: number }): Rect {
  const { width: w, height: h } = size;
  switch (side) {
    case "above":
      return { x0: p.x - w / 2, x1: p.x + w / 2, y1: p.y - BUBBLE_TAIL, y0: p.y - BUBBLE_TAIL - h };
    case "below":
      return { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y + BUBBLE_TAIL, y1: p.y + BUBBLE_TAIL + h };
    case "right":
      return { x0: p.x + BUBBLE_TAIL, x1: p.x + BUBBLE_TAIL + w, y0: p.y - h / 2, y1: p.y + h / 2 };
    case "left":
      return { x1: p.x - BUBBLE_TAIL, x0: p.x - BUBBLE_TAIL - w, y0: p.y - h / 2, y1: p.y + h / 2 };
  }
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return !(a.x1 + gap <= b.x0 || b.x1 + gap <= a.x0 || a.y1 + gap <= b.y0 || b.y1 + gap <= a.y0);
}

function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  // Liang–Barsky clip: does segment ab pass through the rectangle?
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: [number, number][] = [
    [-dx, a.x - r.x0],
    [dx, r.x1 - a.x],
    [-dy, a.y - r.y0],
    [dy, r.y1 - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

export function lineHitsRect(line: Pt[], r: Rect): boolean {
  for (let i = 1; i < line.length; i++) if (segmentHitsRect(line[i - 1], line[i], r)) return true;
  return line.length === 1 && line[0].x >= r.x0 && line[0].x <= r.x1 && line[0].y >= r.y0 && line[0].y <= r.y1;
}

export interface BubbleRoute {
  line: LatLng[];
  /** Full-size text ("12 min" or "+1 min") and the compact chip's text. */
  text: string;
  compactText: string;
}
export interface PlacedBubble {
  anchor: LatLng;
  side: BubbleSide;
  compact: boolean;
  rect: Rect;
}

/** Things bubbles must not cover, in screen points relative to a ground point. */
export interface Obstacle {
  at: LatLng;
  /** Box around the point: offsets in screen points (e.g. the flag: x -9..31, y -46..0). */
  box: Rect;
}

const SIDES: BubbleSide[] = ["above", "below", "right", "left"];

export function layoutRouteBubbles(
  routes: BubbleRoute[],
  selected: number,
  fitPoints: LatLng[],
  viewport: { width: number; height: number },
  padding: EdgePadding,
  obstacles: Obstacle[] = []
): (PlacedBubble | null)[] {
  const result: (PlacedBubble | null)[] = routes.map(() => null);
  const fit = boundsOf(fitPoints);
  if (!fit) return result;
  const project = (pts: LatLng[]) => projectFitted(pts, fit, viewport, padding);
  const screenLines = routes.map((r) => project(r.line));
  const blocked: Rect[] = obstacles.map((o) => {
    const p = project([o.at])[0];
    return { x0: p.x + o.box.x0, x1: p.x + o.box.x1, y0: p.y + o.box.y0, y1: p.y + o.box.y1 };
  });
  const inside = (r: Rect) => r.x0 >= padding.left && r.x1 <= viewport.width - padding.right && r.y0 >= padding.top && r.y1 <= viewport.height - padding.bottom;
  const placed: Rect[] = [];
  const clear = (r: Rect) => inside(r) && !placed.some((o) => rectsOverlap(r, o, BUBBLE_GAP)) && !blocked.some((o) => rectsOverlap(r, o, 2)) && !screenLines.some((l) => lineHitsRect(l, r));

  const order = [selected, ...routes.map((_, i) => i).filter((i) => i !== selected)];
  for (const i of order) {
    const route = routes[i];
    if (!route || route.line.length === 0) continue;
    const samples = samplePolyline(route.line, 61).slice(3, -3);
    const candidates = samples.length ? samples : [route.line[Math.floor(route.line.length / 2)]];
    const others = routes.filter((_, j) => j !== i).map((r) => r.line);
    // Its own stretch first: furthest from the other routes, then nearest the middle.
    const ranked = candidates
      .map((c, k) => ({ c, k, apart: others.length ? Math.min(...others.map((o) => distanceToPolylineMeters(c, o))) : 0 }))
      .sort((a, b) => Math.min(b.apart, 400) - Math.min(a.apart, 400) || Math.abs(a.k - candidates.length / 2) - Math.abs(b.k - candidates.length / 2));
    const screen = project(ranked.map((r) => r.c));
    const kinds: ("full" | "compact")[] = i === selected ? ["full"] : ["full", "compact"];
    let done: PlacedBubble | null = null;
    for (const kind of kinds) {
      const size = bubbleBody(kind === "full" ? route.text : route.compactText, kind === "compact" ? "compact" : i === selected ? "selected" : "alternative");
      for (let n = 0; n < ranked.length && !done; n++) {
        for (const side of SIDES) {
          const rect = bubbleRect(screen[n], side, size);
          if (clear(rect)) {
            done = { anchor: ranked[n].c, side, compact: kind === "compact", rect };
            break;
          }
        }
      }
      if (done) break;
    }
    if (!done && i === selected) {
      // The selected route always shows its time: the spot with the fewest lines crossed.
      const size = bubbleBody(route.text, "selected");
      let best: { score: number; n: number; side: BubbleSide; rect: Rect } | null = null;
      for (let n = 0; n < ranked.length; n++) {
        for (const side of SIDES) {
          const rect = bubbleRect(screen[n], side, size);
          const score = screenLines.filter((l) => lineHitsRect(l, rect)).length + (placed.some((o) => rectsOverlap(rect, o, BUBBLE_GAP)) ? 10 : 0) + (inside(rect) ? 0 : 100);
          if (!best || score < best.score) best = { score, n, side, rect };
        }
      }
      if (best) done = { anchor: ranked[best.n].c, side: best.side, compact: false, rect: best.rect };
    }
    if (done) {
      placed.push(done.rect);
      result[i] = done;
    }
  }
  return result;
}

/** The marker anchor for a side: where the tail tip sits on the bubble view. */
export function markerAnchorFor(side: BubbleSide): { x: number; y: number } {
  return side === "above" ? { x: 0.5, y: 1 } : side === "below" ? { x: 0.5, y: 0 } : side === "right" ? { x: 0, y: 0.5 } : { x: 1, y: 0.5 };
}
