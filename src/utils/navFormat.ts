/** Mirrors the web app's utils/navFormat.ts formatArrivalClock -- same wall-clock format
 *  ("3:45 PM") on both surfaces. */
export function formatArrivalClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Real, explicit request (Waze-style redesign, Phase 1B section 5) -- exact distance-formatting
// rule for the top instruction card and every other distance shown in the app: >=10km rounds to
// a whole number, 1-10km keeps one decimal, under 1km (and under 100m) rounds to the nearest
// 10m. Defaults to "km" so every existing call site (there are several across this app) keeps
// its current behaviour unchanged when it doesn't pass a unit -- "miles" converts the real
// meters value first (1 m = 1/1609.344 mi), then applies the identical threshold rules in miles/
// feet instead of km/m, matching Settings > Distance units once that setting exists.
export type DistanceUnit = "km" | "miles";

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

export function formatDistance(meters: number, unit: DistanceUnit = "km"): string {
  if (unit === "miles") {
    const miles = meters / METERS_PER_MILE;
    if (miles < 0.1) {
      const feet = Math.round((meters * FEET_PER_METER) / 10) * 10;
      return `${feet} ft`;
    }
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** Same "X mins" / "X hour Y mins" style Google's own Directions API duration.text already
 *  uses -- needed because the real, live-traffic-synced ETA (see MapScreen's own live-ETA
 *  refresh effect) is a plain number of seconds, not a pre-formatted string from Google, so the
 *  headline trip-bar text has to be built locally to actually reflect it rather than staying
 *  frozen on whatever text the original route fetch happened to return. */
// Real, explicit request (Phase 1B section 5) -- "roundabout with exit number drawn (1st-7th
// exits)". Google's REST Directions API has no structured exit-number field on a step (only
// its separate Navigation SDK does, which this app doesn't use) -- but its own html_instructions
// text for a roundabout step routinely spells it out ("At the roundabout, take the 2nd exit"),
// so this extracts the real number Google's own sentence already states, rather than inventing
// one. Undefined when the instruction genuinely doesn't contain one (never a guessed default).
export function extractRoundaboutExitNumber(instruction: string): number | undefined {
  const match = instruction.match(/\b(\d+)(?:st|nd|rd|th)\s+exit\b/i);
  if (!match) return undefined;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) && n >= 1 && n <= 7 ? n : undefined;
}

export function formatDurationText(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min${minutes === 1 ? "" : "s"}`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} min${minutes === 1 ? "" : "s"}`;
}
