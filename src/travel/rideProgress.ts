// On a transit ride: "Get off in 2 stops" (from Transport for NSW's stop sequence when realtime is
// available), otherwise "Get off at Manly Wharf" as you near it, with a vibration once at
// "next stop" -- from the real arrival stop position and time, never a guessed stop count.
const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
function metres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const NEXT_STOP_M = 600;
export const NEXT_STOP_MS = 2 * 60_000;

export interface RideInput {
  arrivalStop: string;
  arrivalLocation: { latitude: number; longitude: number };
  arrivalTimeMs?: number;
  /** Stops still to pass, in order, ending with the arrival stop (TfNSW stopSequence). */
  stopsAhead?: { name: string; latitude: number; longitude: number }[];
}

export interface RideStatus {
  text: string;
  /** Vibrate now (the "next stop" moment), once. */
  vibrate: boolean;
  stopsLeft: number | null;
}

export function rideStatus(ride: RideInput, position: { latitude: number; longitude: number }, nowMs: number, alreadyBuzzed: boolean): RideStatus {
  let stopsLeft: number | null = null;
  if (ride.stopsAhead && ride.stopsAhead.length > 0) {
    // The stops not yet reached: drop those behind (the nearest stop and anything before it, once within 80 m).
    const nearestIdx = ride.stopsAhead.reduce((best, s, i) => (metres(position, s) < metres(position, ride.stopsAhead![best]) ? i : best), 0);
    const passed = metres(position, ride.stopsAhead[nearestIdx]) < 80 ? nearestIdx + 1 : nearestIdx;
    stopsLeft = Math.max(0, ride.stopsAhead.length - passed);
  }
  const dist = metres(position, ride.arrivalLocation);
  const soon = dist <= NEXT_STOP_M || (ride.arrivalTimeMs != null && ride.arrivalTimeMs - nowMs <= NEXT_STOP_MS) || stopsLeft === 1;
  if (stopsLeft === 0 || dist < 80) return { text: `Get off here: ${ride.arrivalStop}`, vibrate: !alreadyBuzzed, stopsLeft: 0 };
  if (soon) return { text: `Get off at the next stop: ${ride.arrivalStop}`, vibrate: !alreadyBuzzed, stopsLeft: stopsLeft ?? 1 };
  if (stopsLeft !== null) return { text: `Get off in ${stopsLeft} stops, at ${ride.arrivalStop}`, vibrate: false, stopsLeft };
  return { text: `Get off at ${ride.arrivalStop}`, vibrate: false, stopsLeft: null };
}
