// Which speed limit the sign shows, best source first -- and nothing rather than a guess:
//   1. an active school zone (official data, or OSM maxspeed:conditional, judged against the
//      official school calendar);
//   2. an official speed-zone dataset for the matched road (none wired yet -- see NOTES);
//   3. Mapbox's maxspeed on the active route, at the segment the car is matched to (heading-aware
//      route matching, so a parallel road's limit is never shown);
//   4. the posted OSM maxspeed of the matched road;
//   5. nothing: the sign is hidden. Road-type "default" limits are guesses and are never shown.

export type LimitSource = "schoolZone" | "official" | "route" | "osm";

export interface LimitInput {
  schoolZone?: { active: boolean; kmh: number; display: { value: number; unit: "km/h" | "mph" }; untilLabel: string | null; name?: string | null } | null;
  official?: number | null;
  /** Mapbox maxspeed (km/h) at the matched route segment; null where Mapbox has none. */
  route?: number | null;
  /** OSM posted maxspeed (km/h) for the matched road; never a road-type default. */
  osm?: { kmh: number; estimated: boolean } | null;
}

export interface ResolvedLimit {
  kmh: number;
  source: LimitSource;
  schoolZone: { untilLabel: string | null; name: string | null } | null;
}

export function resolveSpeedLimit(input: LimitInput): ResolvedLimit | null {
  const z = input.schoolZone;
  if (z && z.active) return { kmh: z.kmh, source: "schoolZone", schoolZone: { untilLabel: z.untilLabel, name: z.name ?? null } };
  if (input.official != null && input.official > 0) return { kmh: input.official, source: "official", schoolZone: null };
  if (input.route != null && input.route > 0) return { kmh: input.route, source: "route", schoolZone: null };
  if (input.osm && !input.osm.estimated && input.osm.kmh > 0) return { kmh: input.osm.kmh, source: "osm", schoolZone: null };
  return null;
}

/** Mapbox maxspeed for the route segment at `alongMeters` (annotations are per polyline segment). */
export function routeLimitAt(polyline: { latitude: number; longitude: number }[], maxSpeedsKmh: (number | null)[] | undefined, alongMeters: number): number | null {
  if (!maxSpeedsKmh || polyline.length < 2) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  let acc = 0;
  for (let i = 0; i < polyline.length - 1 && i < maxSpeedsKmh.length; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    acc += Math.hypot(rad(b.longitude - a.longitude) * Math.cos(rad(a.latitude)), rad(b.latitude - a.latitude)) * 6_371_000;
    if (alongMeters <= acc) return maxSpeedsKmh[i] ?? null;
  }
  return null;
}

// ---- how the sign looks where you are ----

/** Countries that sign speed limits in mph. */
const MPH_COUNTRIES = new Set(["US", "GB", "LR", "MM", "BS", "BZ", "KY", "VG", "VI", "PR", "GU", "AS", "MP", "FK", "AI", "MS", "TC", "AG", "DM", "GD", "KN", "LC", "VC", "WS", "IM", "JE", "GG"]);
/** Countries whose limit signs are a white rectangle ("SPEED LIMIT 25") rather than a red ring. */
const RECTANGLE_COUNTRIES = new Set(["US", "CA", "PR", "GU", "AS", "MP", "VI"]);

export type SignStyle = "ring" | "rectangle";

export function signStyleFor(countryCode: string | null | undefined): SignStyle {
  return countryCode && RECTANGLE_COUNTRIES.has(countryCode.toUpperCase()) ? "rectangle" : "ring";
}

/** The unit the sign shows: the country's own, unless the user chose one in Settings. */
export function signUnitFor(countryCode: string | null | undefined, userUnit: "km" | "miles" | "auto" = "auto"): "km/h" | "mph" {
  if (userUnit === "km") return "km/h";
  if (userUnit === "miles") return "mph";
  return countryCode && MPH_COUNTRIES.has(countryCode.toUpperCase()) ? "mph" : "km/h";
}

/** The number on the sign. Signed mph limits are multiples of 5, so convert back cleanly. */
export function signValue(kmh: number, unit: "km/h" | "mph"): number {
  return unit === "mph" ? Math.round(kmh / 1.609344 / 5) * 5 || Math.round(kmh / 1.609344) : Math.round(kmh);
}

/** Over the limit by at least the user's threshold? (Applies to school-zone limits too.) */
export function isSpeeding(speedKmh: number, limitKmh: number | null, thresholdKmh: number): boolean {
  return limitKmh != null && speedKmh >= limitKmh + thresholdKmh;
}
