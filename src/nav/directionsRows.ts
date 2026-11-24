// Fix pass 5 §7: the directions list, one row per real manoeuvre. Steps the route gives twice
// ("Continue on George St" then "Continue on George St") or that don't change anything (a
// zero-length step, "continue" onto the road you're already on) are merged into the row before,
// their distance added. Pure; tested in __tests__/fixPass5/directions.test.ts.
import type { RouteStep } from "@/services/directions";
import { barStreetName, splitRouteShield } from "@/components/navBarText";
import { extractRoundaboutExitNumber } from "@/utils/navFormat";

export interface DirectionsRow {
  key: string;
  /** Index of the first route step in this row (the current step is highlighted by it). */
  firstStep: number;
  lastStep: number;
  maneuver: RouteStep["maneuver"];
  /** Metres to drive before this manoeuvre. */
  meters: number;
  shield: string | null;
  street: string;
  /** The instruction, grey, under the street -- only when it says more than the street. */
  detail: string | null;
  roundaboutExit: number | null;
  drivingSide: "left" | "right";
  final: boolean;
}

const CONTINUE = new Set(["straight", "", undefined, null] as (string | null | undefined)[]);

/** No full stop at the end of a line: "Turn left onto King St." -> "Turn left onto King St". */
export function noTrailingStop(s: string): string {
  return s.replace(/[\s.]+$/u, "").trim();
}

function sameRow(a: DirectionsRow, step: RouteStep, isFinal: boolean): boolean {
  if (a.final || isFinal) return false;
  const street = splitRouteShield(barStreetName(step, false));
  const sameStreet = (street.street || "") === (a.street || "") && street.shield === a.shield;
  // Two "keep going" steps on one road, or a step with no length at all.
  return (step.distanceMeters < 1 && sameStreet) || (CONTINUE.has(step.maneuver) && CONTINUE.has(a.maneuver) && sameStreet);
}

export function directionsRows(steps: RouteStep[]): DirectionsRow[] {
  const rows: DirectionsRow[] = [];
  steps.forEach((step, i) => {
    const isFinal = i === steps.length - 1;
    const prev = rows[rows.length - 1];
    if (prev && sameRow(prev, step, isFinal)) {
      prev.meters += step.distanceMeters;
      prev.lastStep = i;
      return;
    }
    const { shield, street } = splitRouteShield(barStreetName(step, isFinal));
    const instruction = noTrailingStop(step.instruction ?? "");
    const said = `${shield ?? ""} ${street}`.trim().toLowerCase();
    const detail = instruction && instruction.toLowerCase() !== said && !isFinal ? instruction : null;
    const exit = extractRoundaboutExitNumber(step.instruction ?? "");
    rows.push({
      key: `row-${i}`,
      firstStep: i,
      lastStep: i,
      maneuver: step.maneuver,
      meters: step.distanceMeters,
      shield,
      street: noTrailingStop(street),
      detail,
      roundaboutExit: exit ?? null,
      drivingSide: step.drivingSide ?? "left",
      final: isFinal,
    });
  });
  // Identical neighbours left after merging (same manoeuvre, street and detail): fold them too.
  const out: DirectionsRow[] = [];
  for (const r of rows) {
    const p = out[out.length - 1];
    if (p && !p.final && !r.final && p.maneuver === r.maneuver && p.street === r.street && p.shield === r.shield && p.detail === r.detail) {
      p.meters += r.meters;
      p.lastStep = r.lastStep;
    } else out.push(r);
  }
  return out;
}

/** The row holding the step you're on. */
export function activeRowIndex(rows: DirectionsRow[], activeStep: number): number {
  const i = rows.findIndex((r) => activeStep >= r.firstStep && activeStep <= r.lastStep);
  return i < 0 ? 0 : i;
}
