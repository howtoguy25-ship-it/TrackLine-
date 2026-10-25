/** Mirrors the web app's utils/navFormat.ts formatArrivalClock -- same wall-clock format
 *  ("3:45 PM") on both surfaces. */
export function formatArrivalClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Mirrors the web app's utils/navFormat.ts formatDistance -- rounded to the nearest 10m under
 *  1km (matching real GPS/estimate precision, not false sub-meter accuracy), one decimal in km
 *  above that. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Same "X mins" / "X hour Y mins" style Google's own Directions API duration.text already
 *  uses -- needed because the real, live-traffic-synced ETA (see MapScreen's own live-ETA
 *  refresh effect) is a plain number of seconds, not a pre-formatted string from Google, so the
 *  headline trip-bar text has to be built locally to actually reflect it rather than staying
 *  frozen on whatever text the original route fetch happened to return. */
export function formatDurationText(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min${minutes === 1 ? "" : "s"}`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} min${minutes === 1 ? "" : "s"}`;
}
