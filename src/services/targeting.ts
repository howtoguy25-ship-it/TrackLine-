import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase";
import type { AppSettings } from "@/services/settings";
import { regionAt } from "@/schoolZones/regions";

// What the dashboard's message audience can target, kept on this install's deviceSessions doc:
// app version, country / state, a rounded last location (about 1 km), language, which
// features are on, and the Notification settings. Privacy policy: "Messages from TrackLine".

/** Rounded to 2 decimals (~1 km): enough for "within 20 km of Parramatta", never a street. */
export function roundApprox(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The Notification settings as the server reads them (fun / news / traffic). */
export function notificationPrefs(s: Pick<AppSettings, "notifyFun" | "notifyNews" | "notifyTraffic">): Record<string, boolean> {
  return { fun: s.notifyFun !== false, news: s.notifyNews !== false, traffic: s.notifyTraffic !== false };
}

/** Features the dashboard can target "users who have it on". */
export function featureFlags(s: Partial<AppSettings>): Record<string, boolean> {
  return {
    trackys: s.showTrackysOnMap !== false,
    schoolZones: s.schoolZonesShowOnMap !== false,
    liveTraffic: s.showLiveTraffic !== false,
    speedometer: s.showSpeedometer !== false,
    shareArrivals: s.shareArrivals === true,
  };
}

/** Patch for a new location; null when it hasn't moved ~1 km. Pure. */
export function locationPatch(lat: number, lng: number, last: { lat: number; lng: number } | null): { approxLat: number; approxLng: number; state: string | null } | null {
  const approxLat = roundApprox(lat);
  const approxLng = roundApprox(lng);
  if (last && last.lat === approxLat && last.lng === approxLng) return null;
  const region = regionAt(lat, lng).region;
  return { approxLat, approxLng, state: region && region.startsWith("AU-") ? region.slice(3) : null };
}

let lastLoc: { lat: number; lng: number } | null = null;
let lastLocAt = 0;

/** Called with the driver's position; writes at most every 30 min and only after ~1 km. */
export async function syncApproxLocation(uid: string, lat: number, lng: number, nowMs = Date.now()): Promise<void> {
  if (nowMs - lastLocAt < 30 * 60 * 1000 && lastLoc) return;
  const patch = locationPatch(lat, lng, lastLoc);
  lastLocAt = nowMs;
  if (!patch) return;
  lastLoc = { lat: patch.approxLat, lng: patch.approxLng };
  await setDoc(doc(db, "deviceSessions", uid), patch, { merge: true });
}

export async function syncPrefs(uid: string, settings: AppSettings): Promise<void> {
  await setDoc(doc(db, "deviceSessions", uid), { notificationPrefs: notificationPrefs(settings), features: featureFlags(settings) }, { merge: true });
}

const INSTALL_ID_KEY = "@trackline/installId";

/** A random id for this install (not the hardware id): the dashboard's device list. */
export async function installId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(INSTALL_ID_KEY, id);
  return id;
}

export async function recordDevice(uid: string, info: { model: string | null; os: string | null; appVersion: string | null; platform: string }): Promise<void> {
  const id = await installId();
  await setDoc(doc(db, "deviceSessions", uid, "devices", id), { ...info, lastSeenAt: serverTimestamp() }, { merge: true });
}
