// Routes for each travel mode, from the provider that actually has them, with a short cache so
// switching modes back and forth doesn't refetch (2 minutes -- traffic and timetables move).
//
//   Drive      Google route choices -- the SAME source and result as the route preview card
//              ("19 min via M5"), so the two can never disagree. The navigated route is then
//              matched on Mapbox (navRouting.ts) when Mapbox works, else the Google route is driven.
//              Mapbox driving-traffic only when this build has no Google fallback wired.
//   Motorbike  Google Routes API travelMode TWO_WHEELER. Google only supports it in some
//              countries; anywhere it doesn't answer, the driving route is shown with
//              "Motorbike routes use car roads here" -- never presented as a motorbike route.
//   Bike       Mapbox cycling  (Google bicycling if Mapbox refuses: bad key, server error, timeout)
//   Walk       Mapbox walking  (Google walking, same rule)
//   Transit    Google transit (getModeRouteOptions)
//   Ferry      not fetched: the real drive/transit options that include a ferry (modes.ts)

import type { LatLng } from "@/utils/polyline";
import type { Route } from "@/services/directions";
import { ROUTES_API_URL, parseRoutesApiRoute } from "@/services/directions";
import { fetchMapboxRoutes, type MapboxProfile } from "@/services/mapboxDirections";
import type { RouteAvoidPrefs } from "@/map/routeChoices";
import type { ModeId } from "@/travel/modes";
import { mapboxTokenState } from "@/config/mapboxToken";
import { recordDirections } from "@/diagnostics/diagnostics";
import { ROUTING_ERROR_TEXT, RoutingError, shouldFallBack } from "@/services/routingErrors";

export const MODE_CACHE_MS = 2 * 60 * 1000;
export const MOTORBIKE_FALLBACK_NOTE = "Motorbike routes use car roads here";

export interface ModeRoutes {
  routes: Route[];
  /** Shown under the routes (e.g. the motorbike fallback). */
  note: string | null;
  /** Why the mode can't be used for this trip (the icon is greyed with this). */
  unavailable: string | null;
}

export interface ModeRequest {
  origin: LatLng;
  destination: LatLng;
  avoid?: Partial<RouteAvoidPrefs>;
  heading?: number | null;
}

export interface ModeDeps {
  mapboxToken: string;
  googleKey: string;
  transit: (origin: LatLng, destination: LatLng) => Promise<Route[]>;
  /** Google routes for drive / bike / walk when this build has no Mapbox token. */
  fallback?: (mode: "drive" | "bike" | "walk", origin: LatLng, destination: LatLng) => Promise<Route[]>;
  fetchImpl?: typeof fetch;
}

const PROFILE: Partial<Record<ModeId, MapboxProfile>> = { drive: "driving-traffic", bike: "cycling", walk: "walking" };

const NO_ROUTE: Partial<Record<ModeId, string>> = {
  drive: "No driving route between these places",
  motorbike: "No motorbike route between these places",
  bike: "No bike route between these places",
  walk: "No walking route between these places",
  transit: "No public transport for this trip right now",
};

/** The Routes API request for a motorbike trip. */
export function motorbikeRequestBody(req: ModeRequest) {
  const at = (p: LatLng) => ({ location: { latLng: { latitude: p.latitude, longitude: p.longitude } } });
  return {
    origin: at(req.origin),
    destination: at(req.destination),
    travelMode: "TWO_WHEELER",
    routingPreference: "TRAFFIC_AWARE",
    computeAlternativeRoutes: true,
    routeModifiers: { avoidTolls: !!req.avoid?.tolls, avoidHighways: !!req.avoid?.motorways, avoidFerries: !!req.avoid?.ferries },
  };
}

export const MOTORBIKE_FIELD_MASK =
  "routes.duration,routes.staticDuration,routes.distanceMeters,routes.description,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.legs.steps.polyline.encodedPolyline";

async function motorbikeRoutes(req: ModeRequest, deps: ModeDeps): Promise<Route[] | null> {
  if (!deps.googleKey) return null;
  try {
    const res = await (deps.fetchImpl ?? fetch)(ROUTES_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": deps.googleKey, "X-Goog-FieldMask": MOTORBIKE_FIELD_MASK },
      body: JSON.stringify(motorbikeRequestBody(req)),
    });
    // Unsupported region / mode answers with an error or no routes: fall back.
    if (!res.ok) return null;
    const json = await res.json();
    const routes = Array.isArray(json?.routes) ? json.routes.map((r: unknown) => parseRoutesApiRoute(r)) : [];
    return routes.length ? routes : null;
  } catch {
    return null;
  }
}

async function googleFor(mode: "drive" | "bike" | "walk", req: ModeRequest, deps: ModeDeps): Promise<Route[]> {
  const routes = await deps.fallback!(mode, req.origin, req.destination);
  recordDirections(mode, { provider: "google", status: 200, ok: routes.length > 0, message: routes.length ? `${routes.length} route${routes.length === 1 ? "" : "s"}` : "No route found" });
  return routes;
}

async function mapboxFor(mode: ModeId, req: ModeRequest, deps: ModeDeps): Promise<Route[]> {
  const viaGoogle = deps.fallback && (mode === "drive" || mode === "bike" || mode === "walk") ? (mode as "drive" | "bike" | "walk") : null;
  // Drive: always the Google choices the preview card shows (one source, one answer).
  if (viaGoogle === "drive") return googleFor("drive", req, deps);
  if (viaGoogle && mapboxTokenState(deps.mapboxToken) !== "ok") return googleFor(viaGoogle, req, deps);
  try {
    return await fetchMapboxRoutes({ ...req, profile: PROFILE[mode] }, deps.mapboxToken, { fetchImpl: deps.fetchImpl, timeoutMs: 8000, diagnosticsKey: mode });
  } catch (err) {
    // Mapbox refused (key, server, timeout): Google still knows the roads.
    if (viaGoogle && shouldFallBack(err)) return googleFor(viaGoogle, req, deps);
    throw err;
  }
}

function reasonFor(mode: ModeId, err: unknown): string {
  if (err instanceof RoutingError) return err.kind === "no_route" ? (NO_ROUTE[mode] ?? ROUTING_ERROR_TEXT.no_route) : err.userText;
  if (err instanceof TypeError && /network/i.test(err.message)) return ROUTING_ERROR_TEXT.offline;
  const msg = err instanceof Error ? err.message : String(err);
  if (/NoRoute|NoSegment/.test(msg)) return NO_ROUTE[mode] ?? ROUTING_ERROR_TEXT.no_route;
  return `Couldn't get routes: ${msg.slice(0, 80)}`;
}

/** Routes for one mode. Never throws: a failure becomes `unavailable` with the real reason. */
export async function fetchRoutesForMode(mode: ModeId, req: ModeRequest, deps: ModeDeps): Promise<ModeRoutes> {
  const canRoute = mapboxTokenState(deps.mapboxToken) === "ok" || !!deps.fallback;
  try {
    if (mode === "ferry") return { routes: [], note: null, unavailable: "Shown from the drive and transit options" };
    if (mode === "transit") {
      const routes = await deps.transit(req.origin, req.destination);
      return { routes, note: null, unavailable: routes.length ? null : NO_ROUTE.transit! };
    }
    if (mode === "motorbike") {
      const bike = await motorbikeRoutes(req, deps);
      if (bike) return { routes: bike, note: null, unavailable: null };
      if (!canRoute) return { routes: [], note: null, unavailable: ROUTING_ERROR_TEXT.key_missing };
      const car = await mapboxFor("drive", req, deps);
      return { routes: car, note: car.length ? MOTORBIKE_FALLBACK_NOTE : null, unavailable: car.length ? null : NO_ROUTE.motorbike! };
    }
    if (!canRoute) return { routes: [], note: null, unavailable: ROUTING_ERROR_TEXT.key_missing };
    const routes = await mapboxFor(mode, req, deps);
    return { routes, note: null, unavailable: routes.length ? null : NO_ROUTE[mode]! };
  } catch (err) {
    console.warn(`[routes] ${mode} failed:`, err instanceof Error ? err.message : err);
    return { routes: [], note: null, unavailable: reasonFor(mode, err) };
  }
}

/** Fastest time for the icon row ("—" when unavailable). */
export function fastestSeconds(r: ModeRoutes | undefined): number | null {
  if (!r || r.unavailable || !r.routes.length) return null;
  return Math.min(...r.routes.map((x) => x.durationInTrafficSeconds ?? x.durationSeconds));
}

/** Per-trip cache: the selected mode is fetched first, the others when the row asks. */
export class ModeRouteCache {
  private entries = new Map<string, { at: number; value: Promise<ModeRoutes> }>();
  constructor(
    private readonly fetcher: (mode: ModeId, req: ModeRequest) => Promise<ModeRoutes>,
    private readonly now: () => number = Date.now
  ) {}

  static key(mode: ModeId, req: ModeRequest): string {
    const p = (x: LatLng) => `${x.latitude.toFixed(4)},${x.longitude.toFixed(4)}`;
    const a = req.avoid ?? {};
    return `${mode}|${p(req.origin)}|${p(req.destination)}|${a.tolls ? 1 : 0}${a.motorways ? 1 : 0}${a.ferries ? 1 : 0}${a.unpaved ? 1 : 0}`;
  }

  get(mode: ModeId, req: ModeRequest): Promise<ModeRoutes> {
    const k = ModeRouteCache.key(mode, req);
    const hit = this.entries.get(k);
    if (hit && this.now() - hit.at < MODE_CACHE_MS) return hit.value;
    const value = this.fetcher(mode, req);
    this.entries.set(k, { at: this.now(), value });
    // A failed fetch isn't kept: the next ask tries again.
    value.then((v) => {
      if (v.unavailable && !v.unavailable.startsWith("No ") && v.unavailable !== "Shown from the drive and transit options") this.entries.delete(k);
    });
    return value;
  }
}

/** Bike: the stretches where the rider walks the bike (steps, footpaths), as distances. */
export function walkTheBikeStretches(route: Route): { meters: number; at: LatLng }[] {
  return route.steps.filter((s) => s.pushingBike && s.distanceMeters > 0).map((s) => ({ meters: Math.round(s.distanceMeters), at: s.startLocation }));
}
