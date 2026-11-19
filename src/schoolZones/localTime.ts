// Local date and time in a zone's OWN timezone (a NSW school zone keeps Sydney time even when the
// phone is set to Brisbane; Broken Hill keeps its own). Uses the platform's Intl time zone data,
// so daylight saving changes are the real ones.

export interface LocalParts {
  /** "2026-11-17" */
  isoDate: string;
  /** 1 = Monday ... 7 = Sunday */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
  seconds: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-AU", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localParts(nowMs: number, timeZone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(nowMs))) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday] ?? 0,
    minutes: hour * 60 + Number(parts.minute),
    seconds: Number(parts.second),
  };
}

/** "08:30" -> 510 */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 570 -> "9:30 am" */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * The instant (ms) when local time in `timeZone` next reads `targetMinutes` on the same local
 * day, found by stepping and checking -- correct across a daylight-saving change.
 */
export function instantAtLocalMinutes(nowMs: number, timeZone: string, targetMinutes: number): number {
  const here = localParts(nowMs, timeZone);
  let guess = nowMs + ((targetMinutes - here.minutes) * 60 - here.seconds) * 1000;
  for (let i = 0; i < 3; i++) {
    const at = localParts(guess, timeZone);
    const diff = targetMinutes - at.minutes;
    if (diff === 0 && at.isoDate === here.isoDate) return guess - at.seconds * 1000;
    guess += diff * 60_000;
  }
  return guess;
}
