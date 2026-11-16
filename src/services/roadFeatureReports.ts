// Filing and confirming driver reports about school zones and speed limits, and reading the ones
// that have gone live. Moderation happens on the server (firebase/functions/roadReportsCore.js,
// confirmRoadReport / syncRoadReport): a report is live after 3 other drivers confirm it, or the
// project owner approves it. Nothing a single driver files changes what anyone else sees.

import { addDoc, collection, doc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "@/services/firebase";
import { tileKey, tilesAround } from "@/schoolZones/zoneStore";
import { asCommunityFeature, type CommunityFeature } from "@/schoolZones/communityZones";

export type RoadReportKind = "school_zone_missing" | "school_zone_wrong" | "speed_limit_wrong";

export type RoadReportInput =
  | { kind: "school_zone_missing"; speed: number; unit: "km/h" | "mph"; windows: [string, string][] }
  | { kind: "school_zone_wrong"; reason: "not_here" | "wrong_hours" | "wrong_speed"; zoneId: string | null }
  | { kind: "speed_limit_wrong"; postedKmh: number; shownKmh: number | null };

export interface PendingRoadReport {
  id: string;
  kind: RoadReportKind;
  lat: number;
  lng: number;
  confirmCount: number;
  summary: string;
}

export const REPORT_CONFIRM_RADIUS_METERS = 150;

/** The record as filed (pure, so the shape is tested against the server's validator). */
export function buildRoadReport(uid: string, at: { latitude: number; longitude: number }, heading: number | null, input: RoadReportInput) {
  return {
    // Firestore can't store nested arrays: hours go as "08:00-09:30" strings.
    ...(input.kind === "school_zone_missing" ? { ...input, windows: input.windows.map(([a, b]) => `${a}-${b}`) } : input),
    reportedBy: uid,
    lat: at.latitude,
    lng: at.longitude,
    tile: tileKey(at.latitude, at.longitude),
    heading: heading == null ? null : ((heading % 360) + 360) % 360,
    status: "pending" as const,
    confirmCount: 0,
  };
}

export async function submitRoadReport(uid: string, at: { latitude: number; longitude: number }, heading: number | null, input: RoadReportInput): Promise<void> {
  await addDoc(collection(db, "roadFeatureReports"), { ...buildRoadReport(uid, at, heading, input), createdAt: serverTimestamp() });
}

export function reportSummary(d: Record<string, unknown>): string {
  if (d.kind === "school_zone_missing") {
    const w = (d.windows as string[] | undefined) ?? [];
    return `School zone ${d.speed} ${d.unit}, ${w.join(", ")}`;
  }
  if (d.kind === "school_zone_wrong") {
    return d.reason === "not_here" ? "No school zone here" : d.reason === "wrong_hours" ? "School zone hours are wrong" : "School zone speed is wrong";
  }
  return `Speed limit here is ${d.postedKmh} km/h`;
}

const rad = (x: number) => (x * Math.PI) / 180;
const meters = (aLat: number, aLng: number, bLat: number, bLng: number) =>
  Math.hypot(rad(bLng - aLng) * Math.cos(rad((aLat + bLat) / 2)), rad(bLat - aLat)) * 6_371_000;

/** Other drivers' pending reports near here, for "Confirm". Empty if offline. */
export async function pendingReportsNear(uid: string, lat: number, lng: number): Promise<PendingRoadReport[]> {
  try {
    const snap = await getDocs(query(collection(db, "roadFeatureReports"), where("tile", "in", tilesAround(lat, lng))));
    return snap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter(({ data }) => data.status === "pending" && data.reportedBy !== uid && meters(lat, lng, data.lat, data.lng) <= REPORT_CONFIRM_RADIUS_METERS)
      .map(({ id, data }) => ({ id, kind: data.kind as RoadReportKind, lat: data.lat, lng: data.lng, confirmCount: data.confirmCount ?? 0, summary: reportSummary(data) }));
  } catch {
    return [];
  }
}

/** One confirmation per account (the rules refuse a second, and the reporter's own). */
export async function confirmRoadReport(reportId: string, uid: string): Promise<void> {
  await setDoc(doc(db, "roadFeatureReports", reportId, "confirmations", uid), { createdAt: serverTimestamp() });
}

const memory = new Map<string, CommunityFeature[]>();

/** Live/approved driver-reported zones around a point (cached for the session). */
export async function communityFeaturesAround(lat: number, lng: number): Promise<CommunityFeature[]> {
  const key = tileKey(lat, lng);
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const snap = await getDocs(query(collection(db, "communityRoadFeatures"), where("tile", "in", tilesAround(lat, lng))));
    const list = snap.docs.map((d) => asCommunityFeature(d.id, d.data())).filter((f): f is CommunityFeature => !!f);
    memory.set(key, list);
    return list;
  } catch {
    return [];
  }
}
