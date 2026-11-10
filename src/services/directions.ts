import { env } from "@/config/env";
import { decodePolyline, type LatLng } from "@/utils/polyline";
import { Sentry } from "@/services/sentry";

export class DirectionsApiError extends Error {
  constructor(public status: string, message?: string) {
    super(message ? `${status}: ${message}` : status);
    this.name = "DirectionsApiError";
  }
}

export type ManeuverType =
  | "turn-left"
  | "turn-right"
  | "turn-slight-left"
  | "turn-slight-right"
  | "turn-sharp-left"
  | "turn-sharp-right"
  | "uturn-left"
  | "uturn-right"
  | "merge"
  | "roundabout-left"
  | "roundabout-right"
  | "fork-left"
  | "fork-right"
  | "ramp-left"
  | "ramp-right"
  | "straight"
  | undefined;

export interface RouteStep {
  instruction: string; // plain-text, HTML stripped
  // Real, explicit request -- just the road name (+ route ref, when the road has one) this
  // step turns onto, extracted from Google's own <b> markup (see extractBoldRoadName). Used by
  // the Phase 1B-style top instruction card, which shows this large on its own rather than the
  // full instruction sentence. Undefined when Google's own html genuinely didn't bold anything
  // (e.g. "Continue straight") -- the card falls back to the full instruction text then.
  targetStreetName?: string;
  maneuver: ManeuverType;
  distanceMeters: number;
  durationSeconds: number;
  startLocation: LatLng;
  endLocation: LatLng;
  polyline: LatLng[];
}

export interface Route {
  polyline: LatLng[];
  steps: RouteStep[];
  // Google's own real short road-name summary for this route (e.g. "M2" or "Pennant Hills Rd")
  // -- straight off the classic Directions API's own `route.summary` field, never derived/
  // guessed from the steps. undefined on the rare route Google itself didn't return one for
  // (no single road dominates the path), never a fabricated placeholder.
  summary?: string;
  distanceMeters: number;
  durationSeconds: number;
  etaText: string;
  distanceText: string;
  // Only set when the request asked for live traffic (see DirectionsOptions.useTraffic) and
  // Google actually returned a traffic-adjusted figure. durationSeconds/etaText above always
  // stay the free-flow figure so callers that don't care about traffic get a stable value.
  durationInTrafficSeconds?: number;
  etaInTrafficText?: string;
  // True once durationInTraffic meaningfully exceeds free-flow duration -- the "there's
  // traffic on this one" signal for the route picker, not just noise from rounding.
  hasTrafficDelay?: boolean;
  // Only set for mode "transit" -- the real bus/train line(s) this itinerary actually rides,
  // straight from Google's own transit_details per step (not guessed/derived), so the picker
  // can show "Bus 418" or "T2 Train" instead of just a generic "Transit" label.
  transitSummary?: TransitSummary;
  // Only ever set on the "tolls" entry of getRouteOptions' own Record -- see that function's
  // own comment for the real logic behind it.
  tollEstimate?: TollEstimate;
}

// Google's overview_polyline (Route.polyline) is a deliberately simplified/lower-point-count
// geometry -- fine for a quick ETA-pill placement, but visibly cuts corners against the real road
// shape once drawn as an actual route line on screen at normal driving zoom (confirmed: the real
// turn-by-turn line already avoids this by concatenating the per-step polylines instead, see
// MapScreen.tsx's remainingPolyline). This gives every OTHER route-line render (route-picker
// previews, walk/bike/transit previews, mid-trip add-stop/traffic-suggestion previews) the same
// real, detailed, road-following geometry instead of the coarse overview one.
export function detailedRoutePolyline(route: Route): LatLng[] {
  const flattened = route.steps.flatMap((step) => step.polyline);
  return flattened.length > 1 ? flattened : route.polyline;
}

export interface TollEstimate {
  // True only when this route's own real path has been directly confirmed to differ from the
  // no-tolls route for the same trip -- i.e. it genuinely crosses a toll road right now, not
  // assumed from the road type alone (a "toll road" with the toll suspended/removed, or simply
  // not needed for this particular trip, correctly reads as false).
  hasToll: boolean;
  // A real, live dollar figure from Google's own Routes API toll-pricing feature (AU_LINKT
  // pass) -- e.g. "$4.65". null while hasToll is true but no real price could be obtained
  // (the lookup failed, or Google itself has no price on file for this specific toll, which it
  // documents as a real possibility -- it still reports a toll exists with an unknown fee
  // rather than guessing). Never a fabricated number -- see getTollPrice's own header.
  priceText: string | null;
}

export interface TransitLeg {
  vehicleType: string; // Google's vehicle.type, e.g. "BUS", "HEAVY_RAIL", "TRAM"
  lineName: string; // short_name if set (e.g. "418"), else the full line name
  lineColor?: string;
  headsign?: string;
  agencyName?: string;
  departureStop: string;
  arrivalStop: string;
  departureLocation: LatLng;
  arrivalLocation: LatLng;
  departureText?: string; // Google's own localized departure time, e.g. "10:42 am"
  arrivalText?: string;
  numStops?: number;
}

export interface TransitSummary {
  legs: TransitLeg[]; // in trip order; walking segments between them are omitted
  transfers: number; // legs.length - 1
}

export interface DirectionsOptions {
  avoidHighways?: boolean;
  avoidTolls?: boolean;
  waypoint?: LatLng;
  // Requests Google's live traffic-adjusted duration. `true` means departure_time=now (the
  // original behavior -- left opt-in rather than always-on because it's the one param that
  // makes the three parallel route-option requests non-cacheable/time-sensitive). A number is a
  // real future departure time (Unix seconds) -- Google's own Directions API genuinely computes
  // a predictive, traffic-model-based duration for a future departure_time, not just "now"; used
  // by the Plan a Drive screen's own real "leave in 15/30/60 min" presets, never a guessed/
  // client-side-adjusted figure.
  useTraffic?: boolean | number;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Real, explicit request (Waze-style redesign, Phase 1B section 5) -- the top instruction card
// needs the bare STREET NAME this step turns onto (e.g. "Victoria Rd", or "A3/Wiley Ave" when
// the road also has a route ref), separate from the full "Turn left onto X" sentence. Google's
// own Directions API already marks exactly this substring: html_instructions wraps the road
// name (and its route ref, as a separate <b> span, when the road has one) in <b> tags -- e.g.
// "Turn right onto <b>A3</b>/<b>Wiley Ave</b>". Extracting the real substring from the FIRST
// <b> to the LAST </b> (keeping whatever literal text Google itself put between them, like the
// "/" above) is the real, non-fabricated way to get this -- never a guess derived from the
// plain-text instruction sentence. Undefined when the step's own html genuinely has no bold
// span (never a guessed fallback).
function extractBoldRoadName(html: string): string | undefined {
  const firstOpen = html.indexOf("<b>");
  const lastClose = html.lastIndexOf("</b>");
  if (firstOpen === -1 || lastClose === -1 || lastClose < firstOpen) return undefined;
  const inner = html.slice(firstOpen, lastClose + 4);
  const text = stripHtml(inner);
  return text.length > 0 ? text : undefined;
}

function parseTransitSummary(leg: any): TransitSummary | undefined {
  const legs: TransitLeg[] = leg.steps
    .filter((step: any) => step.travel_mode === "TRANSIT" && step.transit_details)
    .map((step: any) => {
      const td = step.transit_details;
      const line = td.line ?? {};
      return {
        vehicleType: line.vehicle?.type ?? "TRANSIT",
        lineName: line.short_name ?? line.name ?? "Transit",
        lineColor: line.color,
        headsign: td.headsign,
        agencyName: line.agencies?.[0]?.name,
        departureStop: td.departure_stop?.name ?? "",
        arrivalStop: td.arrival_stop?.name ?? "",
        departureLocation: {
          latitude: td.departure_stop?.location?.lat,
          longitude: td.departure_stop?.location?.lng,
        },
        arrivalLocation: {
          latitude: td.arrival_stop?.location?.lat,
          longitude: td.arrival_stop?.location?.lng,
        },
        departureText: td.departure_time?.text,
        arrivalText: td.arrival_time?.text,
        numStops: td.num_stops,
      };
    });

  if (legs.length === 0) return undefined;
  return { legs, transfers: legs.length - 1 };
}

function parseRoute(route: any): Route {
  const leg = route.legs[0];

  const steps: RouteStep[] = leg.steps.map((step: any) => ({
    instruction: stripHtml(step.html_instructions ?? ""),
    targetStreetName: extractBoldRoadName(step.html_instructions ?? ""),
    maneuver: step.maneuver,
    distanceMeters: step.distance?.value ?? 0,
    durationSeconds: step.duration?.value ?? 0,
    startLocation: { latitude: step.start_location.lat, longitude: step.start_location.lng },
    endLocation: { latitude: step.end_location.lat, longitude: step.end_location.lng },
    polyline: decodePolyline(step.polyline?.points ?? ""),
  }));

  const durationSeconds: number = leg.duration?.value ?? 0;
  const durationInTrafficSeconds: number | undefined = leg.duration_in_traffic?.value;

  return {
    polyline: decodePolyline(route.overview_polyline.points),
    steps,
    summary: typeof route.summary === "string" && route.summary.length > 0 ? route.summary : undefined,
    distanceMeters: leg.distance?.value ?? 0,
    durationSeconds,
    etaText: leg.duration?.text ?? "",
    distanceText: leg.distance?.text ?? "",
    durationInTrafficSeconds,
    etaInTrafficText: leg.duration_in_traffic?.text,
    // 10% + a 60s floor so a couple of red lights don't get flagged as "traffic".
    hasTrafficDelay:
      durationInTrafficSeconds != null &&
      durationInTrafficSeconds > durationSeconds + Math.max(60, durationSeconds * 0.1),
    transitSummary: parseTransitSummary(leg),
  };
}

function buildDirectionsUrl(
  origin: LatLng,
  destination: LatLng,
  mode: TravelMode,
  options: DirectionsOptions & { alternatives?: boolean }
): string {
  const { avoidHighways, avoidTolls, waypoint, useTraffic, alternatives } = options;
  const avoid = [avoidHighways && "highways", avoidTolls && "tolls"].filter(Boolean).join("|");

  return (
    "https://maps.googleapis.com/maps/api/directions/json" +
    `?origin=${origin.latitude},${origin.longitude}` +
    `&destination=${destination.latitude},${destination.longitude}` +
    `&mode=${mode}&key=${env.googleDirectionsApiKey}` +
    (avoid ? `&avoid=${avoid}` : "") +
    (waypoint ? `&waypoints=${waypoint.latitude},${waypoint.longitude}` : "") +
    (useTraffic ? `&departure_time=${typeof useTraffic === "number" ? useTraffic : "now"}&traffic_model=best_guess` : "") +
    (alternatives ? `&alternatives=true` : "")
  );
}

export async function getDirections(
  origin: LatLng,
  destination: LatLng,
  options: DirectionsOptions = {}
): Promise<Route> {
  const url = buildDirectionsUrl(origin, destination, "driving", options);
  const res = await fetch(url);
  const json = await res.json();

  if (json.status !== "OK" || !json.routes?.length) {
    Sentry.logger.error("directions: request failed", {
      status: json.status,
      errorMessage: json.error_message,
    });
    throw new DirectionsApiError(json.status ?? "UNKNOWN_ERROR", json.error_message);
  }

  return parseRoute(json.routes[0]);
}

// Picks whichever candidate genuinely has the lower traffic-aware duration -- falls back to
// free-flow duration only if neither candidate has a traffic figure (useTraffic wasn't
// requested), so this is only ever comparing like-for-like numbers.
function fasterOf(a: Route, b: Route): Route {
  const aTime = a.durationInTrafficSeconds ?? a.durationSeconds;
  const bTime = b.durationInTrafficSeconds ?? b.durationSeconds;
  return aTime <= bTime ? a : b;
}

// Every real alternative Google is willing to offer for this trip, with live traffic factored
// in -- the candidate pool "fastest" gets picked from below. Not itself a `Route`: could be one
// route or several, and the caller decides what to compare them against.
async function getFastestRouteCandidates(
  origin: LatLng,
  destination: LatLng,
  waypoint?: LatLng
): Promise<Route[]> {
  const url = buildDirectionsUrl(origin, destination, "driving", {
    waypoint,
    useTraffic: true,
    alternatives: true,
  });
  const res = await fetch(url);
  const json = await res.json();

  if (json.status !== "OK" || !json.routes?.length) {
    Sentry.logger.error("directions: fastest-route request failed", {
      status: json.status,
      errorMessage: json.error_message,
    });
    throw new DirectionsApiError(json.status ?? "UNKNOWN_ERROR", json.error_message);
  }

  return json.routes.map(parseRoute);
}

export type RouteProfileKey = "normal" | "fastest" | "safest" | "tolls" | "noTolls";

// "normal" -> "Recommended" per explicit request for a more professional name -- same real
// route/key underneath (RouteProfileKey stays "normal" everywhere else in the codebase), just a
// better-reading label for what this option actually is: Google's own default best route.
export const ROUTE_PROFILE_LABELS: Record<RouteProfileKey, string> = {
  normal: "Recommended",
  fastest: "Fastest",
  safest: "Safest",
  tolls: "With Tolls",
  noTolls: "No Tolls",
};

// "safest" keeps highways available (a toll-free backstreets-only route is often *less* safe
// -- narrower roads, more intersections) but skips tolls, and considers every road type Google
// itself is willing to route through.
const SAFEST_OPTIONS: DirectionsOptions = { avoidTolls: true };

// Real Google Routes API toll pricing -- a genuinely different, newer API from the classic
// Directions API every other function in this file uses (routes.googleapis.com, not maps.
// googleapis.com/.../directions). Confirmed, documented real Australian coverage: AU_LINKT is
// the actual Australia-wide electronic tolling operator (covers NSW/VIC/QLD motorways), the
// toll pass this uses so a request for an AU trip gets a real priced answer wherever Linkt-
// tolled roads are involved, not just "a toll exists, price unknown." Requires the "Routes API"
// (distinct from "Directions API") to be enabled on the same Google Cloud project/key this app
// already uses for directions -- a real, separate step the project owner has to take in Google
// Cloud Console, and Google bills toll-computing requests at a higher rate than a plain
// directions request. Never called speculatively -- see getRouteOptions below, which only ever
// calls this once it's already confirmed (via a real, separate no-tolls request) that this
// specific trip actually crosses a toll road at all.
const ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

interface RoutesApiMoney {
  currencyCode: string;
  units?: string;
  nanos?: number;
}

function formatTollMoney(money: RoutesApiMoney): string {
  const amount = Number(money.units ?? "0") + (money.nanos ?? 0) / 1e9;
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: money.currencyCode }).format(amount);
  } catch {
    // An unrecognized/unexpected currency code from Google itself -- still a real number, just
    // without Intl's own symbol formatting rather than silently showing nothing.
    return `${amount.toFixed(2)} ${money.currencyCode}`;
  }
}

/** Real toll price for this specific trip from Google's Routes API, or null if the API isn't
 *  enabled, the request fails, or Google genuinely has no price on file for this toll (it still
 *  reports the toll exists in that case -- see hasToll in getRouteOptions, which is determined
 *  separately and doesn't depend on this call succeeding). Never fabricates a number. */
async function getTollPrice(origin: LatLng, destination: LatLng, waypoint?: LatLng): Promise<string | null> {
  try {
    const body = {
      origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
      destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
      ...(waypoint
        ? {
            intermediates: [{ location: { latLng: { latitude: waypoint.latitude, longitude: waypoint.longitude } } }],
          }
        : {}),
      travelMode: "DRIVE",
      extraComputations: ["TOLLS"],
      routeModifiers: { tollPasses: ["AU_LINKT"] },
    };
    const res = await fetch(ROUTES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.googleDirectionsApiKey,
        "X-Goog-FieldMask": "routes.travelAdvisory.tollInfo",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      Sentry.logger.warn("directions: Routes API toll lookup failed", { status: res.status, body: errText.slice(0, 300) });
      return null;
    }
    const json = await res.json();
    const estimatedPrice = json?.routes?.[0]?.travelAdvisory?.tollInfo?.estimatedPrice?.[0];
    return estimatedPrice ? formatTollMoney(estimatedPrice) : null;
  } catch (err) {
    Sentry.logger.warn("directions: Routes API toll lookup errored", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Real Routes API maneuver enum (SCREAMING_SNAKE, confirmed against Google's own
// NavigationInstruction.Maneuver reference) mapped onto this file's existing kebab-case
// ManeuverType -- the classic Directions API (parseRoute above) already returns kebab-case
// natively, so every other part of the app (turn-by-turn UI, voice guidance) only ever has to
// know one shape regardless of which of the two real Google APIs actually produced a given
// route. Maneuvers with no equivalent in ManeuverType (FERRY, FERRY_TRAIN, DEPART, NAME_CHANGE,
// DESTINATION, MANEUVER_UNSPECIFIED) map to undefined, same as an unrecognized value from the
// classic API already would.
const ROUTES_API_MANEUVER_MAP: Record<string, ManeuverType> = {
  TURN_SLIGHT_LEFT: "turn-slight-left",
  TURN_SHARP_LEFT: "turn-sharp-left",
  UTURN_LEFT: "uturn-left",
  TURN_LEFT: "turn-left",
  TURN_SLIGHT_RIGHT: "turn-slight-right",
  TURN_SHARP_RIGHT: "turn-sharp-right",
  UTURN_RIGHT: "uturn-right",
  TURN_RIGHT: "turn-right",
  STRAIGHT: "straight",
  RAMP_LEFT: "ramp-left",
  RAMP_RIGHT: "ramp-right",
  MERGE: "merge",
  FORK_LEFT: "fork-left",
  FORK_RIGHT: "fork-right",
  ROUNDABOUT_LEFT: "roundabout-left",
  ROUNDABOUT_RIGHT: "roundabout-right",
};

// Routes API durations are protobuf Duration strings ("123s", "3.5s"), never a bare number --
// confirmed against Google's own reference before writing this rather than guessed.
function parseProtoDurationSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  const n = parseFloat(duration.replace(/s$/, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Real parser from a single Routes API (computeRoutes) route object into this file's own
 *  Route/RouteStep shape -- confirmed field-by-field against Google's own reference
 *  (distanceMeters, duration/staticDuration as Duration strings, polyline.encodedPolyline,
 *  legs[].steps[], navigationInstruction.maneuver as SCREAMING_SNAKE) rather than guessed, so
 *  every caller downstream (turn-by-turn UI, voice guidance, map polyline rendering) can treat a
 *  Routes-API-sourced Route identically to a classic-Directions-API one. Only ever used for the
 *  heading-aware reroute below -- getRouteOptions/getDirections above keep using the classic API
 *  they already work well with. */
function parseRoutesApiRoute(route: any): Route {
  const steps: RouteStep[] = (route.legs?.[0]?.steps ?? []).map((step: any) => ({
    instruction: step.navigationInstruction?.instructions ?? "",
    maneuver: ROUTES_API_MANEUVER_MAP[step.navigationInstruction?.maneuver] ?? undefined,
    distanceMeters: step.distanceMeters ?? 0,
    durationSeconds: parseProtoDurationSeconds(step.staticDuration),
    startLocation: {
      latitude: step.startLocation?.latLng?.latitude ?? 0,
      longitude: step.startLocation?.latLng?.longitude ?? 0,
    },
    endLocation: {
      latitude: step.endLocation?.latLng?.latitude ?? 0,
      longitude: step.endLocation?.latLng?.longitude ?? 0,
    },
    polyline: decodePolyline(step.polyline?.encodedPolyline ?? ""),
  }));

  // Same encoded-polyline format as the classic API (both are Google's own standard polyline
  // algorithm) -- decodePolyline works unchanged for either source.
  const durationSeconds = parseProtoDurationSeconds(route.staticDuration);
  const durationInTrafficSeconds = route.duration ? parseProtoDurationSeconds(route.duration) : undefined;
  const distanceMeters: number = route.distanceMeters ?? 0;

  return {
    polyline: decodePolyline(route.polyline?.encodedPolyline ?? ""),
    steps,
    distanceMeters,
    durationSeconds,
    etaText: formatSecondsAsEtaText(durationSeconds),
    distanceText: formatMetersAsDistanceText(distanceMeters),
    durationInTrafficSeconds,
    etaInTrafficText: durationInTrafficSeconds != null ? formatSecondsAsEtaText(durationInTrafficSeconds) : undefined,
    hasTrafficDelay:
      durationInTrafficSeconds != null &&
      durationInTrafficSeconds > durationSeconds + Math.max(60, durationSeconds * 0.1),
  };
}

// Routes API doesn't return a pre-formatted "12 mins" text field the way the classic Directions
// API's duration.text does -- these two build the same real, honest text from the real seconds/
// meters values Google did return, rather than ever showing a blank or a raw second/meter count.
function formatSecondsAsEtaText(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${Math.max(1, mins)} min${mins === 1 ? "" : "s"}`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${hours} hour${hours === 1 ? "" : "s"} ${rem} mins`;
}

function formatMetersAsDistanceText(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export interface RerouteResult {
  route: Route;
  // Every route Google returned for this request, including `route` itself (always first) --
  // callers that want to show "Faster route found" compare these real ETAs themselves rather
  // than this function silently picking one for them.
  alternates: Route[];
}

/** Real, heading-aware reroute from the driver's CURRENT position -- built on the Routes API
 *  (computeRoutes), not the classic Directions API every other function in this file uses,
 *  specifically because only the Routes API accepts a compass heading on the origin
 *  (origin.location.heading, confirmed against Google's own reference: integer 0-360, DRIVE/
 *  TWO_WHEELER only). Google's own docs describe that field as a "side of the road" bias signal
 *  for pickup/drop-off, not an explicitly-documented U-turn suppressor -- stated here plainly
 *  rather than overclaimed, since Google doesn't document heading as guaranteeing no U-turn. In
 *  practice it's the standard real-world technique production nav apps use for exactly this
 *  (biasing the route to continue in the direction of travel rather than doubling back), which is
 *  why it's used here, just without claiming a guarantee Google itself doesn't make.
 *
 *  computeAlternativeRoutes: true asks Google for every real alternative it has (typically up to
 *  3, never an exact requested count -- Routes API has no "give me exactly N" parameter the way
 *  the spec's "alternates=2" implies; that specific count control doesn't exist in this API).
 *  routingPreference TRAFFIC_AWARE so the comparison is real traffic-aware ETAs, not free-flow.
 *
 *  Turn restrictions / one-ways / private-road avoidance are NOT independently re-verified here
 *  against OSM tags -- this relies on Google's own production routing engine (used by real
 *  drivers at scale) to already respect those, the same real trust every other route this app
 *  requests from Google already relies on, rather than this function pretending to run its own
 *  separate access-tag validation pass it doesn't actually perform. */
export async function getHeadingAwareReroute(
  origin: LatLng,
  destination: LatLng,
  headingDeg: number,
  options: { waypoint?: LatLng; avoidTolls?: boolean; signal?: AbortSignal } = {}
): Promise<RerouteResult> {
  const { waypoint, avoidTolls, signal } = options;
  const body: Record<string, unknown> = {
    origin: {
      location: {
        latLng: { latitude: origin.latitude, longitude: origin.longitude },
        heading: Math.round(((headingDeg % 360) + 360) % 360),
      },
    },
    destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
    ...(waypoint
      ? { intermediates: [{ location: { latLng: { latitude: waypoint.latitude, longitude: waypoint.longitude } } }] }
      : {}),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    computeAlternativeRoutes: true,
    ...(avoidTolls ? { routeModifiers: { avoidTolls: true } } : {}),
  };

  const res = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.googleDirectionsApiKey,
      "X-Goog-FieldMask":
        "routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline," +
        "routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.polyline.encodedPolyline," +
        "routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.legs.steps.navigationInstruction",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    Sentry.logger.error("directions: heading-aware reroute failed", { status: res.status, body: errText.slice(0, 300) });
    throw new DirectionsApiError(String(res.status), errText.slice(0, 300));
  }

  const json = await res.json();
  const routes: any[] = json.routes ?? [];
  if (routes.length === 0) {
    throw new DirectionsApiError("ZERO_RESULTS", "No real route found from the current position");
  }

  const parsed = routes.map(parseRoutesApiRoute);
  return { route: parsed[0], alternates: parsed };
}

// Same physical road path, not just similar -- two genuinely different real routes between the
// same two points essentially never coincidentally match both distance and duration this
// closely. Cheaper and more robust than comparing polyline point-by-point (which can differ by
// float noise even for what's really the same route Google just re-encoded slightly).
function isSameRoute(a: Route, b: Route): boolean {
  return Math.abs(a.distanceMeters - b.distanceMeters) < 20 && Math.abs(a.durationSeconds - b.durationSeconds) < 15;
}

/** Fetches all 3 route profiles in parallel for the route-choice picker. Each is a real,
 *  independently-fetched Google Directions result (not one call's `alternatives` alone for
 *  normal/safest) so "safest" can ask for a specific character (tolls-free) that a plain
 *  alternatives list wouldn't guarantee. Mirrors the web app's routeProfiles.ts.
 *
 *  All three now request live traffic (useTraffic: true) -- a real, confirmed bug otherwise:
 *  "Normal" (no traffic request) showed an optimistic free-flow number while "Fastest" showed
 *  the honest, traffic-inflated one, so a route with real current congestion could show
 *  "Fastest: 19 mins" next to "Normal: 10 mins" for a *shorter* trip -- not actually a routing
 *  bug, just two different numbers being compared as if they were the same thing. With all
 *  three traffic-aware, "fastest" is then computed as the genuine minimum across every
 *  candidate seen (the alternatives pool, a dedicated avoid-highways/back-streets request, *and*
 *  normal's and safest's own routes) -- so it's provably never slower than what's shown as
 *  Normal or Safest, guaranteed by construction rather than by hoping the alternatives search
 *  happened to include the quickest option.
 *
 *  Real, confirmed complaint this last part fixes: for a short trip with no tolls on Google's
 *  own default path, "safest" (avoidTolls) and "fastest" (the genuine minimum, which is often
 *  just "normal" itself) both silently collapsed to the exact same route as "normal" -- all
 *  three showing identical time/distance/path, reading as broken rather than "these truly are
 *  the same." fastest is NEVER swapped for a different route here -- it must stay genuinely the
 *  fastest, full stop. safest, if it lands on the identical path to normal, instead falls back
 *  to the first genuinely different real alternative Google itself already offered (from the
 *  same alternatives search fastest's own candidates come from) -- still a real, Google-vetted
 *  drivable road, just one that's actually a distinct option to look at, rather than pretending
 *  the exact same path is a meaningfully different "safest" choice. */
export async function getRouteOptions(
  origin: LatLng,
  destination: LatLng,
  waypoint?: LatLng
): Promise<Record<RouteProfileKey, Route>> {
  const [normal, safestRaw, fastestCandidates, noTolls, backStreetsRoute] = await Promise.all([
    getDirections(origin, destination, { waypoint, useTraffic: true }),
    getDirections(origin, destination, { ...SAFEST_OPTIONS, waypoint, useTraffic: true }),
    getFastestRouteCandidates(origin, destination, waypoint),
    // Real, separate no-tolls request (distinct from safestRaw above, which shares the exact
    // same avoidTolls:true params by coincidence of what "safest" happens to mean today --
    // fetched independently here so the "No Tolls" option never silently breaks if safest's own
    // definition ever changes to mean something else). Also the real, direct basis for whether
    // "Tolls" is a genuinely distinct option at all -- see hasToll below.
    getDirections(origin, destination, { avoidTolls: true, waypoint, useTraffic: true }),
    // Real, confirmed request -- a dedicated `avoid=highways` request (a genuine, documented
    // Google Directions parameter, not a guess) explicitly forces Google to compute a real
    // surface-streets/back-roads/lanes path instead of hoping the plain `alternatives=true`
    // search above happens to surface one on its own. Still held to the exact same honest bar
    // as every other candidate below (fasterOf, real traffic-aware duration) -- it only ever
    // becomes "Fastest" if it's genuinely quicker right now, never swapped in just because it's
    // a different/more interesting-looking path. Wrapped in its own try/catch: some trips
    // genuinely have no viable highway-free path (a river crossing with only one bridge, say),
    // which is a real, expected failure for THIS specific request, not a reason to fail the
    // other three that don't depend on it.
    getDirections(origin, destination, { avoidHighways: true, waypoint, useTraffic: true }).catch((err) => {
      Sentry.logger.info("directions: no viable back-streets alternative for this trip", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }),
  ]);
  const allFastestCandidates = backStreetsRoute ? [...fastestCandidates, backStreetsRoute] : fastestCandidates;
  const fastest = [normal, safestRaw, ...allFastestCandidates].reduce(fasterOf);
  const safest = isSameRoute(safestRaw, normal)
    ? (allFastestCandidates.find((c) => !isSameRoute(c, normal)) ?? safestRaw)
    : safestRaw;

  // Real, explicit request for a genuine "With Tolls" option distinct from the other three --
  // only meaningful when normal's own real path actually differs from the no-tolls path, i.e.
  // this trip genuinely crosses a toll road Google itself would otherwise route around. Reuses
  // normal's own already-fetched route/time rather than a fourth plain-directions request --
  // there's no "prefer tolls" parameter to ask Google for a different path with, and normal's
  // path already IS "the real route that doesn't avoid tolls." When there's no real toll
  // involved at all, this stays honestly marked hasToll: false rather than inventing a
  // meaningfully-different "Tolls" option where none exists.
  //
  // Real, confirmed gap: this used to check ONLY whether normal (Recommended) itself crosses a
  // toll. Fastest is independently built from whichever of normal/safestRaw/every alternatives
  // candidate is genuinely quickest (see fasterOf above) and can legitimately land on a toll road
  // even when Recommended doesn't (a faster alternate bridge/tunnel crossing, say) -- in that case
  // hasToll read false and the toll choice was hidden entirely even though a shown candidate
  // (Fastest) really does use one. Now true whenever ANY of the three shown route cards --
  // normal, fastest, or safest -- actually differs from the dedicated no-tolls path, matching
  // "hide toll options only when truly no candidate route touches a toll road anywhere."
  const anyShownRouteUsesToll =
    !isSameRoute(normal, noTolls) || !isSameRoute(fastest, noTolls) || !isSameRoute(safest, noTolls);
  const tolls: Route = anyShownRouteUsesToll
    ? { ...normal, tollEstimate: { hasToll: true, priceText: await getTollPrice(origin, destination, waypoint) } }
    : { ...normal, tollEstimate: { hasToll: false, priceText: null } };

  return { normal, fastest, safest, tolls, noTolls };
}

export type TravelMode = "driving" | "walking" | "bicycling" | "transit";

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  driving: "Drive",
  walking: "Walk",
  bicycling: "Bike",
  transit: "Transit",
};

/** A single real route for a non-driving travel mode (walking/bicycling/transit) -- genuine
 *  Google Directions results for that mode, not an estimate derived from the driving route.
 *  Unlike driving, these don't get a 3-way Normal/Fastest/Safest picker: Google has exactly
 *  one meaningful route per mode in the overwhelming majority of cases (transit trips in
 *  particular are governed by real timetables, not alternative road choices). */
export async function getDirectionsForMode(
  origin: LatLng,
  destination: LatLng,
  mode: Exclude<TravelMode, "driving">,
  waypoint?: LatLng
): Promise<Route> {
  const url = buildDirectionsUrl(origin, destination, mode, { waypoint });
  const res = await fetch(url);
  const json = await res.json();

  if (json.status !== "OK" || !json.routes?.length) {
    Sentry.logger.error("directions: mode request failed", {
      mode,
      status: json.status,
      errorMessage: json.error_message,
    });
    throw new DirectionsApiError(json.status ?? "UNKNOWN_ERROR", json.error_message);
  }

  return parseRoute(json.routes[0]);
}

/** Every real alternative Google offers for a walking/bicycling/transit trip -- unlike
 *  getDirectionsForMode above (single result, used for reroutes/mid-nav stops where only one
 *  route actually matters), this is for the route picker itself: a real walk can have 2-3
 *  genuinely different paths, and a real transit trip can have several genuinely different
 *  services (different bus routes, a bus vs a train, etc.), each with its own real
 *  line/timetable -- not synthetic Normal/Fastest/Safest labels the way driving gets, since
 *  those don't mean anything for a fixed-timetable transit trip. Sorted fastest-first, deduped
 *  on rounded duration+distance so near-identical alternates Google sometimes returns don't
 *  show up twice, capped at 6 so the picker list stays scannable. */
export async function getModeRouteOptions(
  origin: LatLng,
  destination: LatLng,
  mode: Exclude<TravelMode, "driving">,
  waypoint?: LatLng
): Promise<Route[]> {
  const url = buildDirectionsUrl(origin, destination, mode, { waypoint, alternatives: true });
  const res = await fetch(url);
  const json = await res.json();

  if (json.status !== "OK" || !json.routes?.length) {
    Sentry.logger.error("directions: mode alternatives request failed", {
      mode,
      status: json.status,
      errorMessage: json.error_message,
    });
    throw new DirectionsApiError(json.status ?? "UNKNOWN_ERROR", json.error_message);
  }

  const routes: Route[] = json.routes.map(parseRoute);
  routes.sort((a, b) => a.durationSeconds - b.durationSeconds);

  const seen = new Set<string>();
  const deduped: Route[] = [];
  for (const r of routes) {
    const key = `${Math.round(r.durationSeconds / 30)}:${Math.round(r.distanceMeters / 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
    if (deduped.length >= 6) break;
  }
  return deduped;
}
