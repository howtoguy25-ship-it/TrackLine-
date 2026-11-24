// Map styles add-on §1: every theme only changes colours, never readability. These are the
// minimum contrasts (WCAG ratio) every palette must meet; __tests__/map/styleContrast.test.ts
// checks every theme and satellite. Pure.
import { contrastRatio } from "../../theme/colors";
import type { StylePalette } from "./buildStyle";

export interface ContrastRule {
  name: string;
  a: keyof StylePalette;
  b: keyof StylePalette;
  min: number;
  /** Not on satellite (there's imagery, not `land`, under the roads). */
  drawnOnly?: boolean;
}

export const CONTRAST_RULES: ContrastRule[] = [
  // Roads must read against the ground (local streets also get a white / dark casing).
  { name: "street vs land", a: "road", b: "land", min: 1.25, drawnOnly: true },
  { name: "main road vs land", a: "motorway", b: "land", min: 1.5, drawnOnly: true },
  // Water and parks: clearly water, softly park.
  { name: "water vs land", a: "water", b: "land", min: 1.35, drawnOnly: true },
  // Street names: AAA-level against their halo and the ground.
  { name: "street label vs halo", a: "streetLabel", b: "labelHalo", min: 7 },
  { name: "street label vs land", a: "streetLabel", b: "land", min: 4.5, drawnOnly: true },
  { name: "suburb label vs halo", a: "suburbLabel", b: "labelHalo", min: 4.5 },
  // The route always stands out from the roads and the ground.
  { name: "route vs street", a: "route", b: "road", min: 3 },
  { name: "route vs land", a: "route", b: "land", min: 3, drawnOnly: true },
  { name: "route vs casing", a: "route", b: "routeCasing", min: 1.5 },
  { name: "alternative route vs land", a: "routeAlt", b: "land", min: 1.4, drawnOnly: true },
];

export interface ContrastResult {
  rule: string;
  ratio: number;
  min: number;
  ok: boolean;
}

export function checkPalette(p: StylePalette, satellite = false): ContrastResult[] {
  return CONTRAST_RULES.filter((r) => !(satellite && r.drawnOnly)).map((r) => {
    const ratio = contrastRatio(p[r.a] as string, p[r.b] as string);
    return { rule: r.name, ratio: Math.round(ratio * 100) / 100, min: r.min, ok: ratio >= r.min };
  });
}
