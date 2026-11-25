// Startup §1: the camera opens on the last place the map saw you (cached on the phone), then eases
// to the live fix when it arrives. Saved at most every 30 s or 200 m; only coordinates, on the
// phone, never sent anywhere.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "trackline:lastLocation:v1";
export const SAVE_EVERY_MS = 30_000;
export const SAVE_EVERY_M = 200;

export interface CachedLocation {
  latitude: number;
  longitude: number;
  at: number;
}

let lastSaved: CachedLocation | null = null;

function metres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const k = Math.PI / 180;
  const x = (b.longitude - a.longitude) * k * Math.cos(((a.latitude + b.latitude) / 2) * k);
  const y = (b.latitude - a.latitude) * k;
  return Math.hypot(x, y) * 6_371_000;
}

/** Whether a new fix is worth saving over the last one saved. */
export function shouldSave(prev: CachedLocation | null, next: CachedLocation): boolean {
  return !prev || next.at - prev.at >= SAVE_EVERY_MS || metres(prev, next) >= SAVE_EVERY_M;
}

export async function saveLastLocation(latitude: number, longitude: number, now = Date.now()): Promise<void> {
  const next = { latitude, longitude, at: now };
  if (!shouldSave(lastSaved, next)) return;
  lastSaved = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not saving is harmless: next launch just starts from the default view.
  }
}

export async function loadLastLocation(): Promise<CachedLocation | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as CachedLocation;
    if (!Number.isFinite(v.latitude) || !Number.isFinite(v.longitude) || Math.abs(v.latitude) > 90 || Math.abs(v.longitude) > 180) return null;
    return v;
  } catch {
    return null;
  }
}
