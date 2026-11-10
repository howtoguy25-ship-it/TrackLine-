import type { TrackyEyeStyle, TrackyMouthStyle } from "./parts";
import type { TrackyAccessoryKey } from "./accessories";

// The real, central Tracky mood registry -- every mood's colour/face/accessory is defined once
// here, reused by every render site (menu header, profile grid, map markers, empty states).
export type TrackyMoodKey =
  | "happy"
  | "chill"
  | "excited"
  | "sleepy"
  | "hungry"
  | "party"
  | "focused"
  | "lovestruck"
  | "grumpy"
  | "cool"
  | "nerd"
  | "spooky"
  | "sporty"
  | "musical"
  | "rainy"
  | "sunny"
  | "aussieArvo"
  | "birthday";

// Real, explicit request -- some moods are tied to the exact same real milestones the AUTO MOOD
// section itself uses (driving streak, ghost mode, birthday), not an arbitrary separate gate.
export type TrackyUnlock =
  | { type: "always" }
  | { type: "streak"; days: number }
  | { type: "ghostOnly" }
  | { type: "birthdayOnly" };

export interface TrackyMoodDef {
  key: TrackyMoodKey;
  label: string;
  color: string;
  colorBottom?: string;
  eyeStyle: TrackyEyeStyle;
  mouthStyle: TrackyMouthStyle;
  accessory?: TrackyAccessoryKey;
  accessoryColor?: string;
  unlock: TrackyUnlock;
  unlockHint?: string;
}

export const TRACKY_MOODS: Record<TrackyMoodKey, TrackyMoodDef> = {
  happy: {
    key: "happy",
    label: "Happy",
    color: "#FBBF24",
    eyeStyle: "normal",
    mouthStyle: "smile",
    unlock: { type: "always" },
  },
  chill: {
    key: "chill",
    label: "Chill",
    color: "#6EE7B7",
    eyeStyle: "normal",
    mouthStyle: "smirk",
    accessory: "sunglasses",
    unlock: { type: "always" },
  },
  excited: {
    key: "excited",
    label: "Excited",
    color: "#FB923C",
    eyeStyle: "normal",
    mouthStyle: "grin",
    accessory: "sparkles",
    unlock: { type: "streak", days: 3 },
    unlockHint: "Drive 3 days in a row",
  },
  sleepy: {
    key: "sleepy",
    label: "Sleepy",
    color: "#C4B5FD",
    eyeStyle: "sleepy",
    mouthStyle: "o",
    accessory: "zzz",
    unlock: { type: "always" },
  },
  hungry: {
    key: "hungry",
    label: "Hungry",
    color: "#FDBA8C",
    eyeStyle: "normal",
    mouthStyle: "o",
    accessory: "fork",
    unlock: { type: "always" },
  },
  party: {
    key: "party",
    label: "Party",
    color: "#F472B6",
    eyeStyle: "closedHappy",
    mouthStyle: "grin",
    accessory: "partyHat",
    unlock: { type: "streak", days: 7 },
    unlockHint: "Drive 7 days in a row",
  },
  focused: {
    key: "focused",
    label: "Focused",
    color: "#60A5FA",
    eyeStyle: "normal",
    mouthStyle: "flat",
    accessory: "headband",
    unlock: { type: "always" },
  },
  lovestruck: {
    key: "lovestruck",
    label: "Lovestruck",
    color: "#FB7185",
    eyeStyle: "heart",
    mouthStyle: "smile",
    unlock: { type: "always" },
  },
  grumpy: {
    key: "grumpy",
    label: "Grumpy",
    color: "#94A3B8",
    eyeStyle: "grumpy",
    mouthStyle: "frown",
    unlock: { type: "always" },
  },
  cool: {
    key: "cool",
    label: "Cool",
    color: "#2DD4BF",
    eyeStyle: "normal",
    mouthStyle: "smirk",
    accessory: "cap",
    accessoryColor: "#0F766E",
    unlock: { type: "always" },
  },
  nerd: {
    key: "nerd",
    label: "Nerd",
    color: "#4ADE80",
    eyeStyle: "normal",
    mouthStyle: "smile",
    accessory: "roundGlasses",
    unlock: { type: "always" },
  },
  spooky: {
    key: "spooky",
    label: "Spooky",
    color: "#F8FAFC",
    eyeStyle: "dot",
    mouthStyle: "o",
    unlock: { type: "ghostOnly" },
    unlockHint: "Turn on Ghost mode",
  },
  sporty: {
    key: "sporty",
    label: "Sporty",
    color: "#F87171",
    eyeStyle: "normal",
    mouthStyle: "flat",
    accessory: "whistle",
    unlock: { type: "always" },
  },
  musical: {
    key: "musical",
    label: "Musical",
    color: "#A78BFA",
    eyeStyle: "closedHappy",
    mouthStyle: "grin",
    accessory: "headphones",
    unlock: { type: "always" },
  },
  rainy: {
    key: "rainy",
    label: "Rainy",
    color: "#7C8A9D",
    eyeStyle: "normal",
    mouthStyle: "flat",
    accessory: "umbrella",
    unlock: { type: "always" },
  },
  sunny: {
    key: "sunny",
    label: "Sunny",
    color: "#EAB308",
    eyeStyle: "normal",
    mouthStyle: "smile",
    accessory: "sunHat",
    unlock: { type: "always" },
  },
  aussieArvo: {
    key: "aussieArvo",
    label: "Aussie Arvo",
    color: "#D6C7A1",
    eyeStyle: "closedHappy",
    mouthStyle: "smile",
    accessory: "bucketHat",
    unlock: { type: "always" },
  },
  birthday: {
    key: "birthday",
    label: "Birthday",
    color: "#F472B6",
    colorBottom: "#60A5FA",
    eyeStyle: "normal",
    mouthStyle: "grin",
    accessory: "cake",
    unlock: { type: "birthdayOnly" },
    unlockHint: "Shows automatically on your birthday",
  },
};

export const TRACKY_MOOD_ORDER: TrackyMoodKey[] = [
  "happy",
  "chill",
  "excited",
  "sleepy",
  "hungry",
  "party",
  "focused",
  "lovestruck",
  "grumpy",
  "cool",
  "nerd",
  "spooky",
  "sporty",
  "musical",
  "rainy",
  "sunny",
  "aussieArvo",
  "birthday",
];

export interface TrackyUnlockContext {
  drivingStreakDays: number;
  isGhostMode: boolean;
  isBirthdayToday: boolean;
}

/** Real unlock check against the driver's own real stats -- never a guess. `isGhostMode` and
 *  `isBirthdayToday` are real, already-known booleans at every call site (settings/presence
 *  state, a real date compare), `drivingStreakDays` is the real streak this same feature's own
 *  tracker computes (see trackyMood.ts). Generic over a bare `TrackyUnlock` (not just a mood's
 *  own) so the "Make your Tracky" customiser's accessory/trail unlocks (customization.ts) can
 *  reuse these exact same real milestones instead of inventing a second, parallel gate system. */
export function isUnlocked(unlock: TrackyUnlock, ctx: TrackyUnlockContext): boolean {
  switch (unlock.type) {
    case "always":
      return true;
    case "streak":
      return ctx.drivingStreakDays >= unlock.days;
    case "ghostOnly":
      return ctx.isGhostMode;
    case "birthdayOnly":
      return ctx.isBirthdayToday;
    default:
      return false;
  }
}

export function isMoodUnlocked(mood: TrackyMoodDef, ctx: TrackyUnlockContext): boolean {
  return isUnlocked(mood.unlock, ctx);
}
