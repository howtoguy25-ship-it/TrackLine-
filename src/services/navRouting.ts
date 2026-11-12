// The route that's navigated comes from Mapbox (lanes and exits that match the line drawn).
// These helpers fetch it for a new drive and for reroutes; when Mapbox can't answer (no token,
// no signal, an error) the callers keep the Google route they already have.

import { env } from "@/config/env";
import type { LatLng } from "@/utils/polyline";
import type { Route } from "@/services/directions";
import { sharedPathFraction, type RouteAvoidPrefs } from "@/map/routeChoices";
import { REROUTE_TIMEOUT_MS, closestRoute, fetchMapboxRoutes } from "@/services/mapboxDirections";

export function mapboxRoutingAvailable(): boolean {
  return !!env.mapboxPublicToken;
}

function hasUturn(route: Route): boolean {
  return route.steps.some((s) => typeof s.maneuver === "string" && s.maneuver.startsWith("uturn"));
}

function eta(route: Route): number {
  return route.durationInTrafficSeconds ?? route.durationSeconds;
}

/** Fastest route, avoiding U-turns when any route manages without one. */
export function pickReroute(routes: Route[]): Route | null {
  if (routes.length === 0) return null;
  const noUturn = routes.filter((r) => !hasUturn(r));
  const pool = noUturn.length ? noUturn : routes;
  return pool.reduce((best, r) => (eta(r) < eta(best) ? r : best), pool[0]);
}

/** The Mapbox version of the route the driver picked from the (Google) route choices. */
export async function mapboxRouteForChoice(
  picked: Route,
  origin: LatLng,
  destination: LatLng,
  avoid: RouteAvoidPrefs,
  heading: number | null
): Promise<Route | null> {
  if (!mapboxRoutingAvailable()) return null;
  const routes = await fetchMapboxRoutes({ origin, destination, avoid, heading }, env.mapboxPublicToken, { timeoutMs: 8000 });
  return closestRoute(routes, picked.polyline, (a, b) => sharedPathFraction(a, b));
}

/** A fresh Mapbox route from where the driver is now, with live traffic, inside ~2 s. */
export async function mapboxReroute(
  origin: LatLng,
  destination: LatLng,
  heading: number | null,
  avoid: RouteAvoidPrefs,
  signal: AbortSignal
): Promise<Route> {
  const routes = await fetchMapboxRoutes({ origin, destination, heading, avoid }, env.mapboxPublicToken, {
    signal,
    timeoutMs: REROUTE_TIMEOUT_MS,
  });
  const chosen = pickReroute(routes);
  if (!chosen) throw new Error("Mapbox reroute: no route");
  return chosen;
}
