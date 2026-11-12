// Real, explicit request (ADD-ON Part B -- "Waze-style smooth 'time-lapse' movement on roads").
// Pure playback maths for another driver's published presence path -- no React, no Firebase, so
// it can be unit-tested directly (scripts/test-presence-playback.ts).
//
// What a viewer has: a short, road-following list of timed points the SERVER already delayed by
// at least 60s (see updatePresence's PRESENCE_PRIVACY_DELAY_MS), refreshed about once a minute.
// What a viewer shows: the driver gliding along that path, replayed a fixed interval behind the
// moment each update was written, so one minute's batch plays out over the following minute and
// the next batch picks up where it left off. Nothing here can make a Tracky more current than
// the server allowed -- playback only ever runs BEHIND the newest published point, apart from a
// short, capped dead-reckoning coast if the next update is late.

export interface PathPoint {
  lat: number;
  lng: number;
  /** Server clock, ms. */
  t: number;
}

export interface PlaybackPose {
  lat: number;
  lng: number;
  headingDeg: number | null;
  /** False once the Tracky is holding still (before its first point, or after coasting out). */
  moving: boolean;
}

// The server's 60s privacy delay plus the ~60s between updates: a batch written at server time
// `w` covers roughly (w-120s, w-60s], and has to last the viewer until the next batch arrives at
// about w+60s. Starting playback at w-120s makes it land on the batch's last point just as the
// next one is due.
export const PRESENCE_PLAYBACK_DELAY_MS = 120 * 1000;
// If the next update is late, keep moving along the last known direction/speed for this long,
// then stop -- a Tracky that just froze reads as a bug; one that sails off down a road it never
// drove is worse.
export const DEAD_RECKON_MAX_MS = 20 * 1000;
// Sanity cap on the extrapolation speed (162 km/h) so one bad pair of points can't fling a
// Tracky across the map.
const MAX_DEAD_RECKON_SPEED_MPS = 45;
const METERS_PER_DEGREE_LAT = 111320;

/** The path time a viewer should be showing right now. `w` is the server time the doc was
 *  written; `receivedAtLocalMs`/`nowLocalMs` are both THIS device's clock, so only an elapsed
 *  duration is ever taken from it -- the viewer's clock never has to agree with the server's. */
export function displayTimeFor(w: number, receivedAtLocalMs: number, nowLocalMs: number): number {
  return w - PRESENCE_PLAYBACK_DELAY_MS + Math.max(0, nowLocalMs - receivedAtLocalMs);
}

export function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * METERS_PER_DEGREE_LAT;
  const dLng = (b.lng - a.lng) * METERS_PER_DEGREE_LAT * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** Heading of the last segment ending at `index` that actually covers ground. */
function headingInto(path: PathPoint[], index: number): number | null {
  for (let i = index - 1; i >= 0; i--) {
    if (metersBetween(path[i], path[index]) > 1) return bearingDegrees(path[i], path[index]);
  }
  return null;
}

export function poseAt(path: PathPoint[], t: number): PlaybackPose | null {
  if (path.length === 0) return null;
  const first = path[0];
  const last = path[path.length - 1];

  if (t <= first.t || path.length === 1) {
    const lead = path.length > 1 && metersBetween(first, path[1]) > 1 ? bearingDegrees(first, path[1]) : null;
    return { lat: first.lat, lng: first.lng, headingDeg: lead, moving: false };
  }

  if (t >= last.t) {
    const heading = headingInto(path, path.length - 1);
    const prev = path[path.length - 2];
    const dtSeg = last.t - prev.t;
    const overshoot = Math.min(t - last.t, DEAD_RECKON_MAX_MS);
    if (dtSeg <= 0 || heading === null) return { lat: last.lat, lng: last.lng, headingDeg: heading, moving: false };

    const segMeters = metersBetween(prev, last);
    const speed = Math.min(segMeters / (dtSeg / 1000), MAX_DEAD_RECKON_SPEED_MPS);
    const scale = segMeters > 0 ? (speed * (overshoot / 1000)) / segMeters : 0;
    return {
      lat: last.lat + (last.lat - prev.lat) * scale,
      lng: last.lng + (last.lng - prev.lng) * scale,
      headingDeg: heading,
      moving: t - last.t < DEAD_RECKON_MAX_MS,
    };
  }

  // Binary search for the segment [lo, lo+1] containing t.
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const covers = metersBetween(a, b) > 1;
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
    headingDeg: covers ? bearingDegrees(a, b) : headingInto(path, lo),
    moving: covers,
  };
}

/** "Rotation/tilt to face travel direction" -- a Tracky is a face, so spinning it to its full
 *  compass heading would turn it upside-down heading south. Instead it LEANS into its direction
 *  of travel: up to this many degrees left/right, from the east-west part of its heading. */
export const MAX_LEAN_DEGREES = 14;
export function leanDegrees(pose: PlaybackPose): number {
  if (!pose.moving || pose.headingDeg === null) return 0;
  return Math.sin((pose.headingDeg * Math.PI) / 180) * MAX_LEAN_DEGREES;
}

// Real, explicit request -- "performance scaling." How often positions are recomputed and
// whether trail particles are drawn at all, by how many Trackys are actually on screen. Reduce
// Motion gets a slow, trail-free update instead of continuous gliding.
export interface PlaybackBudget {
  tickMs: number;
  trailParticles: number;
}
export function playbackBudget(visibleCount: number, reduceMotion: boolean): PlaybackBudget {
  if (reduceMotion) return { tickMs: 5000, trailParticles: 0 };
  if (visibleCount <= 8) return { tickMs: 250, trailParticles: 3 };
  if (visibleCount <= 12) return { tickMs: 400, trailParticles: 2 };
  if (visibleCount <= 25) return { tickMs: 600, trailParticles: 0 };
  return { tickMs: 1000, trailParticles: 0 };
}

export const TRAIL_PARTICLE_SPACING_MS = 1500;
