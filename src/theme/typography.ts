// The app's typeface: Rubik (SIL Open Font License 1.1), in four weights.
//
// Rubik ships as one font FILE per weight, each registered under its own family name
// ("Rubik_600SemiBold"). React Native can't be handed "Rubik" plus a fontWeight and be trusted
// to pick the right file on both platforms -- Android in particular will fake a bold by
// smearing the regular face. So the weight a style asks for is mapped here to the family that
// actually IS that weight, and the wrapper in components/AppText.tsx applies it.
//
// Nothing in this file imports React Native, so the mapping is unit-tested directly
// (scripts/test-ui-logic.ts).

export const RUBIK = {
  regular: "Rubik_400Regular",
  medium: "Rubik_500Medium",
  semiBold: "Rubik_600SemiBold",
  bold: "Rubik_700Bold",
} as const;

export type RubikFamily = (typeof RUBIK)[keyof typeof RUBIK];

/**
 * The Rubik family for a requested fontWeight. Only four weights are bundled, so anything
 * heavier than 700 uses Bold and anything lighter than 400 uses Regular -- the nearest real
 * face, never a synthesized one.
 */
export function rubikFamilyForWeight(weight: string | number | undefined | null): RubikFamily {
  if (weight === undefined || weight === null || weight === "normal") return RUBIK.regular;
  if (weight === "bold") return RUBIK.bold;
  const numeric = typeof weight === "number" ? weight : parseInt(String(weight), 10);
  if (!Number.isFinite(numeric)) return RUBIK.regular;
  if (numeric >= 650) return RUBIK.bold;
  if (numeric >= 550) return RUBIK.semiBold;
  if (numeric >= 450) return RUBIK.medium;
  return RUBIK.regular;
}

// Set once the font files have finished loading (App.tsx). Until then -- and for good, if they
// ever fail to load -- text simply renders in the system font; naming a family that isn't
// registered yet would make Android drop to a fallback glyph set.
let rubikReady = false;
export function setRubikReady(ready: boolean): void {
  rubikReady = ready;
}
export function isRubikReady(): boolean {
  return rubikReady;
}
