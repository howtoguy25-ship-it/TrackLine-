// Mapbox Directions (profile driving-traffic): the route that's actually navigated, so the lanes,
// exits and junction views match the line on the map. Google still does search, place pages and
// the route-choice preview times.
//
// The parser (`parseMapboxResponse`) is pure and also reads OSRM responses, whose format Mapbox's
// API shares (minus banner/voice instructions); the recorded test routes in src/dev/testRoutes
// are real OSRM responses over OpenStreetMap data.
//
// Steps come out in the app's convention: each step's instruction, manoeuvre and lanes describe
// the manoeuvre at the step's END -- which is how the card, the voice and the countdown read them.

import type { LatLng } from "@/utils/polyline";
import { decodePolyline } from "@/utils/polyline";
import type { Route, RouteStep } from "@/services/directions";
import type { RouteAvoidPrefs, SpeedInterval } from "@/map/routeChoices";
import { parseBannerLanes, parseIntersectionLanes, type Lane } from "@/nav/lanes";
import { maneuverTypeFor, manoeuvreKindFor, sideOf } from "@/nav/manoeuvre";

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MapboxRequest {
  origin: LatLng;
  destination: LatLng;
  /** Degrees, so the route starts the way the car is facing (reroutes). */
  heading?: number | null;
  avoid?: Partial<RouteAvoidPrefs>;
  alternatives?: boolean;
  language?: string;
}

/** What Mapbox's `exclude` can express from the driver's Avoid settings. */
export function excludeParam(avoid: Partial<RouteAvoidPrefs> | undefined): string | null {
  if (!avoid) return null;
  const out: string[] = [];
  if (avoid.tolls) out.push("toll");
  if (avoid.motorways) out.push("motorway");
  if (avoid.ferries) out.push("ferry");
  if (avoid.unpaved) out.push("unpaved");
  return out.length ? out.join(",") : null;
}

export function directionsUrl(req: MapboxRequest, token: string): string {
  const coords = `${req.origin.longitude},${req.origin.latitude};${req.destination.longitude},${req.destination.latitude}`;
  const params: Record<string, string> = {
    steps: "true",
    banner_instructions: "true",
    voice_instructions: "true",
    overview: "full",
    geometries: "polyline6",
    annotations: "congestion,maxspeed",
    alternatives: req.alternatives === false ? "false" : "true",
    language: req.language ?? "en",
    access_token: token,
  };
  const exclude = excludeParam(req.avoid);
  if (exclude) params.exclude = exclude;
  if (req.heading != null && Number.isFinite(req.heading)) {
    params.bearings = `${Math.round(((req.heading % 360) + 360) % 360)},45;`;
  }
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?${query}`;
}

function point(location: any): LatLng {
  return { latitude: location?.[1] ?? 0, longitude: location?.[0] ?? 0 };
}

function roadName(step: any): string | undefined {
  const name = typeof step?.name === "string" && step.name.trim() ? step.name.trim() : undefined;
  const ref = typeof step?.ref === "string" && step.ref.trim() ? step.ref.split(";")[0].trim() : undefined;
  return name ?? ref;
}

function destinationText(step: any): string | undefined {
  const d = typeof step?.destinations === "string" ? step.destinations.trim() : "";
  if (!d) return undefined;
  // "M4: Sydney, Parramatta" -> "Sydney"; keep it short.
  const afterRef = d.includes(":") ? d.split(":").slice(1).join(":") : d;
  return afterRef.split(",")[0].trim() || undefined;
}

/** A plain instruction when the data has none of its own (OSRM). */
export function composeInstruction(step: any): string {
  const m = step?.maneuver ?? {};
  const type: string = m.type ?? "";
  const modifier: string | undefined = m.modifier;
  const side = sideOf(modifier);
  const road = roadName(step);
  const toward = destinationText(step);
  const onto = road ? ` onto ${road}` : "";
  switch (type) {
    case "arrive":
      return "You've arrived";
    case "depart":
      return road ? `Head along ${road}` : "Head off";
    case "off ramp": {
      const exit = typeof step.exits === "string" && step.exits ? `Take exit ${step.exits.split(";")[0]}` : "Take the exit";
      return toward ? `${exit} towards ${toward}` : road ? `${exit} to ${road}` : exit;
    }
    case "on ramp":
      return `Take the ramp${onto}`;
    case "merge":
      return `Merge${side ? ` ${side}` : ""}${onto}`;
    case "fork":
      return `Keep ${side ?? "straight"}${toward ? ` towards ${toward}` : onto}`;
    case "roundabout":
    case "rotary":
    case "exit roundabout": {
      const n = Number(m.exit);
      const ordinal = n >= 1 && n <= ORDINALS.length ? ORDINALS[n - 1] : null;
      return ordinal ? `At the roundabout, take the ${ordinal} exit${onto}` : `At the roundabout, go${onto || " through"}`;
    }
    default:
      if (modifier === "uturn") return `Make a U-turn${onto}`;
      if (!modifier || modifier === "straight") return `Continue${onto}`;
      return `${modifier.startsWith("slight") ? "Keep" : "Turn"} ${modifier.replace("slight ", "").replace("sharp ", "")}${onto}`;
  }
}

/** The banner (Mapbox) that describes the manoeuvre at the end of this step: the last one. */
function lastBanner(step: any): any | null {
  const banners: any[] = Array.isArray(step?.bannerInstructions) ? step.bannerInstructions : [];
  return banners.length ? banners[banners.length - 1] : null;
}

function guidanceView(banner: any): string | undefined {
  const view = banner?.view;
  const components: any[] = Array.isArray(view?.components) ? view.components : [];
  const image = components.find((c) => c?.type === "guidance-view" && typeof c.imageURL === "string");
  return image?.imageURL;
}

function exitNumberFrom(step: any, banner: any): string | undefined {
  const components: any[] = Array.isArray(banner?.primary?.components) ? banner.primary.components : [];
  const fromBanner = components.find((c) => c?.type === "exit-number" && c.text)?.text;
  if (fromBanner) return String(fromBanner);
  const type = step?.maneuver?.type;
  if (type === "off ramp" && typeof step?.exits === "string" && step.exits) return step.exits.split(";")[0];
  return undefined;
}

/**
 * Builds the app's steps from Mapbox/OSRM steps (manoeuvre at each step's START) so each of
 * ours carries the manoeuvre at its END: ours[i] = their step i's road, with step i+1's
 * manoeuvre, lanes and exit. Their final "arrive" step becomes our last step's manoeuvre.
 */
export function toAppSteps(mbSteps: any[], drivingSide: "left" | "right" = "left"): RouteStep[] {
  const steps: RouteStep[] = [];
  for (let i = 0; i < mbSteps.length; i++) {
    const here = mbSteps[i];
    const next = mbSteps[i + 1] ?? null;
    if (!next && i > 0 && here?.maneuver?.type === "arrive") break; // folded into the previous step
    const target = next ?? here;
    const m = target.maneuver ?? {};
    const banner = lastBanner(here);
    const lanes: Lane[] | null =
      parseBannerLanes(banner?.sub?.components) ?? parseIntersectionLanes(target?.intersections?.[0]?.lanes);
    const roads = Array.isArray(target?.intersections?.[0]?.bearings) ? target.intersections[0].bearings.length : 0;
    const instruction: string = (typeof m.instruction === "string" && m.instruction) || banner?.primary?.text || composeInstruction(target);
    const polyline = decodePolyline(here?.geometry ?? "", 6);
    steps.push({
      instruction,
      targetStreetName: next ? roadName(next) : undefined,
      maneuver: maneuverTypeFor(m.type ?? "", m.modifier, drivingSide),
      distanceMeters: here?.distance ?? 0,
      durationSeconds: here?.duration ?? 0,
      startLocation: point(here?.maneuver?.location),
      endLocation: next ? point(next.maneuver?.location) : polyline[polyline.length - 1] ?? point(here?.maneuver?.location),
      polyline,
      lanes: lanes ?? undefined,
      exitNumber: next ? exitNumberFrom(next, banner) : undefined,
      roadRef: typeof target?.ref === "string" && target.ref ? target.ref.split(";")[0].trim() : undefined,
      maneuverKind: next ? manoeuvreKindFor(m.type ?? "", m.modifier, lanes, roads) : "arrive",
      maneuverSide: sideOf(m.modifier),
      guidanceViewUrl: guidanceView(banner),
    });
  }
  return steps;
}

const CONGESTION_SPEED: Record<string, SpeedInterval["speed"] | undefined> = {
  moderate: "SLOW",
  heavy: "TRAFFIC_JAM",
  severe: "TRAFFIC_JAM",
};

/** Mapbox per-segment congestion -> the app's slow / jammed index ranges along the polyline. */
export function congestionIntervals(congestion: unknown): SpeedInterval[] | undefined {
  if (!Array.isArray(congestion) || congestion.length === 0) return undefined;
  const out: SpeedInterval[] = [];
  for (let i = 0; i < congestion.length; i++) {
    const speed = CONGESTION_SPEED[String(congestion[i])];
    if (!speed) continue;
    const last = out[out.length - 1];
    if (last && last.speed === speed && last.endIndex === i) last.endIndex = i + 1;
    else out.push({ startIndex: i, endIndex: i + 1, speed });
  }
  return out;
}

function maxSpeeds(raw: unknown): (number | null)[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((s: any) => {
    if (!s || s.unknown || s.none || typeof s.speed !== "number") return null;
    return s.unit === "mph" ? Math.round(s.speed * 1.609) : s.speed;
  });
}

function formatMinutes(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

function formatKm(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function parseMapboxRoute(route: any): Route {
  const leg = route?.legs?.[0] ?? {};
  const drivingSide = leg.steps?.[0]?.driving_side === "right" ? "right" : "left";
  const steps = toAppSteps(leg.steps ?? [], drivingSide);
  const polyline = decodePolyline(route?.geometry ?? "", 6);
  const duration: number = route?.duration ?? 0;
  const typical: number | undefined = typeof route?.duration_typical === "number" ? route.duration_typical : undefined;
  return {
    polyline: polyline.length ? polyline : steps.flatMap((s) => s.polyline),
    steps,
    summary: typeof leg.summary === "string" && leg.summary ? leg.summary : undefined,
    distanceMeters: route?.distance ?? 0,
    durationSeconds: typical ?? duration,
    durationInTrafficSeconds: duration,
    etaText: formatMinutes(typical ?? duration),
    etaInTrafficText: formatMinutes(duration),
    distanceText: formatKm(route?.distance ?? 0),
    hasTrafficDelay: typical != null && duration > typical * 1.1,
    speedIntervals: congestionIntervals(leg.annotation?.congestion),
    maxSpeedsKmh: maxSpeeds(leg.annotation?.maxspeed),
    source: "mapbox",
  };
}

/** Every route in a Directions response, best first. Throws on an error response. */
export function parseMapboxResponse(json: any): Route[] {
  if (!json || json.code !== "Ok" || !Array.isArray(json.routes)) {
    throw new Error(`Mapbox directions failed: ${json?.code ?? "no response"}${json?.message ? ` (${json.message})` : ""}`);
  }
  return json.routes.map(parseMapboxRoute);
}

/** How long a reroute may take before it's abandoned (the brief: about 2 s). */
export const REROUTE_TIMEOUT_MS = 2500;

export async function fetchMapboxRoutes(
  req: MapboxRequest,
  token: string,
  options: { signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<Route[]> {
  if (!token) throw new Error("Mapbox directions: no access token");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort);
  try {
    const res = await (options.fetchImpl ?? fetch)(directionsUrl(req, token), { signal: controller.signal });
    const json = await res.json();
    return parseMapboxResponse(json);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * One reroute at a time: a new request cancels the one still in flight, so a driver weaving
 * off-route never gets an older answer arriving after a newer one.
 */
export class RerouteRequester {
  private inFlight: AbortController | null = null;

  constructor(private readonly fetcher: (req: MapboxRequest, signal: AbortSignal) => Promise<Route[]>) {}

  get busy(): boolean {
    return this.inFlight !== null;
  }

  async request(req: MapboxRequest): Promise<Route[] | null> {
    this.inFlight?.abort();
    const mine = new AbortController();
    this.inFlight = mine;
    try {
      const routes = await this.fetcher(req, mine.signal);
      return mine.signal.aborted ? null : routes;
    } catch (e) {
      if (mine.signal.aborted) return null;
      throw e;
    } finally {
      if (this.inFlight === mine) this.inFlight = null;
    }
  }

  cancel(): void {
    this.inFlight?.abort();
    this.inFlight = null;
  }
}

/** The Mapbox route that best matches the one the driver picked (shares the most road). */
export function closestRoute(routes: Route[], picked: LatLng[], shared: (a: LatLng[], b: LatLng[]) => number): Route | null {
  let best: Route | null = null;
  let bestShare = -1;
  for (const r of routes) {
    const share = shared(r.polyline, picked);
    if (share > bestShare) {
      best = r;
      bestShare = share;
    }
  }
  return best;
}
