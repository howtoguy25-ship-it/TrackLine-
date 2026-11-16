// The six ways to travel, and what each needs from the data. Pure: the mode sheet, the route
// list and the tests all read these.
//
//   Drive     Mapbox driving-traffic
//   Motorbike Google Routes TWO_WHEELER where Google supports it; else the driving route, with
//             "Motorbike routes use car roads here"
//   Bike      Mapbox cycling
//   Walk      Mapbox walking
//   Transit   Google transit (+ TfNSW Trip Planner / realtime in NSW)
//   Ferry     only when a real option includes a ferry or boat leg -- never offered otherwise

import type { Route, RouteStep } from "@/services/directions";

export type ModeId = "drive" | "motorbike" | "bike" | "walk" | "transit" | "ferry";

export const MODE_ORDER: ModeId[] = ["drive", "motorbike", "bike", "walk", "transit", "ferry"];

export const MODE_LABELS: Record<ModeId, string> = {
  drive: "Drive",
  motorbike: "Motorbike",
  bike: "Bike",
  walk: "Walk",
  transit: "Transit",
  ferry: "Ferry",
};

export const DEFAULT_MODE: ModeId = "drive";

/** A remembered mode from storage, or Drive if it isn't one we know. */
export function asModeId(v: unknown): ModeId {
  return typeof v === "string" && (MODE_ORDER as string[]).includes(v) ? (v as ModeId) : DEFAULT_MODE;
}

export interface FerryLeg {
  name: string | null;
  distanceMeters: number;
  durationSeconds: number;
  from: { latitude: number; longitude: number };
  to: { latitude: number; longitude: number };
  /** True on a driving route (the car goes on the ferry); false for a passenger service; null unknown. */
  carsAllowed: boolean | null;
  /** Departure/arrival wharf and times, when the provider gives them (transit). */
  departureStop?: string;
  arrivalStop?: string;
  departureText?: string;
  arrivalText?: string;
}

function stepFerry(step: RouteStep): FerryLeg | null {
  if (!step.ferry) return null;
  return {
    name: step.ferry.name,
    distanceMeters: step.distanceMeters,
    durationSeconds: step.durationSeconds,
    from: step.startLocation,
    to: step.endLocation,
    carsAllowed: true,
  };
}

/** Every ferry/boat crossing on a route: driving steps marked ferry, and transit FERRY legs. */
export function ferryLegs(route: Route): FerryLeg[] {
  const out: FerryLeg[] = route.steps.map(stepFerry).filter((f): f is FerryLeg => !!f);
  for (const leg of route.transitSummary?.legs ?? []) {
    if (leg.vehicleType !== "FERRY") continue;
    out.push({
      name: leg.lineName || null,
      distanceMeters: 0,
      durationSeconds: 0,
      from: leg.departureLocation,
      to: leg.arrivalLocation,
      carsAllowed: false,
      departureStop: leg.departureStop,
      arrivalStop: leg.arrivalStop,
      departureText: leg.departureText,
      arrivalText: leg.arrivalText,
    });
  }
  return out;
}

export function routeHasFerry(route: Route): boolean {
  return ferryLegs(route).length > 0;
}

/** Ferry is offered only when some real option (any mode's routes) includes a ferry leg. */
export function ferryModeAvailable(optionsByMode: Partial<Record<ModeId, Route[] | null>>): boolean {
  return MODE_ORDER.some((m) => m !== "ferry" && (optionsByMode[m] ?? []).some(routeHasFerry));
}

/** The Ferry tab's options: every real option with a ferry leg, from drive and transit. */
export function ferryOptions(optionsByMode: Partial<Record<ModeId, Route[] | null>>): { mode: ModeId; route: Route }[] {
  const out: { mode: ModeId; route: Route }[] = [];
  for (const m of ["transit", "drive"] as ModeId[]) for (const r of optionsByMode[m] ?? []) if (routeHasFerry(r)) out.push({ mode: m, route: r });
  return out;
}

/** "Includes ferry" on a drive route card. */
export function ferryBadge(route: Route): string | null {
  const legs = ferryLegs(route);
  if (!legs.length) return null;
  const named = legs.find((l) => l.name)?.name;
  return named ? `Includes ferry (${named})` : "Includes ferry";
}
