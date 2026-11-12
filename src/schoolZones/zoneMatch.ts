// Which school zone (if any) the car is in. Official zones are ~12 m bands along the road
// itself, so the car counts as in a zone only when it's inside the band (or within 8 m of it,
// for GPS error) AND travelling along it -- a cross street at the corner, or a parallel road
// 15 m away, doesn't pick up the zone.

import { decodePolyline, type LatLng } from "@/utils/polyline";
import type { SchoolZone } from "@/schoolZones/zoneStatus";

/** A zone as stored per tile (firebase/functions/schoolZonesCore.js toZone, minus terms). */
export interface StoredZone {
  id: string;
  name: string | null;
  region: string;
  timezone: string;
  speedKmh: number;
  windows: [string, string][];
  lateOpening: boolean;
  oneWay: boolean;
  polygons: string[];
  bbox: [number, number, number, number];
}

export interface ZoneShape {
  zone: SchoolZone;
  rings: LatLng[][];
  bbox: [number, number, number, number];
  oneWay: boolean;
}

export const NEAR_BAND_METERS = 8;
/** Heading within this of the band's direction (either way along it) counts as "along". */
export const ALONG_BAND_DEG = 40;

export function toShape(z: StoredZone): ZoneShape {
  return {
    zone: {
      id: z.id,
      source: "TfNSW",
      region: z.region,
      timezone: z.timezone,
      limit: { value: z.speedKmh, unit: "km/h" },
      windows: z.windows,
      lateOpening: z.lateOpening,
      name: z.name ?? undefined,
    },
    rings: z.polygons.map((p) => decodePolyline(p, 6)),
    bbox: z.bbox,
    oneWay: z.oneWay,
  };
}

const rad = (d: number) => (d * Math.PI) / 180;

function xy(p: LatLng, lat0: number): [number, number] {
  return [rad(p.longitude) * Math.cos(rad(lat0)) * 6_371_000, rad(p.latitude) * 6_371_000];
}

function inside(p: LatLng, ring: LatLng[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.latitude > p.latitude !== b.latitude > p.latitude && p.longitude < ((b.longitude - a.longitude) * (p.latitude - a.latitude)) / (b.latitude - a.latitude) + a.longitude) c = !c;
  }
  return c;
}

/**
 * Distance to the ring's edge (m), and whether the car's heading runs along the zone here: some
 * substantial edge (15 m or more -- longer than the ~12 m end caps) within 20 m points the way the
 * car is going, either direction. Official zones often take in short stretches of side streets;
 * driving along one of those is in the zone, crossing the zone's road on a street that isn't part
 * of it is not.
 */
export const EDGE_MIN_METERS = 15;
export const EDGE_NEAR_METERS = 20;

function edgeInfo(p: LatLng, ring: LatLng[], heading: number | null): { d: number; aligned: boolean } {
  const [px, py] = xy(p, p.latitude);
  let best = Infinity;
  let aligned = heading === null;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = xy(ring[i], p.latitude);
    const [bx, by] = xy(ring[i + 1], p.latitude);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    best = Math.min(best, d);
    if (!aligned && len2 >= EDGE_MIN_METERS ** 2 && d <= EDGE_NEAR_METERS) {
      const brg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
      if (along(heading!, brg)) aligned = true;
    }
  }
  return { d: best, aligned };
}

const along = (heading: number, bandBearing: number) => {
  const diff = Math.abs(((heading - bandBearing + 540) % 360) - 180);
  return diff <= ALONG_BAND_DEG || diff >= 180 - ALONG_BAND_DEG;
};

/** The zone the car is in, or null. `heading` null (stationary / unknown) skips the direction check. */
export function zoneAt(position: LatLng, heading: number | null, shapes: ZoneShape[]): ZoneShape | null {
  const pad = 0.0002; // ~20 m
  for (const s of shapes) {
    const [x0, y0, x1, y1] = s.bbox;
    if (position.longitude < x0 - pad || position.longitude > x1 + pad || position.latitude < y0 - pad || position.latitude > y1 + pad) continue;
    for (const ring of s.rings) {
      const inBand = inside(position, ring);
      const edge = edgeInfo(position, ring, heading);
      if (!inBand && edge.d > NEAR_BAND_METERS) continue;
      if (!edge.aligned) continue;
      return s;
    }
  }
  return null;
}
