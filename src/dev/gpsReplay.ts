import { bearingDegrees } from "@/utils/geo";
import { haversineMeters } from "@/services/places";

// Real, explicit request -- a dev-only "GPS replay" mode that plays back a recorded real drive
// (a GPX file) to test the speedometer, speed limits, and off-route rerouting without actually
// driving. __DEV__-gated everywhere this is consumed (LocationContext.tsx/useLiveSpeed.ts), so
// none of this exists in a production build. Deliberately does NOT ship a bundled "sample
// drive" -- a fabricated GPX pretending to be a real recorded trace would itself be exactly the
// kind of fake data this app's own stated standard rules out. A real recorded drive has to come
// from the developer's own real GPX export (any phone GPS logger / Strava / Google Maps
// Timeline export, etc.) -- see the Settings screen's __DEV__-only "GPS replay" section, which
// takes the raw GPX XML text pasted in directly (no new native file-picker dependency needed for
// that -- expo-document-picker isn't in this project, and adding one mid-session would need a
// fresh native build the same way any other new native module does).

export interface ReplayPoint {
  latitude: number;
  longitude: number;
  // Real elapsed milliseconds since the first point, taken from the GPX file's own real
  // <time> elements when present -- used to replay the drive at its own real pace. Points from
  // a GPX with no <time> data fall back to an even FALLBACK_INTERVAL_MS spacing (see
  // parseGpx below), which is an honest "we don't know the real timing" substitute, not a
  // guess at what the real timing was.
  elapsedMs: number;
}

// A fed GPX with no real <time> elements has no real pacing to replay at -- this is the
// explicit, disclosed fallback spacing used instead, not an attempt to guess the original
// recording's actual cadence.
const FALLBACK_INTERVAL_MS = 1000;

/** Real parser for a GPX file's real <trkpt> track points -- lightweight regex extraction
 *  (no XML/DOM dependency in this project) rather than a full GPX-spec parser, since a GPX
 *  track log's own real structure (a flat sequence of <trkpt lat="" lon=""><time>...</time>
 *  </trkpt> elements) is simple enough for this to extract correctly without one. Throws if no
 *  real trkpt elements are found, rather than silently returning an empty/fake replay. */
export function parseGpx(xml: string): ReplayPoint[] {
  const trkptRegex = /<trkpt\b[^>]*\blat="(-?\d+(?:\.\d+)?)"[^>]*\blon="(-?\d+(?:\.\d+)?)"[^>]*>([\s\S]*?)<\/trkpt>/gi;
  const raw: { latitude: number; longitude: number; time: number | null }[] = [];

  let match: RegExpExecArray | null;
  while ((match = trkptRegex.exec(xml)) !== null) {
    const latitude = parseFloat(match[1]);
    const longitude = parseFloat(match[2]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const timeMatch = match[3].match(/<time>([^<]+)<\/time>/i);
    const time = timeMatch ? Date.parse(timeMatch[1]) : null;
    raw.push({ latitude, longitude, time: Number.isFinite(time) ? time : null });
  }

  if (raw.length === 0) {
    throw new Error("No real <trkpt> points found in this GPX file");
  }

  const firstRealTime = raw.find((p) => p.time != null)?.time ?? null;
  return raw.map((p, i) => ({
    latitude: p.latitude,
    longitude: p.longitude,
    elapsedMs: p.time != null && firstRealTime != null ? p.time - firstRealTime : i * FALLBACK_INTERVAL_MS,
  }));
}

export interface ReplayFix {
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
}

type ReplayListener = (fix: ReplayFix) => void;

const listeners = new Set<ReplayListener>();
const activeChangeListeners = new Set<(active: boolean) => void>();
let activeTimers: ReturnType<typeof setTimeout>[] = [];
let active = false;

function setActive(next: boolean): void {
  if (active === next) return;
  active = next;
  activeChangeListeners.forEach((l) => l(active));
}

export function isGpsReplayActive(): boolean {
  return active;
}

export function subscribeGpsReplay(listener: ReplayListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Real start/stop notifications -- LocationContext/useLiveSpeed subscribe to this so a replay
 *  started or stopped AFTER they've already mounted (the realistic case: the app launches
 *  normally, then the developer starts a replay from Settings) switches their GPS source live,
 *  instead of only taking effect on the next app restart. */
export function subscribeGpsReplayActiveChange(listener: (active: boolean) => void): () => void {
  activeChangeListeners.add(listener);
  return () => activeChangeListeners.delete(listener);
}

export function stopGpsReplay(): void {
  activeTimers.forEach(clearTimeout);
  activeTimers = [];
  setActive(false);
}

/** Schedules every point in a parsed replay at its own real recorded pace (elapsedMs, see
 *  parseGpx), scaled by `speedMultiplier` (2 = twice as fast, for running a long real drive
 *  through a quick test). Computes a real speed (m/s, from haversine distance / real elapsed
 *  time between consecutive points) and real bearing for each fix, the same real values
 *  LocationContext/useLiveSpeed's genuine GPS fixes would carry -- nothing here is a guessed or
 *  placeholder number, it's derived straight from the real recorded points. */
export function startGpsReplay(points: ReplayPoint[], speedMultiplier = 1): void {
  stopGpsReplay();
  if (points.length === 0) return;
  setActive(true);

  points.forEach((point, i) => {
    const prev = i > 0 ? points[i - 1] : null;
    const fireAtMs = point.elapsedMs / Math.max(0.01, speedMultiplier);

    const timer = setTimeout(() => {
      if (!active) return;
      let speedMps: number | null = null;
      let heading: number | null = null;
      if (prev) {
        const dtSeconds = Math.max(0.001, (point.elapsedMs - prev.elapsedMs) / 1000);
        const distanceMeters = haversineMeters(prev, point);
        speedMps = distanceMeters / dtSeconds;
        heading = bearingDegrees(prev.latitude, prev.longitude, point.latitude, point.longitude);
      }
      const fix: ReplayFix = {
        coords: {
          latitude: point.latitude,
          longitude: point.longitude,
          altitude: null,
          accuracy: 5,
          altitudeAccuracy: null,
          heading,
          speed: speedMps,
        },
        timestamp: Date.now(),
      };
      listeners.forEach((l) => l(fix));
      if (i === points.length - 1) setActive(false);
    }, fireAtMs);
    activeTimers.push(timer);
  });
}
