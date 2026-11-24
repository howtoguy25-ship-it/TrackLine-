// Startup §2: "N Trackys around you". The app tells the server it's in use (noteActive, on open,
// on coming back and every 5 minutes while open) and asks for the count around it
// (trackysAround). The count is worked out on the server from geohash cells and comes back
// rounded -- the app never downloads anyone's position to count them.
import { httpsCallable } from "@firebase/functions";
import { functions } from "@/services/firebase";
import { withTimeout } from "@/utils/withTimeout";

export interface TrackysCount {
  few: boolean;
  count: number | null;
  radiusKm: number;
}

export const HEARTBEAT_MS = 5 * 60 * 1000;
/** Coming back after this long counts as opening the app again (the greeting shows again). */
export const GREET_AFTER_BACKGROUND_MS = 10 * 60 * 1000;

export async function noteActive(args: { lat: number; lng: number; ghost: boolean; stationary: boolean; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await withTimeout(
    httpsCallable(functions, "noteActive")({ lat: args.lat, lng: args.lng, ghost: args.ghost, stationary: args.stationary, localHour: now.getHours(), localDate }),
    10_000,
    "noteActive"
  );
}

export async function fetchTrackysAround(lat: number, lng: number): Promise<TrackysCount> {
  const res = await withTimeout(httpsCallable<{ lat: number; lng: number }, TrackysCount>(functions, "trackysAround")({ lat, lng }), 10_000, "trackysAround");
  return res.data;
}

/** The pill's words: "A few Trackys around you" under 10, else the rounded number. */
export function trackysPillText(r: TrackysCount): string {
  if (r.few || r.count == null) return "A few Trackys around you";
  return `${r.count.toLocaleString("en-AU")} Trackys around you`;
}

export function shouldGreet(lastBackgroundAt: number | null, now: number): boolean {
  return lastBackgroundAt == null || now - lastBackgroundAt >= GREET_AFTER_BACKGROUND_MS;
}
