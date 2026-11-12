// One-off adjustments to settings already saved on people's phones. No imports, so the rules
// are unit-tested directly (scripts/test-ui-logic.ts); settings.ts applies them on load.

// Bumped whenever a release needs to adjust settings already saved on people's phones.
export const SETTINGS_VERSION = 2;

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
export function migrateStoredSettings<T extends { defaultMapViewStyle: string; mapTheme: string }>(
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
  return { ...next, settingsVersion: SETTINGS_VERSION };
}
