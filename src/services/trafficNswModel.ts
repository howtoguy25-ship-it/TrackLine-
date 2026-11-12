// The app-side shape of Live Traffic NSW, and the pure logic around it (reading the shared
// snapshot defensively, choosing which incidents to draw, how each looks). Its only import is
// the import-free colour table, so scripts/test-traffic-nsw.ts checks it directly. The Firestore subscription is in trafficNsw.ts;
// the snapshot itself is produced by firebase/functions (refreshNswTraffic).

import { INCIDENT_REPORT, REPORTS, type IncidentKind } from "../theme/colors";

export type TrafficIncidentKind = "incident" | "roadwork" | "majorevent" | "flood" | "fire";

export interface TrafficIncident {
  id: string;
  kind: TrafficIncidentKind;
  /** Transport for NSW's own category, e.g. "Crash", "Heavy Traffic", "Breakdown". */
  category: string;
  headline: string;
  /** "Pacific Highway at Mowbray Road, Chatswood" -- may be empty. */
  where: string;
  delay: string;
  advice: string;
  major: boolean;
  lat: number;
  lng: number;
  updatedAt: number | null;
}

export interface TrafficSnapshot {
  /** False until the project owner has provided a Transport for NSW key. */
  configured: boolean;
  /** When the incidents were last actually fetched. */
  updatedAt: number | null;
  incidents: TrafficIncident[];
  /** Feeds whose latest fetch failed; their incidents are the previous run's. */
  failedKinds: string[];
}

export const EMPTY_TRAFFIC_SNAPSHOT: TrafficSnapshot = {
  configured: false,
  updatedAt: null,
  incidents: [],
  failedKinds: [],
};

const KINDS: TrafficIncidentKind[] = ["incident", "roadwork", "majorevent", "flood", "fire"];

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Reads the shared document into a snapshot. The server already validates everything it writes;
 * this is the second line, so that a document of any shape -- missing, half-written, from an
 * older or newer version of the function -- can never crash the map.
 */
export function parseTrafficSnapshot(data: unknown): TrafficSnapshot {
  if (!data || typeof data !== "object") return EMPTY_TRAFFIC_SNAPSHOT;
  const doc = data as Record<string, unknown>;
  const incidents: TrafficIncident[] = [];
  if (Array.isArray(doc.incidents)) {
    for (const raw of doc.incidents) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const lat = typeof item.lat === "number" ? item.lat : NaN;
      const lng = typeof item.lng === "number" ? item.lng : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      if (typeof item.id !== "string" || !item.id) continue;
      if (!KINDS.includes(item.kind as TrafficIncidentKind)) continue;
      incidents.push({
        id: item.id,
        kind: item.kind as TrafficIncidentKind,
        category: text(item.category, 60) || "Traffic hazard",
        headline: text(item.headline, 160),
        where: text(item.where, 240),
        delay: text(item.delay, 60),
        advice: text(item.advice, 240),
        major: item.major === true,
        lat,
        lng,
        updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : null,
      });
    }
  }
  return {
    configured: doc.configured === true,
    updatedAt: typeof doc.updatedAt === "number" && Number.isFinite(doc.updatedAt) ? doc.updatedAt : null,
    incidents,
    failedKinds: Array.isArray(doc.failedKinds) ? doc.failedKinds.filter((k): k is string => typeof k === "string") : [],
  };
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface NearbyIncident extends TrafficIncident {
  distanceMeters: number;
}

// Roadworks are by far the most numerous and the least urgent; they're only worth a pin when
// they're close. Everything else is shown from further out.
export const TRAFFIC_RADIUS_METERS = 40_000;
export const ROADWORK_RADIUS_METERS = 12_000;
export const TRAFFIC_MAX_MARKERS = 60;

/**
 * The incidents worth drawing around a position: in range, major ones and non-roadworks first,
 * then nearest -- and never more than the map can comfortably show.
 */
export function incidentsNear(
  incidents: TrafficIncident[],
  center: { latitude: number; longitude: number },
  limit = TRAFFIC_MAX_MARKERS
): NearbyIncident[] {
  const inRange: NearbyIncident[] = [];
  for (const incident of incidents) {
    const d = distanceMeters(center.latitude, center.longitude, incident.lat, incident.lng);
    const radius = incident.kind === "roadwork" && !incident.major ? ROADWORK_RADIUS_METERS : TRAFFIC_RADIUS_METERS;
    if (d <= radius) inRange.push({ ...incident, distanceMeters: d });
  }
  const rank = (incident: NearbyIncident) => (incident.major ? 0 : incident.kind === "roadwork" ? 2 : 1);
  inRange.sort((a, b) => rank(a) - rank(b) || a.distanceMeters - b.distanceMeters);
  return inRange.slice(0, limit);
}

export interface IncidentStyle {
  /** An Icon name (components/ui/Icon.tsx). */
  icon: "car-sport" | "construct" | "flag" | "water" | "flame" | "warning" | "hand-left" | "close-circle";
  /** The report colour for this kind of incident (theme/colors.ts REPORTS). */
  color: string;
  /** The glyph colour that reads on it. */
  glyph: string;
  /** Roadwork is a diamond, everything else a circle. */
  shape: "circle" | "diamond";
  label: string;
}

function styled(kind: IncidentKind, icon: IncidentStyle["icon"], label: string): IncidentStyle {
  const report = REPORTS[INCIDENT_REPORT[kind]];
  return { icon, color: report.fill, glyph: report.glyph, shape: report.shape, label };
}

export function incidentStyle(incident: Pick<TrafficIncident, "kind" | "category">): IncidentStyle {
  const category = incident.category.toLowerCase();
  if (incident.kind === "fire") return styled("fire", "flame", "Fire");
  if (incident.kind === "flood") return styled("flood", "water", "Flooding");
  // A closed road outranks whatever closed it.
  if (/\bclos(ed|ure)/.test(category)) return styled("closed", "close-circle", "Road closed");
  if (incident.kind === "roadwork") return styled("roadwork", "construct", "Roadwork");
  if (incident.kind === "majorevent") return styled("event", "flag", "Major event");
  if (category.includes("crash") || category.includes("accident")) return styled("crash", "car-sport", "Crash");
  if (category.includes("traffic")) return styled("traffic", "hand-left", "Heavy traffic");
  return styled("other", "warning", incident.category);
}

/** "3 min ago", "2 hr ago" -- or "" when the feed gave no time. */
export function formatIncidentAge(updatedAt: number | null, nowMs: number): string {
  if (updatedAt === null) return "";
  const minutes = Math.max(0, Math.round((nowMs - updatedAt) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// The server refreshes every five minutes. If the snapshot is much older than that, the feed
// (or the function) has stopped, and the layer should say so instead of presenting stale
// incidents as current.
export const TRAFFIC_STALE_AFTER_MS = 30 * 60_000;

export function isTrafficStale(snapshot: TrafficSnapshot, nowMs: number): boolean {
  return snapshot.configured && (snapshot.updatedAt === null || nowMs - snapshot.updatedAt > TRAFFIC_STALE_AFTER_MS);
}
