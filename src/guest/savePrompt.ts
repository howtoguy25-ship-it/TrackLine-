import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "@/services/firebase";
import { callFn } from "@/services/callable";

// "Save your TrackLine": guests (anonymous accounts) are asked to create an account at good
// moments -- after saving Home or Work, after a purchase, after their 3rd trip -- and always
// see the option in Settings > Account. Creating the account links it to the same uid
// (linkWithCredential), so nothing they saved is lost.
export type SaveMoment = "savedHomeWork" | "purchase" | "tripEnded";

export interface PromptState {
  trips: number;
  lastPromptAtMs: number;
  dismissals: number;
}

const KEY = "@trackline/saveTrackLinePrompt";
const DAY = 24 * 60 * 60 * 1000;
export const EMPTY_PROMPT_STATE: PromptState = { trips: 0, lastPromptAtMs: 0, dismissals: 0 };

/** Should this moment show the prompt? Pure. At most every 3 days, and never after 3 "Not now"s. */
export function shouldPrompt(moment: SaveMoment, state: PromptState, isGuest: boolean, nowMs: number): boolean {
  if (!isGuest) return false;
  if (state.dismissals >= 3) return false;
  if (nowMs - state.lastPromptAtMs < 3 * DAY) return false;
  if (moment === "tripEnded") return state.trips === 3 || state.trips === 10;
  return true;
}

async function load(): Promise<PromptState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...EMPTY_PROMPT_STATE, ...JSON.parse(raw) } : EMPTY_PROMPT_STATE;
  } catch {
    return EMPTY_PROMPT_STATE;
  }
}
const save = (s: PromptState) => AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});

const listeners = new Set<(moment: SaveMoment) => void>();
export function onSavePrompt(l: (moment: SaveMoment) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export async function maybePromptToSave(moment: SaveMoment, nowMs = Date.now()): Promise<boolean> {
  const s = await load();
  const isGuest = !!auth.currentUser?.isAnonymous;
  if (!shouldPrompt(moment, s, isGuest, nowMs)) return false;
  await save({ ...s, lastPromptAtMs: nowMs });
  listeners.forEach((l) => l(moment));
  return true;
}

export async function dismissSavePrompt(): Promise<void> {
  const s = await load();
  await save({ ...s, dismissals: s.dismissals + 1 });
}

/** A finished drive: counted on the server (Overview "trips today") and for the 3rd-trip prompt. */
let lastTripEndMs = 0;
export async function recordTripEnd(nowMs = Date.now()): Promise<void> {
  // Arrival can be reported on several ticks in a row: one trip per 2 minutes.
  if (nowMs - lastTripEndMs < 2 * 60 * 1000) return;
  lastTripEndMs = nowMs;
  callFn("recordTrip", {}).catch(() => {});
  const s = await load();
  const next = { ...s, trips: s.trips + 1 };
  await save(next);
  await maybePromptToSave("tripEnded");
}

export const GUEST_WARNING =
  "If you delete the app or change phones, your saved places and settings will be lost unless you create an account.";
