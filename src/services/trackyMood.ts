import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase";
import { env } from "@/config/env";
import type { LatLng } from "@/utils/polyline";
import { TRACKY_MOODS, isMoodUnlocked, type TrackyMoodKey } from "@/components/trackys/moods";

// Real Tracky mood persistence + the AUTO MOOD engine -- "Store selected mood in Firestore
// users/{uid}.mood + locally" per the brief. `selected` is either a real picked TrackyMoodKey
// or "auto" (the default); autoMood resolution (resolveAutoMood below) only ever runs when
// selected === "auto", exactly matching "Manual pick overrides auto until the user taps 'Back
// to auto'."
export interface TrackyMoodState {
  selected: TrackyMoodKey | "auto";
}

const DEFAULT_MOOD_STATE: TrackyMoodState = { selected: "auto" };
const MOOD_STATE_KEY = "@trackline/trackyMood";

export async function getLocalMoodState(): Promise<TrackyMoodState> {
  const raw = await AsyncStorage.getItem(MOOD_STATE_KEY);
  if (!raw) return DEFAULT_MOOD_STATE;
  try {
    return { ...DEFAULT_MOOD_STATE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_MOOD_STATE;
  }
}

// Every mounted useTrackyMood instance (menu header, profile screen, map) holds its own copy of
// this state -- without this, picking a mood on the profile screen left the still-mounted menu
// header behind it showing the old one until it happened to remount.
const moodListeners = new Set<(state: TrackyMoodState) => void>();

export function subscribeMoodState(listener: (state: TrackyMoodState) => void): () => void {
  moodListeners.add(listener);
  return () => {
    moodListeners.delete(listener);
  };
}

export async function setLocalMoodState(state: TrackyMoodState): Promise<void> {
  moodListeners.forEach((listener) => listener(state));
  await AsyncStorage.setItem(MOOD_STATE_KEY, JSON.stringify(state));
}

// Same real cross-device sync pattern as settings.ts's pushSettingsToProfile -- merge:true onto
// the existing users/{uid} doc so this can never clobber any other field that doc already has.
export async function pushMoodToProfile(uid: string, state: TrackyMoodState): Promise<void> {
  await setDoc(doc(db, "users", uid), { mood: state }, { merge: true });
}

export async function pullMoodFromProfile(uid: string): Promise<TrackyMoodState | null> {
  const snap = await getDoc(doc(db, "users", uid));
  const remote = snap.exists() ? (snap.data().mood as TrackyMoodState | undefined) : undefined;
  return remote ?? null;
}

// Real birthday storage -- "MM-DD" only (no birth year collected/stored; a driver's mood
// doesn't need their age, only which calendar day to show the Birthday mood on).
export async function getUserBirthday(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(db, "users", uid));
  const value = snap.exists() ? (snap.data().birthdayMonthDay as string | undefined) : undefined;
  return value ?? null;
}

export async function setUserBirthday(uid: string, monthDay: string): Promise<void> {
  await setDoc(doc(db, "users", uid), { birthdayMonthDay: monthDay }, { merge: true });
}

export function isBirthdayToday(birthdayMonthDay: string | null, now: Date = new Date()): boolean {
  if (!birthdayMonthDay) return false;
  const todayMonthDay = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return birthdayMonthDay === todayMonthDay;
}

// --- Real driving-streak tracker -----------------------------------------------------------
// A plain local log of which real calendar days this device actually started a trip -- see
// MapScreen.tsx's startRoute, the one real call site. Deliberately local-only (AsyncStorage),
// not synced to Firestore: this is a per-device "did I drive today" signal, not something that
// needs cross-device merging the way settings/mood selection do.

const DRIVE_LOG_KEY = "@trackline/trackyDriveLog";
const DRIVE_LOG_MAX_DAYS = 60;

function todayDateString(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Call once per real trip start (MapScreen.tsx's startRoute) -- a no-op if a drive was already
 *  recorded today, so starting multiple trips the same day doesn't double-count. */
export async function recordDriveToday(): Promise<void> {
  const today = todayDateString();
  const raw = await AsyncStorage.getItem(DRIVE_LOG_KEY);
  const dates: string[] = raw ? JSON.parse(raw) : [];
  if (dates[dates.length - 1] === today) return;
  const next = [...dates, today].slice(-DRIVE_LOG_MAX_DAYS);
  await AsyncStorage.setItem(DRIVE_LOG_KEY, JSON.stringify(next));
}

/** Real consecutive-day count ending today (or yesterday, if no drive has been logged yet
 *  today) -- walks backward from the most recent real logged day rather than trusting array
 *  order/length alone, so a gap anywhere in the log correctly breaks the streak. */
export async function getDrivingStreakDays(now: Date = new Date()): Promise<number> {
  const raw = await AsyncStorage.getItem(DRIVE_LOG_KEY);
  const dates: string[] = raw ? JSON.parse(raw) : [];
  if (dates.length === 0) return 0;
  const logged = new Set(dates);
  const cursor = new Date(now);
  if (!logged.has(todayDateString(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (logged.has(todayDateString(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// --- Time-of-day mood ------------------------------------------------------------------------

/** The brief's own real hour ranges -- "5-10am Sleepy→Happy" splits into an early-sleepy half
 *  and a later-happy half rather than picking just one; every hour outside a named range falls
 *  back to Happy, the real neutral daytime default. */
export function timeOfDayMood(now: Date = new Date()): TrackyMoodKey {
  const hour = now.getHours();
  if (hour >= 21 || hour < 4) return "sleepy";
  if (hour >= 5 && hour < 7) return "sleepy";
  if (hour >= 7 && hour < 10) return "happy";
  if (hour >= 11 && hour < 14) return "hungry";
  if (hour >= 15 && hour < 17) return "aussieArvo";
  return "happy";
}

// --- Rain-at-location (genuinely optional) ---------------------------------------------------

/** Real OpenWeatherMap current-weather lookup -- returns false (never fabricated) when
 *  openWeatherApiKey isn't set, or the request fails for any reason. Only ever checks "is it
 *  raining right now at this real location," nothing more. */
export async function isRainingAt(location: LatLng): Promise<boolean> {
  if (!env.openWeatherApiKey) return false;
  try {
    const params = new URLSearchParams({
      lat: String(location.latitude),
      lon: String(location.longitude),
      appid: env.openWeatherApiKey,
    });
    const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?${params.toString()}`);
    if (!res.ok) return false;
    const json = await res.json();
    const weatherIds: number[] = (json.weather ?? []).map((w: any) => w.id);
    // Real OpenWeatherMap condition-code ranges (its own documented spec): 2xx thunderstorm,
    // 3xx drizzle, 5xx rain all count as "raining" for this real-world check.
    return weatherIds.some((id) => id >= 200 && id < 600);
  } catch {
    return false;
  }
}

// --- Combine into the real resolved auto-mood ------------------------------------------------

export interface AutoMoodContext {
  drivingStreakDays: number;
  isRaining: boolean;
  isBirthdayToday: boolean;
  isGhostMode: boolean;
}

/** Real priority, most special/rare signal wins: birthday (one real day a year) > rain (a real,
 *  live condition right now) > driving streak (a real, earned milestone) > plain time of day
 *  (the default/fallback). Each candidate is only actually used if its own mood is unlocked for
 *  this context -- e.g. a 2-day streak never silently claims Excited since isMoodUnlocked would
 *  reject it, time-of-day's own Happy/Hungry/Sleepy/Aussie Arvo are all unlock:"always" so they
 *  can never themselves be the reason a fallback is needed. */
export function resolveAutoMood(ctx: AutoMoodContext, now: Date = new Date()): TrackyMoodKey {
  const unlockCtx = { drivingStreakDays: ctx.drivingStreakDays, isGhostMode: ctx.isGhostMode, isBirthdayToday: ctx.isBirthdayToday };

  if (ctx.isBirthdayToday && isMoodUnlocked(TRACKY_MOODS.birthday, unlockCtx)) return "birthday";
  if (ctx.isRaining) return "rainy";
  if (isMoodUnlocked(TRACKY_MOODS.party, unlockCtx)) return "party";
  if (isMoodUnlocked(TRACKY_MOODS.excited, unlockCtx)) return "excited";
  return timeOfDayMood(now);
}
