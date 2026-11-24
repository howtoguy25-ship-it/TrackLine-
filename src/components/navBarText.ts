// The top bar's text rules, pure so the directions list (nav/directionsRows.ts) shares them.
import type { RouteStep } from "@/services/directions";

/** "A6/Stacey St" -> shield "A6" + name "Stacey St"; "M5 Motorway" -> shield "M5" + "Motorway". */
export function splitRouteShield(name: string | null | undefined): { shield: string | null; street: string } {
  const n = (name ?? "").trim();
  const m = n.match(/^([AMB]\d{1,3})(?:\s*\/\s*|\s+)(.+)$/);
  if (m) return { shield: m[1], street: m[2] };
  if (/^[AMB]\d{1,3}$/.test(n)) return { shield: n, street: "" };
  return { shield: null, street: n };
}

/** The street the manoeuvre leads onto, from the step (never the long instruction sentence). */
export function barStreetName(step: RouteStep, isFinalStep: boolean): string {
  if (isFinalStep) return "Arrive at your destination";
  return step.targetStreetName?.trim() || "Continue";
}
