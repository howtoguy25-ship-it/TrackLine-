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

/** Short day pill text: "Today", "Tomorrow", then "Wed 25". */
export function dayPillLabel(dayStartMs: number, nowMs: number): string {
  const long = dayLabel(dayStartMs, nowMs);
  if (long === "Today" || long === "Tomorrow") return long;
  const d = new Date(dayStartMs);
  return `${d.toLocaleDateString([], { weekday: "short" })} ${d.getDate()}`;
}

const QUARTER_MS = SLOT_MINUTES * 60_000;
const ceilQuarter = (ms: number) => Math.ceil(ms / QUARTER_MS) * QUARTER_MS;

/**
 * Where the list of times starts for a day: a planned time an hour before it (so it's in the
 * list with earlier options above), today the next quarter hour, any other day 8 am.
 */
export function defaultWindowStart(dayStartMs: number, nowMs: number, targetMs: number | null = null): number {
  const dayEnd = addDays(dayStartMs, 1);
  if (targetMs != null && targetMs >= dayStartMs && targetMs < dayEnd) return Math.max(ceilQuarter(nowMs), ceilQuarter(targetMs) - 60 * 60_000);
  if (dayStartMs === startOfDay(nowMs)) return ceilQuarter(nowMs);
  const d = new Date(dayStartMs);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

/** `count` quarter-hour times from `startMs` (rounded up), never in the past, never past the day. */
export function windowSlots(startMs: number, nowMs: number, count = SLOTS_SHOWN): number[] {
  const dayEnd = addDays(startOfDay(startMs), 1);
  const out: number[] = [];
  for (let t = ceilQuarter(startMs); out.length < count && t < dayEnd; t += QUARTER_MS) if (t > nowMs) out.push(t);
  return out;
}

/** "Jump to time": the picked clock time on the chosen day, as the new start of the list. */
export function jumpTo(dayStartMs: number, picked: Date): number {
  const d = new Date(dayStartMs);
  d.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return Math.floor(d.getTime() / QUARTER_MS) * QUARTER_MS;
}

export type TrafficLevel = "best" | "light" | "moderate" | "heavy";

/**
 * Each row's traffic bar, relative to the other times shown (so the difference is visible even
 * when every time is close): the quickest is the shortest bar, the slowest fills the row. The
 * level is how much slower than the quickest: within 5% light, within 20% moderate, else heavy.
 */
export function trafficBars(durations: Record<number, number>): Record<number, { fraction: number; level: TrafficLevel }> {
  const values = Object.values(durations);
  const out: Record<number, { fraction: number; level: TrafficLevel }> = {};
  if (!values.length) return out;
  const min = Math.min(...values);
  const max = Math.max(...values);
  for (const [k, d] of Object.entries(durations)) {
    const fraction = max === min ? 0.35 : 0.25 + (0.75 * (d - min)) / (max - min);
    const over = (d - min) / Math.max(1, min);
    const level: TrafficLevel = d === min ? "best" : over <= 0.05 ? "light" : over <= 0.2 ? "moderate" : "heavy";
    out[Number(k)] = { fraction, level };
  }
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
