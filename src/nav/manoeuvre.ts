// What kind of manoeuvre is coming, and the rules that hang off that: when the approach zoom
// starts, what the callout at the split says, and what the confirmation chip says afterwards.
// Pure functions, unit-tested in __tests__/nav/manoeuvre.test.ts.

import type { ManeuverType } from "@/services/directions";
import { lanesAreUseful, type Lane } from "@/nav/lanes";

export type ManoeuvreKind =
  | "exit" // leaving a motorway (off ramp)
  | "onramp" // joining one by ramp
  | "merge"
  | "fork" // motorway split
  | "roundabout"
  | "laneChange" // a plain turn where only some lanes lead the right way
  | "complex" // a turn at a big intersection (five or more roads)
  | "turn"
  | "continue"
  | "arrive";

/** The manoeuvres that get the close-up approach view. */
export const ZOOM_KINDS: ReadonlySet<ManoeuvreKind> = new Set<ManoeuvreKind>([
  "exit",
  "onramp",
  "merge",
  "fork",
  "roundabout",
  "laneChange",
  "complex",
]);

/**
 * Every manoeuvre the driver can get right or wrong -- each one is followed through to "taken"
 * (chip) or "missed" (reroute). Only ZOOM_KINDS also get the close-up approach view.
 */
export const TRACK_KINDS: ReadonlySet<ManoeuvreKind> = new Set<ManoeuvreKind>([...ZOOM_KINDS, "turn"]);

export function shouldTrack(kind: ManoeuvreKind | undefined): boolean {
  return !!kind && TRACK_KINDS.has(kind);
}

/** Mapbox / OSRM maneuver type + modifier -> the app's ManeuverType code. */
export function maneuverTypeFor(type: string, modifier: string | undefined, drivingSide: "left" | "right" = "left"): ManeuverType {
  const m = modifier ?? "";
  const side = m.includes("left") ? "left" : m.includes("right") ? "right" : null;
  switch (type) {
    case "off ramp":
    case "on ramp":
      return side === "left" ? "ramp-left" : side === "right" ? "ramp-right" : "merge";
    case "fork":
      return side === "left" ? "fork-left" : "fork-right";
    case "merge":
      return "merge";
    case "roundabout":
    case "rotary":
    case "roundabout turn":
    case "exit roundabout":
    case "exit rotary":
      return drivingSide === "left" ? "roundabout-left" : "roundabout-right";
    case "arrive":
    case "depart":
      return undefined;
    default:
      if (m === "uturn") return drivingSide === "left" ? "uturn-right" : "uturn-left";
      if (m === "straight" || m === "") return type === "turn" ? "straight" : undefined;
      if (m === "slight left") return "turn-slight-left";
      if (m === "slight right") return "turn-slight-right";
      if (m === "sharp left") return "turn-sharp-left";
      if (m === "sharp right") return "turn-sharp-right";
      return m === "left" ? "turn-left" : "turn-right";
  }
}

export function manoeuvreKindFor(
  type: string,
  modifier: string | undefined,
  lanes: Lane[] | null | undefined,
  roadsAtIntersection: number
): ManoeuvreKind {
  switch (type) {
    case "off ramp":
      return "exit";
    case "on ramp":
      return "onramp";
    case "merge":
      return "merge";
    case "fork":
      return "fork";
    case "roundabout":
    case "rotary":
    case "roundabout turn":
    case "exit roundabout":
    case "exit rotary":
      return "roundabout";
    case "arrive":
      return "arrive";
  }
  const turning = !!modifier && modifier !== "straight";
  if (lanesAreUseful(lanes)) return "laneChange";
  if (turning && roadsAtIntersection >= 5) return "complex";
  return turning ? "turn" : "continue";
}

/**
 * Google routes (used wherever Mapbox can't answer) only carry a manoeuvre code and a sentence.
 * Read what they can tell, worldwide:
 *   ramp-*   -> an exit ("Take exit 23B", "At junction 12, exit onto M40", "...off-ramp") or else
 *               an on-ramp ("Take the ramp onto I-10 E");
 *   fork-*, keep-* -> a motorway split ("Keep left to continue on I-5 N") -- the legacy API says
 *               keep-left / keep-right for those across the US and Europe;
 *   merge, roundabout-* as they say.
 * The exit number comes from the sentence ("exit 23B"), when it's in English; otherwise none.
 */
export function googleManoeuvre(
  code: string | undefined,
  instruction: string
): { kind: ManoeuvreKind | undefined; side: "left" | "right" | undefined; exitNumber: string | undefined } {
  const c = code ?? "";
  const side: "left" | "right" | undefined = c.endsWith("-left") ? "left" : c.endsWith("-right") ? "right" : undefined;
  const exitNumber = /\bexit\s+(\d+[A-Za-z]?)\b/i.exec(instruction)?.[1]?.toUpperCase();
  let kind: ManoeuvreKind | undefined;
  if (c.startsWith("ramp")) {
    const onto = /\b(take|use)\b.*\bramp\b.*\bonto\b/i.test(instruction) && !/\bexit\b/i.test(instruction);
    kind = onto ? "onramp" : "exit";
  } else if (c.startsWith("fork") || c.startsWith("keep")) kind = "fork";
  else if (c === "merge") kind = "merge";
  else if (c.startsWith("roundabout")) kind = "roundabout";
  else if (c.startsWith("turn") || c.startsWith("uturn")) kind = "turn";
  else if (c === "straight") kind = "continue";
  return { kind, side, exitNumber };
}

export function sideOf(modifier: string | undefined): "left" | "right" | undefined {
  if (!modifier) return undefined;
  if (modifier.includes("left")) return "left";
  if (modifier.includes("right")) return "right";
  return undefined;
}

/** The approach view starts this far out: 200 m, or 400 m above 90 km/h (time to react). */
export const APPROACH_METERS = 200;
export const APPROACH_METERS_FAST = 400;
export const FAST_KMH = 90;

export function approachTriggerMeters(speedKmh: number | null | undefined): number {
  return (speedKmh ?? 0) > FAST_KMH ? APPROACH_METERS_FAST : APPROACH_METERS;
}

export function shouldZoomFor(kind: ManoeuvreKind | undefined): boolean {
  return !!kind && ZOOM_KINDS.has(kind);
}

/** The label at the split point: "Exit 3B", "M5 West", "Merge left". */
export function calloutLabel(step: {
  maneuverKind?: ManoeuvreKind;
  maneuverSide?: "left" | "right";
  exitNumber?: string;
  roadRef?: string;
  targetStreetName?: string;
}): string | null {
  const side = step.maneuverSide ? ` ${step.maneuverSide}` : "";
  switch (step.maneuverKind) {
    case "exit":
      if (step.exitNumber) return `Exit ${step.exitNumber}`;
      return step.targetStreetName ?? step.roadRef ?? "Exit";
    case "merge":
    case "onramp":
      return `Merge${side}`;
    case "fork":
      return step.roadRef ?? step.targetStreetName ?? `Keep${side}`;
    default:
      return step.targetStreetName ?? step.roadRef ?? null;
  }
}

/** The green chip once the manoeuvre is confirmed. */
export function confirmationText(kind: ManoeuvreKind | undefined): string {
  switch (kind) {
    case "exit":
      return "Exit taken ✓";
    case "merge":
    case "onramp":
      return "Merge complete ✓";
    case "fork":
    case "laneChange":
      return "Right lane ✓";
    case "roundabout":
      return "Roundabout done ✓";
    default:
      return "Turn complete ✓";
  }
}
