// "Simulate drive" (development builds): turns a route line into timed GPS fixes along it at a
// steady speed, played through the same channel as GPS replay (dev/gpsReplay.ts), so the map,
// the camera, turn-by-turn guidance and re-routing all react exactly as they do to real GPS.
// The resampling is pure and unit-tested (__tests__/mapV2.test.ts).
import { startGpsReplay, stopGpsReplay, isGpsReplayActive, type ReplayPoint } from "@/dev/gpsReplay";

interface LatLng {
  latitude: number;
  longitude: number;
}

function metersBetween(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLng = (b.longitude - a.longitude) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points every `intervalMs` along the line, as if driven at `speedKmh`. Ends exactly at the end. */
export function routeToReplayPoints(line: readonly LatLng[], speedKmh: number, intervalMs = 1000): ReplayPoint[] {
  if (line.length === 0) return [];
  const step = (Math.max(1, speedKmh) / 3.6) * (intervalMs / 1000); // metres per tick
  const out: ReplayPoint[] = [{ latitude: line[0].latitude, longitude: line[0].longitude, elapsedMs: 0 }];
  let carried = 0; // metres since the last emitted point
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const seg = metersBetween(a, b);
    let along = step - carried;
    while (along <= seg) {
      const t = seg === 0 ? 0 : along / seg;
      out.push({
        latitude: a.latitude + (b.latitude - a.latitude) * t,
        longitude: a.longitude + (b.longitude - a.longitude) * t,
        elapsedMs: out.length * intervalMs,
      });
      along += step;
    }
    carried = seg - (along - step);
  }
  const last = line[line.length - 1];
  const tail = out[out.length - 1];
  if (tail.latitude !== last.latitude || tail.longitude !== last.longitude) {
    out.push({ latitude: last.latitude, longitude: last.longitude, elapsedMs: out.length * intervalMs });
  }
  return out;
}

export const SIMULATED_SPEED_KMH = 50;

export function startSimulatedDrive(line: readonly LatLng[], speedKmh = SIMULATED_SPEED_KMH): void {
  startGpsReplay(routeToReplayPoints(line, speedKmh));
}

export function stopSimulatedDrive(): void {
  stopGpsReplay();
}

export function isSimulatingDrive(): boolean {
  return isGpsReplayActive();
}
