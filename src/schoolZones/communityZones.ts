// Driver-reported school zones that have gone live (3 confirmations from other drivers, or owner
// approval -- firebase/functions/roadReportsCore.js). They have no official geometry, so a report
// covers only the road it was made on: within 75 m of where it was reported AND travelling along
// the reported direction (either way, 40 degrees). Lowest-priority zone source: used only where
// neither the official data nor OpenStreetMap has a zone.

import type { LatLng } from "@/utils/polyline";
import type { SchoolZone } from "@/schoolZones/zoneStatus";

export interface CommunityFeature {
  id: string;
  kind: "school_zone";
  lat: number;
  lng: number;
  tile: string;
  heading: number;
  speed: number;
  unit: "km/h" | "mph";
  windows: [string, string][];
  status: "live" | "approved";
}

export const COMMUNITY_RADIUS_METERS = 75;
export const COMMUNITY_ALONG_DEG = 40;

function meters(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x = rad(b.longitude - a.longitude) * Math.cos(rad((a.latitude + b.latitude) / 2));
  const y = rad(b.latitude - a.latitude);
  return Math.hypot(x, y) * 6_371_000;
}

function alongEitherWay(heading: number, bearing: number): boolean {
  const diff = Math.abs(((heading - bearing + 540) % 360) - 180);
  return diff <= COMMUNITY_ALONG_DEG || diff >= 180 - COMMUNITY_ALONG_DEG;
}

/** Shape-checks a Firestore record; anything off is dropped, never guessed. */
export function asCommunityFeature(id: string, d: unknown): CommunityFeature | null {
  const r = d as Partial<CommunityFeature> | null;
  if (!r || r.kind !== "school_zone" || (r.status !== "live" && r.status !== "approved")) return null;
  if (typeof r.lat !== "number" || typeof r.lng !== "number" || typeof r.heading !== "number" || typeof r.speed !== "number") return null;
  if (r.unit !== "km/h" && r.unit !== "mph") return null;
  // Stored as "08:00-09:30" strings (Firestore has no nested arrays).
  const raw = (d as { windows?: unknown }).windows;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) return null;
  const windows: [string, string][] = [];
  for (const w of raw) {
    const m = typeof w === "string" ? /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(w) : null;
    if (!m) return null;
    windows.push([`${m[1]}:${m[2]}`, `${m[3]}:${m[4]}`]);
  }
  return { ...(r as CommunityFeature), windows, id: typeof r.id === "string" ? r.id : `community-${id}` };
}

/** The driver-reported zone the car is in, as a SchoolZone (judged by zoneStatus like any other). */
export function communityZoneAt(
  position: LatLng,
  heading: number | null,
  features: CommunityFeature[],
  where: { region: string | null; timezone: string }
): SchoolZone | null {
  let best: { f: CommunityFeature; d: number } | null = null;
  for (const f of features) {
    const d = meters(position, { latitude: f.lat, longitude: f.lng });
    if (d > COMMUNITY_RADIUS_METERS) continue;
    if (heading !== null && !alongEitherWay(heading, f.heading)) continue;
    if (!best || d < best.d) best = { f, d };
  }
  if (!best) return null;
  const f = best.f;
  return {
    id: f.id,
    source: "community",
    region: where.region ?? "",
    timezone: where.timezone,
    limit: { value: f.speed, unit: f.unit },
    windows: f.windows,
    name: "Reported by drivers",
  };
}
