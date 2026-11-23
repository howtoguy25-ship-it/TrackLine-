// Gap item 14: detailed road closures. A closure report says which way (your direction or both),
// how much of the road (all lanes or some) and how long (about an hour, today, several days, not
// sure) -- the server checks and keeps these (firebase/functions/reports/core.js closureOf) and the
// "how long" sets the report's lifetime. While driving: the details in the ahead banner, the
// closed stretch drawn on your route, and a full closure (all lanes, your way) on your route is
// routed around (Mapbox `exclude=point(...)`). Pure; tested in __tests__/gap/closures.test.ts.

export type ClosureDirection = "mine" | "both";
export type ClosureLanes = "all" | "some";
export type ClosureUntil = "1h" | "today" | "days" | "unknown";

export interface ClosureDetails {
  direction: ClosureDirection;
  lanes: ClosureLanes;
  until: ClosureUntil;
  /** The reporter's direction of travel, only with direction "mine". */
  bearingDeg?: number;
}

export const DEFAULT_CLOSURE: ClosureDetails = { direction: "both", lanes: "all", until: "unknown" };

export const DIRECTION_LABEL: Record<ClosureDirection, string> = { mine: "My direction", both: "Both directions" };
export const LANES_LABEL: Record<ClosureLanes, string> = { all: "All lanes", some: "Some lanes" };
export const UNTIL_LABEL: Record<ClosureUntil, string> = { "1h": "About an hour", today: "Today", days: "Several days", unknown: "Not sure" };

/** "One direction · All lanes · Today" for the banner and the alert card. */
export function closureLine(c: ClosureDetails | null | undefined): string | null {
  if (!c) return null;
  const dir = c.direction === "mine" ? "One direction" : "Both directions";
  const parts = [dir, LANES_LABEL[c.lanes]];
  if (c.until !== "unknown") parts.push(UNTIL_LABEL[c.until]);
  return parts.join(" · ");
}

/** What a report sends: with "my direction", the way the reporter is driving (or nothing to send). */
export function closureForReport(c: ClosureDetails, headingDeg: number | null): ClosureDetails {
  if (c.direction === "mine") return headingDeg != null && Number.isFinite(headingDeg) ? { ...c, bearingDeg: Math.round(((headingDeg % 360) + 360) % 360) } : { ...c, direction: "both" };
  return { direction: c.direction, lanes: c.lanes, until: c.until };
}

/** A closure you can't get through: all lanes (the feed has already matched the direction). */
export function blocksRoute(c: ClosureDetails | null | undefined): boolean {
  return !!c && c.lanes === "all";
}

type LatLng = { latitude: number; longitude: number };

/** The route's stretch around a closure (HALF_M each side of it), to draw it closed. */
export const CLOSED_STRETCH_HALF_M = 120;
export function closedStretch(polyline: readonly LatLng[], alongM: number, halfM = CLOSED_STRETCH_HALF_M): LatLng[] {
  if (polyline.length < 2) return [];
  const from = Math.max(0, alongM - halfM);
  const to = alongM + halfM;
  const out: LatLng[] = [];
  let acc = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const seg = metres(a, b);
    const s0 = acc;
    const s1 = acc + seg;
    if (s1 >= from && s0 <= to && seg > 0) {
      const t0 = Math.max(0, (from - s0) / seg);
      const t1 = Math.min(1, (to - s0) / seg);
      const p0 = lerp(a, b, t0);
      if (!out.length) out.push(p0);
      out.push(lerp(a, b, t1));
    }
    acc = s1;
    if (acc > to) break;
  }
  return out;
}

function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
}
function metres(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * An ahead closure worth routing around: a driver's "all lanes" closure (the feed has already
 * matched its direction), or a Live Traffic NSW closure that doesn't say it's one direction only
 * ("closed northbound" can't be matched to the driver's way, so it's warned about, not avoided).
 */
export function shouldRouteAround(a: { kind: string; source: string; closure?: ClosureDetails | null; officialText?: string | null }): boolean {
  if (a.kind !== "closure") return false;
  if (a.source === "official") return !/\b(north|south|east|west|in|out)bound\b|\bone direction\b/i.test(a.officialText ?? "");
  return blocksRoute(a.closure);
}
