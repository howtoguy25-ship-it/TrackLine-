// "Simulate drive" (development builds) and the navigation tests: a car driven ALONG a route's
// road geometry -- interpolated by distance along the line, never straight across from point to
// point -- at realistic speeds (each road at its own recorded speed), one GPS fix a second with a
// course and a speed, like a phone gives. Played through the same channel as GPS replay
// (dev/gpsReplay.ts), so the map, guidance and re-routing react exactly as to real GPS.
//
// Optional, seeded GPS noise for the robustness tests (kept separate from the clean drives):
// jitter of 5-15 m that drifts like real GPS error, occasional single fixes 30-80 m off, and
// spells of no signal (tunnels).
import { startGpsReplay, stopGpsReplay, isGpsReplayActive, type ReplayPoint } from "@/dev/gpsReplay";

interface LatLng {
  latitude: number;
  longitude: number;
}

interface StepLike {
  polyline: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
}

function metersBetween(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLng = (b.longitude - a.longitude) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearing(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const y = Math.sin((b.longitude - a.longitude) * r) * Math.cos(b.latitude * r);
  const x = Math.cos(a.latitude * r) * Math.sin(b.latitude * r) - Math.sin(a.latitude * r) * Math.cos(b.latitude * r) * Math.cos((b.longitude - a.longitude) * r);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function offset(p: LatLng, brgDeg: number, meters: number): LatLng {
  const r = (brgDeg * Math.PI) / 180;
  return {
    latitude: p.latitude + (meters * Math.cos(r)) / 111_320,
    longitude: p.longitude + (meters * Math.sin(r)) / (111_320 * Math.cos((p.latitude * Math.PI) / 180)),
  };
}

/** One second of the drive: a fix, or null when there's no signal. */
export interface SimSecond {
  timeMs: number;
  /** Where the car really is. */
  truth: LatLng;
  fix: { latitude: number; longitude: number; timeMs: number; speedMps: number; headingDeg: number; accuracyM: number } | null;
}

export interface GpsNoise {
  seed: number;
  /** Drifting error, metres (5-15 m like a phone in traffic). */
  jitterMeters?: number;
  /** Chance per fix of a single wild fix 30-80 m off. */
  jumpChance?: number;
  /** Spells with no fix at all: [startSecond, lengthSeconds]. */
  signalLoss?: [number, number][];
}

/** Small seeded generator, so a noisy drive is the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Drives `track` second by second: `speedAtKmh` gives the speed for each part of it. Positions
 * are interpolated along the line by distance, so every bend, U and roundabout is driven round.
 */
export function driveTrack(track: readonly LatLng[], speedAtKmh: (p: LatLng) => number, noise?: GpsNoise): SimSecond[] {
  if (track.length === 0) return [];
  const rand = noise ? rng(noise.seed) : null;
  const jitter = noise?.jitterMeters ?? 0;
  const out: SimSecond[] = [];
  let seg = 0;
  let along = 0; // metres into track[seg] -> track[seg + 1]
  let pos = track[0];
  let heading = track.length > 1 ? bearing(track[0], track[1]) : 0;
  let errE = 0;
  let errN = 0;
  const lost = (s: number) => (noise?.signalLoss ?? []).some(([from, len]) => s >= from && s < from + len);
  for (let s = 0; ; s++) {
    const mps = Math.max(2, speedAtKmh(pos) / 3.6);
    let fix: SimSecond["fix"] = null;
    if (!lost(s)) {
      let reported = pos;
      let accuracyM = 5;
      if (rand) {
        // Drifting error: each second keeps most of the last one's, plus a little fresh.
        errE = errE * 0.8 + (rand() - 0.5) * jitter * 0.9;
        errN = errN * 0.8 + (rand() - 0.5) * jitter * 0.9;
        const mag = Math.hypot(errE, errN);
        if (mag > jitter) {
          errE *= jitter / mag;
          errN *= jitter / mag;
        }
        reported = offset(offset(pos, 90, errE), 0, errN);
        accuracyM = Math.max(5, Math.round(Math.hypot(errE, errN) + 4));
        if (noise?.jumpChance && rand() < noise.jumpChance) {
          reported = offset(pos, rand() * 360, 30 + rand() * 50);
          // Phones often (not always) know a fix like that is poor.
          accuracyM = rand() < 0.5 ? 40 + Math.round(rand() * 30) : 12;
        }
      }
      fix = {
        latitude: reported.latitude,
        longitude: reported.longitude,
        timeMs: s * 1000,
        speedMps: mps,
        headingDeg: rand ? (heading + (rand() - 0.5) * 12 + 360) % 360 : heading,
        accuracyM,
      };
    }
    out.push({ timeMs: s * 1000, truth: pos, fix });
    if (seg >= track.length - 1) break;
    // Move one second along the line.
    let left = mps;
    while (left > 0 && seg < track.length - 1) {
      const a = track[seg];
      const b = track[seg + 1];
      const len = metersBetween(a, b);
      if (along + left < len) {
        along += left;
        left = 0;
        const t = len > 0 ? along / len : 0;
        pos = { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
        if (len > 0.5) heading = bearing(a, b);
      } else {
        left -= len - along;
        seg += 1;
        along = 0;
        pos = b;
        if (len > 0.5) heading = bearing(a, b);
      }
    }
  }
  return out;
}

/** Each road at its own speed: the recorded speed of the route step nearest a point (km/h). */
export function routeSpeedAt(steps: readonly StepLike[], fallbackKmh = 50): (p: LatLng) => number {
  return (p) => {
    let best = Infinity;
    let kmh = fallbackKmh;
    for (const s of steps) {
      if (s.durationSeconds <= 0 || s.distanceMeters < 1) continue;
      for (const q of s.polyline) {
        const d = metersBetween(p, q);
        if (d < best) {
          best = d;
          kmh = (s.distanceMeters / s.durationSeconds) * 3.6;
        }
      }
    }
    return best < 80 ? Math.max(8, kmh) : fallbackKmh;
  };
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

/**
 * Starts a simulated drive along `line`: a fixed speed, or each road at its own speed when the
 * route's steps are given.
 */
export function startSimulatedDrive(line: readonly LatLng[], speed: number | readonly StepLike[] = SIMULATED_SPEED_KMH): void {
  if (typeof speed === "number") {
    startGpsReplay(routeToReplayPoints(line, speed));
    return;
  }
  const seconds = driveTrack(line, routeSpeedAt(speed, SIMULATED_SPEED_KMH));
  startGpsReplay(seconds.map((s) => ({ latitude: s.truth.latitude, longitude: s.truth.longitude, elapsedMs: s.timeMs })));
}

export function stopSimulatedDrive(): void {
  stopGpsReplay();
}

export function isSimulatingDrive(): boolean {
  return isGpsReplayActive();
}
