// "Mark your parking spot" / "Find my car": one spot, on this phone (AsyncStorage), shown on the
// map as a P pin. Never guessed: it's only ever a place the driver chose.
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ParkingSpot {
  latitude: number;
  longitude: number;
  /** What it was marked from, e.g. "Work" or the address. */
  label: string;
  savedAt: number;
}

const KEY = "@trackline/parkingSpot";
const listeners = new Set<(spot: ParkingSpot | null) => void>();

export async function getParkingSpot(): Promise<ParkingSpot | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return typeof p.latitude === "number" && typeof p.longitude === "number" ? p : null;
  } catch {
    return null;
  }
}

export async function setParkingSpot(spot: Omit<ParkingSpot, "savedAt">, nowMs = Date.now()): Promise<ParkingSpot> {
  const full = { ...spot, savedAt: nowMs };
  await AsyncStorage.setItem(KEY, JSON.stringify(full));
  listeners.forEach((l) => l(full));
  return full;
}

export async function clearParkingSpot(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  listeners.forEach((l) => l(null));
}

export function subscribeParkingSpot(listener: (spot: ParkingSpot | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
