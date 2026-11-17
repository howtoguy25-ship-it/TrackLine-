// Plan a drive: the saved drives, their grouping by day, the day and 15-minute time choices,
// and working out when to leave for an "arrive by" time from Google's own predictions.
// Pure apart from the injected prediction function, so it's tested directly. The same leave-time
// rule runs on the server when it re-checks a drive 30 minutes before (plannedDrivesCore.js).

export interface PlannedPlace {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  placeId?: string;
}

export interface PlannedDrive {
  id: string;
  from: PlannedPlace;
  to: PlannedPlace;
  /** "arrive": be there by targetMs. "leave": set off at targetMs. */
  mode: "arrive" | "leave";
  targetMs: number;
  /** When to set off, from the latest prediction. */
  leaveAtMs: number;
  /** Predicted drive time for leaveAtMs, in seconds. */
  durationSeconds: number;
  createdAt: number;
  /** The phone's time zone, so the reminder's times read right. */
  tz?: string;
  /** Set by the server when it re-checks traffic 30 minutes before. */
  recheckedAt?: number | null;
}

export const SLOT_MINUTES = 15;
export const SLOTS_SHOWN = 8;
/** The server re-checks traffic this long before the leave time, and tells you if it moved. */
export const RECHECK_LEAD_MS = 30 * 60_000;
/** A drive stays in the list until this long after its leave time. */
export const KEEP_AFTER_LEAVE_MS = 60 * 60_000;

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const addDays = (dayMs: number, n: number) => {
  const d = new Date(dayMs);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

export function dayLabel(dayStartMs: number, nowMs: number): string {
  const today = startOfDay(nowMs);
  if (dayStartMs === today) return "Today";
  if (dayStartMs === addDays(today, 1)) return "Tomorrow";
  return new Date(dayStartMs).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

/** Today and the next six days, as the start of each day. */
export function dayChoices(nowMs: number, count = 7): { dayStartMs: number; label: string }[] {
  const today = startOfDay(nowMs);
  return Array.from({ length: count }, (_, i) => {
    const dayStartMs = addDays(today, i);
    return { dayStartMs, label: dayLabel(dayStartMs, nowMs) };
  });
}

/** Hours of the day you can pick, 5 am to 11 pm; today only from the current hour. */
export function hourChoices(dayStartMs: number, nowMs: number): number[] {
  const first = dayStartMs === startOfDay(nowMs) ? Math.max(5, new Date(nowMs).getHours()) : 5;
  return Array.from({ length: 24 - first }, (_, i) => first + i).filter((h) => h <= 23);
}

/** The 15-minute times shown for a picked hour: that hour onward, never in the past. */
export function timeSlots(dayStartMs: number, hour: number, nowMs: number, count = SLOTS_SHOWN): number[] {
  const d = new Date(dayStartMs);
  d.setHours(hour, 0, 0, 0);
  const step = SLOT_MINUTES * 60_000;
  const out: number[] = [];
  for (let t = d.getTime(); out.length < count; t += step) if (t > nowMs) out.push(t);
  return out;
}

export type Predict = (departMs: number) => Promise<number>;

/**
 * When to leave to arrive by `arriveMs`. Google predicts by departure time, so ask for the drive
 * time leaving at (arrival − first guess), then once more from that answer: two real
 * predictions, never a guessed buffer.
 */
export async function leaveTimeForArrival(arriveMs: number, predict: Predict): Promise<{ leaveAtMs: number; durationSeconds: number }> {
  const first = await predict(arriveMs - 30 * 60_000);
  const second = await predict(arriveMs - first * 1000);
  return { leaveAtMs: arriveMs - second * 1000, durationSeconds: second };
}

export async function planFor(mode: PlannedDrive["mode"], targetMs: number, predict: Predict): Promise<{ leaveAtMs: number; durationSeconds: number }> {
  if (mode === "leave") return { leaveAtMs: targetMs, durationSeconds: await predict(targetMs) };
  return leaveTimeForArrival(targetMs, predict);
}

export interface DriveSection {
  title: string;
  drives: PlannedDrive[];
}

/** Upcoming drives, soonest first, under Today / Tomorrow / the day's name. Old ones drop off. */
export function groupDrives(drives: PlannedDrive[], nowMs: number): DriveSection[] {
  const upcoming = drives.filter((d) => d.leaveAtMs + KEEP_AFTER_LEAVE_MS > nowMs).sort((a, b) => a.leaveAtMs - b.leaveAtMs);
  const sections: DriveSection[] = [];
  for (const d of upcoming) {
    const title = dayLabel(startOfDay(d.leaveAtMs), nowMs);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.drives.push(d);
    else sections.push({ title, drives: [d] });
  }
  return sections;
}
