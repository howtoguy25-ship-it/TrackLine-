// One-off adjustments to settings already saved on people's phones. No imports, so the rules
// are unit-tested directly (scripts/test-ui-logic.ts); settings.ts applies them on load.

// Bumped whenever a release needs to adjust settings already saved on people's phones.
export const SETTINGS_VERSION = 3;

/**
 * One-off adjustments to settings saved by an earlier version of the app. Pure, so it's
 * unit-tested (scripts/test-ui-logic.ts).
 *
 * Version 2 (UI pass 2): the home map is meant to open on the drawn TrackLine Light map, and
 * phones that had ended up on satellite were opening on aerial imagery instead. Once -- and only
 * once -- satellite is switched back to the standard tilted view and the map theme to Light.
 * It's a reset of the DEFAULT, not a removal: satellite is still one switch away in Settings >
 * Map view, and choosing it again after this sticks.
 */
interface ThresholdFields {
  speedingThresholdKmh?: number;
  speedingThresholdPercent?: number | null;
  distanceUnit?: "km" | "miles";
}

const KMH_PER_MPH = 1.609344;
/** The speeding-alert choices in Settings (settings/speedometer.ts), as stored values. */
export function thresholdChoices(unit: "km" | "miles" | undefined): { kmh: number[]; percent: number[] } {
  const steps = [0, 5, 10, 15, 20];
  return {
    kmh: steps.map((n) => (unit === "miles" ? Math.round(n * KMH_PER_MPH * 10) / 10 : n)),
    percent: [5, 10, 15],
  };
}

const nearest = (value: number, list: number[]) => list.reduce((best, x) => (Math.abs(x - value) < Math.abs(best - value) ? x : best), list[0]);

/** A speeding threshold saved before it became a fixed list (e.g. +3 km/h from the old slider)
 * moves to the nearest choice on the list (+5 km/h), so exactly one choice is ticked. */
export function snapThresholdToChoices<T extends ThresholdFields>(s: T): T {
  const choices = thresholdChoices(s.distanceUnit);
  if (s.speedingThresholdPercent != null) {
    return choices.percent.includes(s.speedingThresholdPercent) ? s : { ...s, speedingThresholdPercent: nearest(s.speedingThresholdPercent, choices.percent) };
  }
  const kmh = s.speedingThresholdKmh;
  if (typeof kmh !== "number" || !Number.isFinite(kmh)) return s;
  return choices.kmh.some((x) => Math.abs(x - kmh) < 0.05) ? s : { ...s, speedingThresholdKmh: nearest(kmh, choices.kmh) };
}

export function migrateStoredSettings<T extends { defaultMapViewStyle: string; mapTheme: string } & ThresholdFields>(
  settings: T,
  storedVersion: unknown
): T & { settingsVersion: number } {
  const from = typeof storedVersion === "number" && Number.isFinite(storedVersion) ? storedVersion : 1;
  let next = settings;
  if (from < 2) {
    next = {
      ...next,
      defaultMapViewStyle: next.defaultMapViewStyle === "satellite3d" ? "tilted3d" : next.defaultMapViewStyle,
      mapTheme: "light",
    };
  }
  // Version 3 (settings redesign): speeding alert is a list of choices; an old in-between value
  // moves to the nearest one.
  if (from < 3) next = snapThresholdToChoices(next);
  return { ...next, settingsVersion: SETTINGS_VERSION };
}
