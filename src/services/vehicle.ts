// Waze-match §3: "What's your ride?" -- the vehicle you drive, and what it really changes.
//
// What the routing providers actually support (checked against their docs, Nov 2026):
//  * Google Routes API RouteTravelMode: DRIVE, BICYCLE, WALK, TWO_WHEELER, TRUCK, TRANSIT.
//    TWO_WHEELER (motorcycles) is only offered in the countries on Google's coverage page
//    (TWO_WHEELER_REGIONS below) -- not Australia, the UK or the US. Google requires a "beta"
//    warning on every two-wheeler route shown.
//  * There is no TAXI mode in Google Routes or Mapbox Directions, so no taxi/bus-lane rules.
//  * No charging-stop routing in either API we use -> Electric car is hidden.
//  * Google TRUCK needs the vehicle's dimensions and isn't generally available; Mapbox's
//    max_height/max_weight only shape the navigated line, not the route list -> Truck/Van hidden.
// So: Private car and Taxi request car routes (Taxi says why); Motorcycle opens the existing
// Motorbike mode (travel/modeRouting.ts): TWO_WHEELER where Google has it (with Google's beta
// note), car routes elsewhere labelled "Motorbike routes use car roads here". Never pretends.
import type { MapMarkerStyleKey } from "@/utils/mapMarkerStyles";
import type { ModeId } from "@/travel/modes";

export type VehicleType = "car" | "motorcycle" | "taxi";

export interface VehicleOption {
  key: VehicleType;
  label: string;
  /** Line icon (components/ui/Icon) for the picker row and the route-preview pill. */
  icon: "car" | "motorbike" | "taxi";
}

/** The rows in "What's your ride?" -- only vehicles the routing really handles. */
export const VEHICLE_OPTIONS: readonly VehicleOption[] = [
  { key: "car", label: "Private car", icon: "car" },
  { key: "motorcycle", label: "Motorcycle", icon: "motorbike" },
  { key: "taxi", label: "Taxi", icon: "taxi" },
];

/** Not offered, and why (shown nowhere in the app; documented in BLOCKED.md). */
export const HIDDEN_VEHICLES = {
  electric: "No charging-stop routing in Google Routes or Mapbox Directions (public APIs).",
  truck: "Google TRUCK mode needs vehicle dimensions and isn't generally available; the route list comes from Google.",
} as const;

export const DEFAULT_VEHICLE: VehicleType = "car";

/** Google's two-wheeler coverage (developers.google.com/maps/documentation/routes/coverage-two-wheeled). */
export const TWO_WHEELER_REGIONS: ReadonlySet<string> = new Set([
  "AR", "BD", "BJ", "BO", "BR", "CL", "CO", "CR", "DZ", "EC", "EG", "GH", "GT", "HK", "HN", "ID", "IN", "KE", "KH", "LA",
  "LK", "MM", "MX", "MY", "NG", "NI", "PE", "PH", "PK", "PY", "RW", "SG", "TG", "TH", "TN", "TW", "UG", "UY", "VN", "ZA",
]);

/** Google requires this on every two-wheeler route an app shows (RouteTravelMode reference). */
export const MOTORCYCLE_BETA_NOTE = "Motorcycle routes are in beta and may include roads or paths that aren't suitable.";
export const TAXI_NOTE = "Taxi and bus lanes aren't in our routing data yet, so these are car routes.";

export function isVehicleType(v: unknown): v is VehicleType {
  return v === "car" || v === "motorcycle" || v === "taxi";
}

export function vehicleOption(v: VehicleType): VehicleOption {
  return VEHICLE_OPTIONS.find((o) => o.key === v) ?? VEHICLE_OPTIONS[0];
}

/**
 * Is Google's TWO_WHEELER routing offered here? `region` = ISO country (the phone's region), or
 * null when unknown -- then it's tried, and an error or empty answer falls back to car routes
 * labelled "Motorbike routes use car roads here" (travel/modeRouting.ts).
 */
export function twoWheelerSupported(region: string | null | undefined): boolean {
  return !region || TWO_WHEELER_REGIONS.has(region.toUpperCase());
}

/** Which travel mode the route preview opens in for this vehicle (travel/modes.ts). */
export function vehicleMode(v: VehicleType): ModeId {
  return v === "motorcycle" ? "motorbike" : "drive";
}

/** The vehicle a driving mode means: Motorbike is the motorcycle; Drive keeps car or taxi. */
export function vehicleForMode(mode: ModeId, current: VehicleType): VehicleType | null {
  if (mode === "motorbike") return "motorcycle";
  if (mode === "drive") return current === "motorcycle" ? "car" : current;
  return null; // bike / walk / transit / ferry: not a vehicle choice
}

/** The small note under the routes for this vehicle (Taxi: car routes, and why). */
export function vehicleRouteNote(v: VehicleType, mode: ModeId): string | null {
  return v === "taxi" && mode === "drive" ? TAXI_NOTE : null;
}

const VEHICLE_MARKER: Record<VehicleType, MapMarkerStyleKey> = { car: "default", motorcycle: "motorbike", taxi: "taxi" };

/**
 * Picking a vehicle sets your map icon -- unless you'd chosen an icon of your own (anything other
 * than the default or the previous vehicle's icon), which is kept.
 */
export function markerAfterVehicleChange(current: MapMarkerStyleKey, from: VehicleType, to: VehicleType): MapMarkerStyleKey {
  const untouched = current === "default" || current === VEHICLE_MARKER[from];
  return untouched ? VEHICLE_MARKER[to] : current;
}

/** The first-run "What's your ride?" shows once, after the location question is answered. */
export function shouldShowVehiclePicker(o: { settingsLoaded: boolean; chosen: boolean; locationAnswered: boolean }): boolean {
  return o.settingsLoaded && !o.chosen && o.locationAnswered;
}

/** The settings change for choosing a vehicle (first run, Settings, or the route-preview pill). */
export function vehiclePatch(
  current: { vehicleType: VehicleType; mapMarkerStyle: MapMarkerStyleKey },
  to: VehicleType
): { vehicleType: VehicleType; vehicleChosen: true; mapMarkerStyle: MapMarkerStyleKey } {
  return { vehicleType: to, vehicleChosen: true, mapMarkerStyle: markerAfterVehicleChange(current.mapMarkerStyle, current.vehicleType, to) };
}
