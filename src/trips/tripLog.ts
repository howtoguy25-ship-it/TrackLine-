// Trip history + stats (gap item 17). Each navigated trip is measured from the phone's own GPS
// fixes while it runs: distance driven (fix to fix), time, moving time, average and top speed,
// time over the posted limit, and whether you arrived or stopped early. Kept on the phone only
// (AsyncStorage, newest 200); nothing is uploaded. Turn off in Settings › Privacy. Pure parts are
// tested in __tests__/gap/tripHistory.test.tsx.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const TRIPS_KEY = "@trackline/trips";
export const MAX_TRIPS = 200;
/** Shorter than this isn't a trip (a route started and cancelled in the driveway). */
export const MIN_TRIP_M = 200;
/** A jump bigger than this between two fixes a few seconds apart is GPS noise, not driving. */
export const MAX_PLAUSIBLE_KMH = 250;
export const MOVING_KMH = 3;
/** Fixes worse than this are ignored for distance. */
export const MAX_ACCURACY_M = 50;

type LatLng = { latitude: number; longitude: number };

export interface TripRecord {
  id: string;
  startMs: number;
  endMs: number;
  mode: string;
  from: string | null;
  to: string | null;
  distanceM: number;
  durationS: number;
  movingS: number;
  maxKmh: number;
  /** Seconds above the posted limit (only counted where the limit was known). */
  overLimitS: number;
  arrived: boolean;
}

export function metresBetween(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Fix {
  latitude: number;
  longitude: number;
  timeMs: number;
  /** GPS speed, km/h, when the phone reports it. */
  speedKmh: number | null;
  accuracyM: number | null;
  limitKmh: number | null;
}

/** Measures one trip from its fixes. */
export class TripRecorder {
  private last: Fix | null = null;
  private distanceM = 0;
  private movingS = 0;
  private maxKmh = 0;
  private overLimitS = 0;
  readonly startMs: number;
  constructor(
    startMs: number,
    private readonly meta: { mode: string; from: string | null; to: string | null }
  ) {
    this.startMs = startMs;
  }

  onFix(f: Fix): void {
    if (f.accuracyM != null && f.accuracyM > MAX_ACCURACY_M) return;
    const prev = this.last;
    if (prev && f.timeMs <= prev.timeMs) return;
    this.last = f;
    if (!prev) return;
    const dt = (f.timeMs - prev.timeMs) / 1000;
    const d = metresBetween(prev, f);
    const kmh = (d / dt) * 3.6;
    if (dt > 0 && kmh <= MAX_PLAUSIBLE_KMH) this.distanceM += d;
    const speed = f.speedKmh ?? (dt > 0 && kmh <= MAX_PLAUSIBLE_KMH ? kmh : 0);
    if (speed >= MOVING_KMH) this.movingS += dt;
    if (speed <= MAX_PLAUSIBLE_KMH) this.maxKmh = Math.max(this.maxKmh, speed);
    if (f.limitKmh != null && speed > f.limitKmh + 2) this.overLimitS += dt;
  }

  /** The finished trip, or null when it was too short to count. */
  finish(endMs: number, arrived: boolean): TripRecord | null {
    if (this.distanceM < MIN_TRIP_M) return null;
    return {
      id: `${this.startMs}`,
      startMs: this.startMs,
      endMs,
      ...this.meta,
      distanceM: Math.round(this.distanceM),
      durationS: Math.round((endMs - this.startMs) / 1000),
      movingS: Math.round(this.movingS),
      maxKmh: Math.round(this.maxKmh),
      overLimitS: Math.round(this.overLimitS),
      arrived,
    };
  }
}

export function avgKmh(t: Pick<TripRecord, "distanceM" | "movingS">): number {
  return t.movingS > 0 ? Math.round((t.distanceM / t.movingS) * 3.6) : 0;
}

export interface TripStats {
  trips: number;
  distanceM: number;
  driveS: number;
  avgKmh: number;
  longestM: number;
}

export type StatsPeriod = "week" | "month" | "all";

/** Start of the period in local time (week starts Monday). */
export function periodStart(period: StatsPeriod, nowMs: number): number {
  if (period === "all") return 0;
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  if (period === "month") d.setDate(1);
  else d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function statsFor(trips: readonly TripRecord[], period: StatsPeriod, nowMs: number): TripStats {
  const from = periodStart(period, nowMs);
  const xs = trips.filter((t) => t.startMs >= from);
  const distanceM = xs.reduce((a, t) => a + t.distanceM, 0);
  const movingS = xs.reduce((a, t) => a + t.movingS, 0);
  return {
    trips: xs.length,
    distanceM,
    driveS: xs.reduce((a, t) => a + t.durationS, 0),
    avgKmh: avgKmh({ distanceM, movingS }),
    longestM: xs.reduce((a, t) => Math.max(a, t.distanceM), 0),
  };
}

export function formatDuration(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ---- storage (on the phone only) ----------------------------------------------------------------

export async function listTrips(): Promise<TripRecord[]> {
  const raw = await AsyncStorage.getItem(TRIPS_KEY);
  if (!raw) return [];
  try {
    const xs = JSON.parse(raw) as TripRecord[];
    return Array.isArray(xs) ? xs.sort((a, b) => b.startMs - a.startMs) : [];
  } catch {
    return [];
  }
}

export async function saveTrip(t: TripRecord): Promise<void> {
  const xs = await listTrips();
  const next = [t, ...xs.filter((x) => x.id !== t.id)].slice(0, MAX_TRIPS);
  await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(next));
}

export async function deleteTrip(id: string): Promise<void> {
  const xs = await listTrips();
  await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(xs.filter((x) => x.id !== id)));
}

export async function clearTrips(): Promise<void> {
  await AsyncStorage.removeItem(TRIPS_KEY);
}
