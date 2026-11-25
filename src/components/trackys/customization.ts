import type { TrackyEyeStyle, TrackyMouthStyle } from "./parts";
import type { TrackyAccessoryKey } from "./accessories";
import { isUnlocked, type TrackyUnlock, type TrackyUnlockContext } from "./moods";

// Real, explicit request (ADD-ON Part A -- "Make your Tracky" customiser). A design a driver
// builds themselves, independent of the real auto/selected MOOD system (moods.ts) -- when a
// driver has actually saved one (see trackyCustomization.ts's own appearanceMode), it's what
// renders everywhere a Tracky of theirs would otherwise show (menu header, profile preview, and
// their own presence marker on other drivers' maps), replacing the mood-driven look entirely.
// Unlocks deliberately reuse the EXACT same real milestones moods.ts's own mood unlocks do
// (driving streak, Ghost mode, birthday) rather than inventing a second, parallel currency/XP
// system with no real data behind it.

export type TrailEffectKey = "none" | "dots" | "sparkle" | "ghost";

export interface TrackyCustomization {
  color: string;
  colorBottom?: string;
  eyeStyle: TrackyEyeStyle;
  mouthStyle: TrackyMouthStyle;
  accessory?: TrackyAccessoryKey;
  accessoryColor?: string;
  trail: TrailEffectKey;
}

export const DEFAULT_CUSTOMIZATION: TrackyCustomization = {
  color: "#60A5FA",
  eyeStyle: "normal",
  mouthStyle: "smile",
  trail: "none",
};

// Drawn from the exact same, already-battle-tested mood colours (moods.ts) rather than picking
// brand-new ones -- guarantees every swatch already looks right against TrackyBody's own
// outline/shadow/highlight shading. Pure cosmetic colour choice, so every swatch is always
// unlocked -- no real milestone makes sense as a gate on "which colour you like."
export const BODY_COLOR_PALETTE: string[] = [
  "#FBBF24", "#6EE7B7", "#FB923C", "#C4B5FD", "#60A5FA", "#FB7185",
  "#94A3B8", "#2DD4BF", "#4ADE80", "#F87171", "#A78BFA", "#EAB308",
];

export const EYE_STYLE_OPTIONS: { key: TrackyEyeStyle; label: string }[] = [
  { key: "normal", label: "Normal" },
  { key: "sleepy", label: "Sleepy" },
  { key: "heart", label: "Heart" },
  { key: "grumpy", label: "Grumpy" },
  { key: "closedHappy", label: "Content" },
  { key: "dot", label: "Dot" },
];

export const MOUTH_STYLE_OPTIONS: { key: TrackyMouthStyle; label: string }[] = [
  { key: "smile", label: "Smile" },
  { key: "grin", label: "Grin" },
  { key: "smirk", label: "Smirk" },
  { key: "frown", label: "Frown" },
  { key: "flat", label: "Flat" },
  { key: "o", label: "Surprised" },
];

interface AccessoryOption {
  key: TrackyAccessoryKey;
  label: string;
  unlock: TrackyUnlock;
  unlockHint?: string;
}

// Real unlocks -- only the three accessories that already gate a MOOD on a real milestone
// (sparkles/partyHat/cake, see moods.ts) are gated here too, for the same real reason; every
// other accessory is purely decorative and always available.
export const ACCESSORY_OPTIONS: AccessoryOption[] = [
  { key: "sunglasses", label: "Sunglasses", unlock: { type: "always" } },
  { key: "roundGlasses", label: "Round glasses", unlock: { type: "always" } },
  { key: "sparkles", label: "Sparkles", unlock: { type: "streak", days: 3 }, unlockHint: "Drive 3 days in a row" },
  { key: "zzz", label: "Zzz", unlock: { type: "always" } },
  { key: "fork", label: "Fork", unlock: { type: "always" } },
  { key: "partyHat", label: "Party hat", unlock: { type: "streak", days: 7 }, unlockHint: "Drive 7 days in a row" },
  { key: "headband", label: "Headband", unlock: { type: "always" } },
  { key: "cap", label: "Cap", unlock: { type: "always" } },
  { key: "whistle", label: "Whistle", unlock: { type: "always" } },
  { key: "headphones", label: "Headphones", unlock: { type: "always" } },
  { key: "umbrella", label: "Umbrella", unlock: { type: "always" } },
  { key: "sunHat", label: "Sun hat", unlock: { type: "always" } },
  { key: "bucketHat", label: "Bucket hat", unlock: { type: "always" } },
  { key: "cake", label: "Cake", unlock: { type: "birthdayOnly" }, unlockHint: "Only on your birthday" },
];

interface TrailOption {
  key: TrailEffectKey;
  label: string;
  unlock: TrackyUnlock;
  unlockHint?: string;
}

// The real visual effect rendered BEHIND a moving Tracky on the map (see Part B's own
// presenceTrail.ts) -- stored as part of the saved customization since it's a real style
// choice, same as the body colour or an accessory.
export const TRAIL_OPTIONS: TrailOption[] = [
  { key: "none", label: "None", unlock: { type: "always" } },
  { key: "dots", label: "Dots", unlock: { type: "always" } },
  { key: "sparkle", label: "Sparkle", unlock: { type: "streak", days: 3 }, unlockHint: "Drive 3 days in a row" },
  { key: "ghost", label: "Ghost trail", unlock: { type: "ghostOnly" }, unlockHint: "Turn on Ghost mode" },
];

export function isAccessoryUnlocked(key: TrackyAccessoryKey, ctx: TrackyUnlockContext): boolean {
  const option = ACCESSORY_OPTIONS.find((o) => o.key === key);
  return option ? isUnlocked(option.unlock, ctx) : false;
}

export function isTrailUnlocked(key: TrailEffectKey, ctx: TrackyUnlockContext): boolean {
  const option = TRAIL_OPTIONS.find((o) => o.key === key);
  return option ? isUnlocked(option.unlock, ctx) : false;
}

// Real, explicit request -- a design is only actually usable (selectable as "my Tracky") once
// every one of its own parts is unlocked; a design built around a still-locked accessory/trail
// shows locked too, same honest "can't select it yet" treatment moods.ts's own grid already
// uses for a single locked mood.
export function isCustomizationUnlocked(c: TrackyCustomization, ctx: TrackyUnlockContext): boolean {
  if (c.accessory && !isAccessoryUnlocked(c.accessory, ctx)) return false;
  return isTrailUnlocked(c.trail, ctx);
}

export interface TrackyPreset {
  key: string;
  label: string;
  customization: TrackyCustomization;
}

// Real, explicit request -- a ready-made gallery so a driver can start from something that
// already looks good rather than an empty blank Tracky, then still freely tweak any part from
// there (presets are just a starting customization, not a separate locked-in mode).
export const TRACKY_PRESETS: TrackyPreset[] = [
  {
    key: "classic",
    label: "Classic",
    customization: { color: "#FBBF24", eyeStyle: "normal", mouthStyle: "smile", trail: "none" },
  },
  {
    key: "coolCat",
    label: "Cool Cat",
    customization: { color: "#2DD4BF", eyeStyle: "normal", mouthStyle: "smirk", accessory: "cap", accessoryColor: "#0F766E", trail: "none" },
  },
  {
    key: "nightOwl",
    label: "Night Owl",
    customization: { color: "#C4B5FD", eyeStyle: "sleepy", mouthStyle: "o", accessory: "zzz", trail: "none" },
  },
  {
    key: "sunshine",
    label: "Sunshine",
    customization: { color: "#EAB308", eyeStyle: "normal", mouthStyle: "smile", accessory: "sunHat", trail: "dots" },
  },
  {
    key: "partyAnimal",
    label: "Party Animal",
    customization: { color: "#F472B6", eyeStyle: "closedHappy", mouthStyle: "grin", accessory: "partyHat", trail: "sparkle" },
  },
  {
    key: "ghostRider",
    label: "Ghost Rider",
    customization: { color: "#F8FAFC", eyeStyle: "dot", mouthStyle: "o", trail: "ghost" },
  },
];
