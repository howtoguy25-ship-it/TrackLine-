// Settings > Map information & overlays > Speedometer: what the dial and limit sign show, and
// when the over-the-limit chime sounds. Pure, so the settings screen, MapScreen and the tests
// agree on one reading.
import type { AppSettings } from "@/services/settings";

export type SpeedLimitDisplay = AppSettings["speedLimitDisplay"];

export const SPEED_LIMIT_DISPLAY_OPTIONS: { value: SpeedLimitDisplay; label: string; hint: string }[] = [
  { value: "always", label: "Always", hint: "The limit sign is always next to your speed" },
  { value: "whenAbove", label: "When above the limit", hint: "The sign appears only while you're over the limit" },
  { value: "never", label: "Don't show", hint: "No limit sign (alerts still follow the setting below)" },
];

const KMH_PER_MPH = 1.609344;

export interface ThresholdOption {
  key: string;
  label: string;
  /** Exactly one of these is set. */
  kmh: number | null;
  percent: number | null;
}

/** The threshold choices, labelled in the driver's units (stored as km/h or a percentage). */
export function thresholdOptions(unit: "km" | "miles"): ThresholdOption[] {
  const fixed = [0, 5, 10, 15, 20].map((n): ThresholdOption => {
    const kmh = unit === "miles" ? Math.round(n * KMH_PER_MPH * 10) / 10 : n;
    const label = n === 0 ? "At the limit" : `+${n} ${unit === "miles" ? "mph" : "km/h"}`;
    return { key: `abs:${n}`, label, kmh, percent: null };
  });
  const pct = [5, 10, 15].map((p): ThresholdOption => ({ key: `pct:${p}`, label: `+${p}%`, kmh: null, percent: p }));
  return [...fixed, ...pct];
}

/** Which option is selected (null when the stored value is a legacy slider value off the list). */
export function selectedThresholdKey(settings: Pick<AppSettings, "speedingThresholdKmh" | "speedingThresholdPercent">, unit: "km" | "miles"): string | null {
  const opts = thresholdOptions(unit);
  const hit = settings.speedingThresholdPercent != null
    ? opts.find((o) => o.percent === settings.speedingThresholdPercent)
    : opts.find((o) => o.kmh != null && Math.abs(o.kmh - settings.speedingThresholdKmh) < 0.05);
  return hit?.key ?? null;
}

/** The settings patch for picking a threshold. */
export function thresholdPatch(option: ThresholdOption): Pick<AppSettings, "speedingThresholdKmh" | "speedingThresholdPercent"> | Pick<AppSettings, "speedingThresholdPercent"> {
  return option.percent != null ? { speedingThresholdPercent: option.percent } : { speedingThresholdKmh: option.kmh ?? 0, speedingThresholdPercent: null };
}

/**
 * How many km/h over this limit counts as speeding. "At the limit" is anything over it
 * (1 km/h, so a speedometer reading exactly the limit doesn't chime).
 */
export function thresholdKmhFor(settings: Pick<AppSettings, "speedingThresholdKmh" | "speedingThresholdPercent">, limitKmh: number | null): number {
  if (settings.speedingThresholdPercent != null && limitKmh != null) {
    return Math.max(1, Math.ceil((limitKmh * settings.speedingThresholdPercent) / 100));
  }
  return Math.max(1, settings.speedingThresholdKmh);
}

/** Whether the limit sign is drawn now. */
export function showLimitSign(display: SpeedLimitDisplay, speedKmh: number, limitKmh: number | null): boolean {
  if (limitKmh == null || display === "never") return false;
  if (display === "always") return true;
  return speedKmh > limitKmh;
}
