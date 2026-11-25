// When an ahead alert is due, and how long its banner stays. Pure.
//
//   warn at   critical (crash, standstill, closure, object, broken lights): max(600 m, 25 s)
//             minor road features (humps, crossings, curves, lights):         max(150 m, 8 s)
//             everything else:                                                max(300 m, 15 s)
//   banner    7 s (6 s for minor features), then slides away (220 ms); the icon stays on the
//             route until passed
//   reminder  critical only, once, at ~150 m, for 4 s
import type { AheadAlert } from "@/nav/ahead/aheadFeed";
import { formatDistance, type DistanceUnit } from "@/utils/navFormat";

export const BANNER_MS = 7000;
export const MINOR_BANNER_MS = 6000;
export const REMINDER_MS = 4000;
export const REMINDER_AT_M = 150;
export const LEAVE_MS = 220;
export const ENTER_MS = 220;
export const QUEUE_GAP_MS = 400;
/** A critical alert this close may interrupt a manoeuvre close-up. */
export const CRITICAL_DURING_MANOEUVRE_M = 200;
/** Map icons: only within this far ahead, at most MAX_MAP_ICONS. */
export const MAP_ICONS_AHEAD_M = 1500;
export const MAX_MAP_ICONS = 3;
/** Distance turns to "Now" under this. */
export const NOW_M = 30;
/** Past the spot by this much, a banner still showing goes (community reports ask Still there until then). */
export const PASSED_M = 30;

export function warnDistanceM(alert: Pick<AheadAlert, "critical" | "minor">, speedMps: number): number {
  const v = Math.max(0, speedMps || 0);
  if (alert.critical) return Math.max(600, v * 25);
  if (alert.minor) return Math.max(150, v * 8);
  return Math.max(300, v * 15);
}

export function bannerMs(alert: Pick<AheadAlert, "minor">, reminder: boolean): number {
  if (reminder) return REMINDER_MS;
  return alert.minor ? MINOR_BANNER_MS : BANNER_MS;
}

/** "400 m", "1.2 km", "Now" under 30 m. */
export function distanceText(aheadM: number, unit: DistanceUnit, source?: string): string {
  if (source === "siren") return "Nearby";
  return aheadM < NOW_M ? "Now" : formatDistance(aheadM, unit);
}

/** The progress bar along the banner's bottom edge: 0 at the warning distance, 1 at the spot. */
export function closingProgress(aheadM: number, warnM: number): number {
  if (warnM <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - aheadM / warnM));
}
