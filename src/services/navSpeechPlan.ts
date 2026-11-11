import type { ManeuverType, RouteStep } from "@/services/directions";
import type { AlertType } from "@/types/alert";
import type { SpokenDirectionsMode } from "@/services/settings";
import { extractRoundaboutExitNumber } from "@/utils/navFormat";
import {
  listComma,
  localizedDistanceCue,
  localizedPhrase,
  localizedReport,
  type NavLanguage,
} from "@/services/navLanguage";

// What the navigation voice is going to say, worked out separately from HOW it gets said
// (services/navSpeech.ts). Nothing in here touches audio, storage or the network, so every rule
// below is checked directly by scripts/test-nav-speech.ts.
//
// An utterance is a list of segments. Each segment always carries its plain text, and may also
// name one of the driver's own recorded clips (services/recordedVoices.ts). A recorded voice
// plays the clip where one exists and speaks the text with the phone's voice where it doesn't --
// that per-segment fallback is the "missing clips fall back to default TTS" rule. Every other
// kind of voice just speaks all the text.

export interface SpeechSegment {
  /** One of the recordable clip keys, when this segment has one. */
  clipKey?: string;
  text: string;
}

// ---------------------------------------------------------------------------------------------
// Which voice is selected. Stored in the same single "voice identifier" setting that has always
// held a device voice id -- a recorded or character voice is just a prefixed value in it.

export const RECORDED_VOICE_IDENTIFIER = "recorded:mine";
const PERSONA_PREFIX = "persona:";

export type VoiceSelection =
  | { kind: "device"; identifier: string | null }
  | { kind: "recorded" }
  | { kind: "persona"; personaId: string };

export function personaVoiceIdentifier(personaId: string): string {
  return `${PERSONA_PREFIX}${personaId}`;
}

export function parseVoiceIdentifier(identifier: string | null | undefined): VoiceSelection {
  if (!identifier) return { kind: "device", identifier: null };
  if (identifier === RECORDED_VOICE_IDENTIFIER) return { kind: "recorded" };
  if (identifier.startsWith(PERSONA_PREFIX)) {
    return { kind: "persona", personaId: identifier.slice(PERSONA_PREFIX.length) };
  }
  return { kind: "device", identifier };
}

// ---------------------------------------------------------------------------------------------
// Distances

export type DistanceUnit = "km" | "miles";

interface DistanceCue {
  meters: number;
  text: string;
  clipKey?: string;
}

// The metric cues are exactly the five distance clips a driver can record.
const METRIC_CUES: DistanceCue[] = [
  { meters: 1500, text: "In 1.5 kilometres", clipKey: "dist_1_5km" },
  { meters: 1000, text: "In 1 kilometre", clipKey: "dist_1km" },
  { meters: 800, text: "In 800 metres", clipKey: "dist_800m" },
  { meters: 400, text: "In 400 metres", clipKey: "dist_400m" },
  { meters: 200, text: "In 200 metres", clipKey: "dist_200m" },
];

// There are no imperial clips to record, so in miles a recorded voice simply leaves the
// distance out and every other voice speaks these.
const IMPERIAL_CUES: DistanceCue[] = [
  { meters: 1609, text: "In 1 mile" },
  { meters: 805, text: "In half a mile" },
  { meters: 402, text: "In a quarter of a mile" },
  { meters: 183, text: "In 600 feet" },
];

function cuesFor(unit: DistanceUnit): DistanceCue[] {
  return unit === "miles" ? IMPERIAL_CUES : METRIC_CUES;
}

/** The advance-warning distances, longest first -- everything except the final "nearly there" cue. */
export function earlyAnnouncementThresholds(unit: DistanceUnit): number[] {
  return cuesFor(unit)
    .slice(0, -1)
    .map((cue) => cue.meters);
}

/**
 * The cue for a distance, or null when the distance isn't close to any of them. "Close" is
 * within 30% -- an announcement fires when the driver crosses a threshold, so the live distance
 * is normally just under it, but GPS fixes are a few seconds apart and a short step can start
 * well inside one. Saying "in 200 metres" at 90m would simply be wrong, so then nothing is said.
 */
export function distanceCue(distanceMeters: number, unit: DistanceUnit): DistanceCue | null {
  let best: DistanceCue | null = null;
  let bestError = Infinity;
  for (const cue of cuesFor(unit)) {
    const error = Math.abs(distanceMeters - cue.meters) / cue.meters;
    if (error < bestError) {
      best = cue;
      bestError = error;
    }
  }
  return best && bestError <= 0.3 ? best : null;
}

// ---------------------------------------------------------------------------------------------
// Manoeuvres

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

const MANEUVER_CLIPS: Partial<Record<NonNullable<ManeuverType>, SpeechSegment>> = {
  "turn-left": { clipKey: "instr_turn_left", text: "Turn left" },
  "turn-sharp-left": { clipKey: "instr_turn_left", text: "Turn left" },
  "turn-right": { clipKey: "instr_turn_right", text: "Turn right" },
  "turn-sharp-right": { clipKey: "instr_turn_right", text: "Turn right" },
  "turn-slight-left": { clipKey: "instr_keep_left", text: "Keep left" },
  "turn-slight-right": { clipKey: "instr_keep_right", text: "Keep right" },
  "fork-left": { clipKey: "instr_keep_left", text: "Keep left" },
  "fork-right": { clipKey: "instr_keep_right", text: "Keep right" },
  "ramp-left": { clipKey: "instr_exit_left", text: "Exit left" },
  "ramp-right": { clipKey: "instr_exit_right", text: "Exit right" },
  "uturn-left": { clipKey: "instr_uturn", text: "Make a U-turn" },
  "uturn-right": { clipKey: "instr_uturn", text: "Make a U-turn" },
  straight: { clipKey: "instr_straight", text: "Go straight on" },
};

type SpokenStep = Pick<RouteStep, "instruction" | "maneuver">;

/**
 * A step as recordable clips, or null when it can't be said that way -- "Head north on George
 * St", "Merge onto the M4", "Your destination is on the left" have no clip, and neither does a
 * roundabout whose exit number the instruction doesn't state. Those are spoken whole instead.
 */
export function maneuverSegments(step: SpokenStep): SpeechSegment[] | null {
  if (!step.maneuver) return null;
  if (step.maneuver === "roundabout-left" || step.maneuver === "roundabout-right") {
    const exit = extractRoundaboutExitNumber(step.instruction);
    if (!exit || exit < 1 || exit > ORDINALS.length) return null;
    return [
      { clipKey: "instr_roundabout", text: "At the roundabout" },
      { clipKey: `instr_exit_${exit}`, text: `take the ${ORDINALS[exit - 1]} exit` },
    ];
  }
  const segment = MANEUVER_CLIPS[step.maneuver];
  return segment ? [segment] : null;
}

function lowerFirst(text: string): string {
  return text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text;
}

function withoutFinalStop(text: string): string {
  return text.replace(/[.\s]+$/, "");
}

export interface StepAnnouncement {
  step: SpokenStep;
  /** Road distance still to go before the manoeuvre. */
  distanceMeters: number;
  /** "early" is the advance warning; "final" is the one just before the manoeuvre. */
  kind: "early" | "final";
  /** The step straight after this one, when it follows closely enough to be worth chaining. */
  thenStep?: SpokenStep | null;
}

export interface SpeechPlan {
  /** For a recorded voice: clips where they exist, text where they don't. */
  segments: SpeechSegment[];
  /** For every other voice: the whole thing as one sentence. */
  fullText: string;
}

export function planStepAnnouncement(
  announcement: StepAnnouncement,
  unit: DistanceUnit,
  // The language Google's instructions were requested in (services/navLanguage.ts). In anything
  // but English the instruction text is already translated, and the words this adds around it
  // have to match.
  language: NavLanguage = "en"
): SpeechPlan {
  const { step, distanceMeters, kind, thenStep } = announcement;
  const cue = distanceCue(distanceMeters, unit);
  const instruction = withoutFinalStop(step.instruction);
  const comma = listComma(language);
  const cueText = cue ? localizedDistanceCue(language, cue.meters) ?? cue.text : null;
  const andThen = localizedPhrase(language, "andThen") ?? "and then";

  // -- Every voice except a recorded one: Google's own full sentence, street names and all.
  // The final call-out stays exactly what it has always been (no distance in front), so only
  // the advance warning and the "and then" are new for those voices.
  let fullText = kind === "early" && cueText ? `${cueText}${comma}${lowerFirst(instruction)}` : instruction;
  if (kind === "final" && thenStep) {
    fullText += `${comma}${andThen} ${lowerFirst(withoutFinalStop(thenStep.instruction))}`;
  }

  // A recorded voice is English clips only; in any other language everything is simply spoken.
  if (language !== "en") return { segments: [{ text: fullText }], fullText };

  // -- A recorded voice: the distance clip, the manoeuvre clip(s), and the chained manoeuvre.
  const segments: SpeechSegment[] = [];
  const maneuver = maneuverSegments(step);
  if (cue?.clipKey) segments.push({ clipKey: cue.clipKey, text: cue.text });
  else if (cue && kind === "early") segments.push({ text: cue.text });
  if (maneuver) segments.push(...maneuver);
  else segments.push({ text: instruction });

  if (kind === "final" && thenStep) {
    const thenManeuver = maneuverSegments(thenStep);
    segments.push({ clipKey: "other_and_then", text: "and then" });
    if (thenManeuver) segments.push(...thenManeuver);
    else segments.push({ text: lowerFirst(withoutFinalStop(thenStep.instruction)) });
  }

  return { segments, fullText };
}

// ---------------------------------------------------------------------------------------------
// Everything that isn't a turn

export type NavPhrase =
  | { kind: "start" }
  | { kind: "rerouting" }
  | { kind: "arrived" }
  | { kind: "heavyTraffic" }
  | { kind: "report"; alertType: AlertType };

const REPORT_SEGMENTS: Record<AlertType, SpeechSegment> = {
  police: { clipKey: "report_police", text: "Police reported" },
  crash: { clipKey: "report_crash", text: "Crash reported" },
  hazard: { clipKey: "report_hazard", text: "Hazard reported" },
  camera: { clipKey: "report_speed_camera", text: "Speed camera reported" },
  // No clip to record for these two, so they're always spoken.
  traffic_light: { text: "Traffic light reported" },
  emergency_vehicle: { text: "Emergency vehicle reported" },
};

export const DEFAULT_START_PHRASES: SpeechSegment[] = [
  { clipKey: "start_all_set", text: "All set. Let's go" },
  { clipKey: "start_were_all_set", text: "We're all set, let's go!" },
];

export interface PhraseContext {
  /** Start-of-drive phrases the driver added themselves (each with its own clip key). */
  customStartPhrases?: SpeechSegment[];
  /** Clip keys that actually have a recording, so "start" can prefer a phrase that does. */
  recordedKeys?: ReadonlySet<string>;
  /** 0..1, injected so the choice between start phrases is testable. */
  random?: () => number;
  language?: NavLanguage;
}

export function planPhrase(phrase: NavPhrase, context: PhraseContext = {}): SpeechPlan {
  const language = context.language ?? "en";
  if (language !== "en") {
    const text =
      phrase.kind === "report" ? localizedReport(language, phrase.alertType) : localizedPhrase(language, phrase.kind);
    if (text) return { segments: [{ text }], fullText: text };
  }
  let segment: SpeechSegment;
  if (phrase.kind === "start") {
    const all = [...DEFAULT_START_PHRASES, ...(context.customStartPhrases ?? [])];
    // A recorded voice should open with something the driver actually recorded whenever they
    // recorded any start phrase at all, rather than landing on an unrecorded one by chance.
    const recorded = all.filter((s) => s.clipKey && context.recordedKeys?.has(s.clipKey));
    const pool = recorded.length > 0 ? recorded : all;
    const index = Math.min(pool.length - 1, Math.floor((context.random ?? Math.random)() * pool.length));
    segment = pool[index];
  } else if (phrase.kind === "rerouting") {
    segment = { clipKey: "other_rerouting", text: "Re-routing" };
  } else if (phrase.kind === "arrived") {
    segment = { clipKey: "other_arrived", text: "You've arrived" };
  } else if (phrase.kind === "heavyTraffic") {
    segment = { clipKey: "report_heavy_traffic", text: "Heavy traffic reported" };
  } else {
    segment = REPORT_SEGMENTS[phrase.alertType];
  }
  return { segments: [segment], fullText: segment.text };
}

// ---------------------------------------------------------------------------------------------
// How chatty. This is the Sound sheet's "Spoken directions" choice, which until now only changed
// the mute icon -- nothing actually read it when deciding whether to speak.

export function shouldSpeakStep(
  mode: SpokenDirectionsMode,
  kind: "early" | "final",
  step: SpokenStep,
  isLastStep: boolean
): boolean {
  if (mode === "off" || mode === "onlyAlerts") return false;
  if (mode === "normal") return true;
  // "Less chatty": no advance warnings, and no call-out for carrying straight on -- only the
  // turns that need doing, and the arrival.
  if (kind === "early") return false;
  return isLastStep || (!!step.maneuver && step.maneuver !== "straight");
}

export function shouldSpeakPhrase(mode: SpokenDirectionsMode, phrase: NavPhrase): boolean {
  if (mode === "off") return false;
  const isAlert = phrase.kind === "report" || phrase.kind === "heavyTraffic";
  if (isAlert) return true;
  if (mode === "onlyAlerts") return false;
  // Re-routing and arriving are things a driver needs to know; the cheerful opener isn't.
  if (mode === "lessChatty") return phrase.kind !== "start";
  return true;
}
