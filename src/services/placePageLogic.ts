// Small pure rules behind the place page (UI pass 2, section 4). No imports, so they're checked
// by scripts/test-ui-logic.ts.

export interface NearbyCarPark {
  name: string;
  distanceMeters: number;
}

/** A car park closer than this to the place's own point is treated as the place's own. */
export const ONSITE_PARKING_METERS = 40;
/** Farther than this isn't "nearby parking" for a place you're driving to. */
export const NEARBY_PARKING_MAX_METERS = 800;
// Walking speed, and how much longer a real walk is than the straight line to it.
const WALK_METERS_PER_MINUTE = 80;
const WALK_DETOUR_FACTOR = 1.3;

export type ParkingSummary =
  | { kind: "onsite"; name: string }
  | { kind: "nearby"; name: string; walkMinutes: number }
  | { kind: "none" };

/**
 * What the "Nearby parking" card says. Real data only: it's the nearest mapped car park, or
 * nothing at all -- the section is hidden rather than guessed.
 */
export function summarizeParking(carParks: NearbyCarPark[]): ParkingSummary {
  const nearest = carParks
    .filter((c) => Number.isFinite(c.distanceMeters) && c.distanceMeters <= NEARBY_PARKING_MAX_METERS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
  if (!nearest) return { kind: "none" };
  if (nearest.distanceMeters <= ONSITE_PARKING_METERS) return { kind: "onsite", name: nearest.name };
  const walkMinutes = Math.max(1, Math.round((nearest.distanceMeters * WALK_DETOUR_FACTOR) / WALK_METERS_PER_MINUTE));
  return { kind: "nearby", name: nearest.name, walkMinutes };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Today's line from Google's opening-hours text ("Monday: 9:00 AM – 5:00 PM" -> "9:00 AM – 5:00
 * PM"), or null when Google gave none for today.
 */
export function todaysHours(weekdayText: string[] | undefined, now: Date): string | null {
  if (!weekdayText || weekdayText.length === 0) return null;
  const today = DAY_NAMES[now.getDay()];
  const line = weekdayText.find((entry) => entry.toLowerCase().startsWith(today.toLowerCase()));
  if (!line) return null;
  const hours = line.slice(line.indexOf(":") + 1).trim();
  return hours || null;
}

/** Ids from a shared drive link aren't Google places: there's nothing more to look up for them. */
export function isLookupablePlaceId(placeId: string): boolean {
  return !!placeId && !placeId.startsWith("shared:");
}
