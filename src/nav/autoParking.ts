// Gap item 11: remembering where you parked without being asked (Settings > Navigation >
// "Remember where I parked", on by default). Only from what the phone saw:
//   arrived at the destination        -> the car is where the drive ended: saved at once
//   ended the drive some other way    -> only after a real drive (MIN_DRIVE_M), and only once you
//                                        then walk away from that spot (WALK_AWAY_M at walking
//                                        speed) within WATCH_MS; driving off again cancels it
//   at Home                           -> never (you know where your car is)
// The spot is the one parking spot (services/parkingSpot.ts): the P pin, "Find my car".
// Pure; tested in __tests__/gap/autoParking.test.ts.

export const MIN_DRIVE_M = 1000;
export const WALK_AWAY_M = 40;
export const WALK_MAX_KMH = 9;
export const DRIVE_AGAIN_KMH = 20;
export const WATCH_MS = 15 * 60_000;
export const HOME_RADIUS_M = 150;

type LatLng = { latitude: number; longitude: number };

export interface DriveEnd {
  reason: "arrived" | "exit" | string;
  at: LatLng | null;
  label: string;
  drivenM: number;
  endedAt: number;
  home: LatLng | null;
}

export interface ParkingWatch {
  at: LatLng;
  label: string;
  endedAt: number;
}

export interface ParkingDecision {
  save: { latitude: number; longitude: number; label: string } | null;
  watch: ParkingWatch | null;
}

function metres(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function onDriveEnd(end: DriveEnd): ParkingDecision {
  const none = { save: null, watch: null };
  if (!end.at) return none;
  if (end.home && metres(end.at, end.home) <= HOME_RADIUS_M) return none;
  const spot = { latitude: end.at.latitude, longitude: end.at.longitude, label: end.label };
  if (end.reason === "arrived") return { save: spot, watch: null };
  if (end.drivenM < MIN_DRIVE_M) return none;
  return { save: null, watch: { at: end.at, label: end.label, endedAt: end.endedAt } };
}

/** Each fix after a drive ended without arriving: "save" once walked away, "cancel" if driving again or too late. */
export function onFixAfterDrive(watch: ParkingWatch, fix: LatLng & { speedKmh: number | null; at: number }): "save" | "cancel" | null {
  if (fix.at - watch.endedAt > WATCH_MS) return "cancel";
  const speed = fix.speedKmh ?? 0;
  if (speed > DRIVE_AGAIN_KMH) return "cancel";
  if (speed <= WALK_MAX_KMH && metres(watch.at, fix) >= WALK_AWAY_M) return "save";
  return null;
}
