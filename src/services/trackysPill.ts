// The pure half of services/trackysAround.ts (no Firebase), so tests and the proof renders can use it.
export interface TrackysCount {
  few: boolean;
  count: number | null;
  radiusKm: number;
}

export const HEARTBEAT_MS = 5 * 60 * 1000;
/** Coming back after this long counts as opening the app again (the greeting shows again). */
export const GREET_AFTER_BACKGROUND_MS = 10 * 60 * 1000;

/** The pill's words: "A few Trackys around you" under 10, else the rounded number. */
export function trackysPillText(r: TrackysCount): string {
  if (r.few || r.count == null) return "A few Trackys around you";
  return `${r.count.toLocaleString("en-AU")} Trackys around you`;
}

export function shouldGreet(lastBackgroundAt: number | null, now: number): boolean {
  return lastBackgroundAt == null || now - lastBackgroundAt >= GREET_AFTER_BACKGROUND_MS;
}
