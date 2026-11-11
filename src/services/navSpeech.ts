import * as Speech from "expo-speech";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { File } from "expo-file-system";
import { getRecordedClipUris, getCustomStartPhrases } from "@/services/recordedVoices";
import { getPersonaSpeechUri, prefetchPersonaSpeech } from "@/services/personaSpeech";
import { allPersonaLines, personaLine } from "@/services/personaVoices";
import { expectedAnnouncements } from "@/services/navigationGuidance";
import type { RouteStep } from "@/services/directions";
import type { SpokenDirectionsMode } from "@/services/settings";
import {
  earlyAnnouncementThresholds,
  parseVoiceIdentifier,
  planPhrase,
  planStepAnnouncement,
  shouldSpeakPhrase,
  type DistanceUnit,
  type NavPhrase,
  type SpeechPlan,
  type SpeechSegment,
} from "@/services/navSpeechPlan";

// The one place navigation audio is actually produced. navSpeechPlan.ts decides WHAT to say;
// this says it, in whichever voice is selected:
//
//   - a phone voice      -> the whole sentence through the phone's own text-to-speech
//   - "my recorded voice" -> the driver's own clips, in order, with the phone's default voice
//                            filling in any part they haven't recorded
//   - a character voice  -> one synthesized clip of the whole sentence (personaSpeech.ts), or
//                            the phone's default voice if that clip isn't ready in time
//
// Only one thing is ever spoken at a time: starting something new cancels whatever was playing,
// exactly as the old single speak() call did.
//
// This deliberately does NOT touch the audio session mode. Siren detection owns that (it keeps
// the microphone open), and switching it here mid-drive would cut that listener off.

export interface SpeakOptions {
  /** The stored voice setting -- a device voice id, a recorded/character marker, or null. */
  voiceIdentifier: string | null;
  volume: number;
  onDone?: () => void;
}

// Bumped every time something new starts (or everything is stopped). Each utterance holds the
// number it started with and gives up the moment it no longer matches.
let generation = 0;
let activePlayer: AudioPlayer | null = null;
let activePlayerCleanup: (() => void) | null = null;

// A recorded clip is at most 6 seconds; a character clip is one sentence. Anything still
// "playing" after this has stalled, and guidance must not hang on it.
const CLIP_TIMEOUT_MS = 12_000;
// How long a character voice gets to produce its clip before the phone's voice says it instead.
// A turn announced late is worse than a turn announced in the wrong voice.
const PERSONA_WAIT_MS = 1_800;

function releasePlayer(): void {
  activePlayerCleanup?.();
  activePlayerCleanup = null;
  if (activePlayer) {
    try {
      activePlayer.pause();
      activePlayer.remove();
    } catch {
      // Already released -- nothing to do.
    }
    activePlayer = null;
  }
}

// One thing waiting its turn behind whatever is being said now. Only ever the newest: a
// call-out about a report from a minute ago isn't worth saying late.
let waiting: { plan: SpeechPlan; options: SpeakOptions } | null = null;
let speaking = false;

export function stopNavSpeech(): void {
  generation++;
  waiting = null;
  speaking = false;
  Speech.stop();
  releasePlayer();
}

function speakText(text: string, volume: number, deviceVoice: string | null): Promise<void> {
  return new Promise((resolve) => {
    Speech.speak(text, {
      rate: 1.0,
      pitch: 1.0,
      volume,
      ...(deviceVoice ? { voice: deviceVoice } : {}),
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}

/** Plays one audio file to the end. Resolves false if it couldn't be played at all. */
function playClip(uri: string, volume: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      releasePlayer();
      resolve(ok);
    };
    try {
      const player = createAudioPlayer({ uri });
      activePlayer = player;
      player.volume = Math.max(0, Math.min(1, volume));
      const subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (status.playing) started = true;
        if (status.didJustFinish) finish(true);
      });
      const timeout = setTimeout(() => finish(started), CLIP_TIMEOUT_MS);
      activePlayerCleanup = () => {
        clearTimeout(timeout);
        subscription.remove();
        // Something else took over (a newer announcement, or stopNavSpeech) -- let the waiting
        // utterance finish its own loop, which will then see it's been superseded.
        if (!settled) {
          settled = true;
          resolve(true);
        }
      };
      player.play();
    } catch {
      finish(false);
    }
  });
}

function clipFileExists(uri: string | undefined): uri is string {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

async function speakRecorded(segments: SpeechSegment[], volume: number, mine: number): Promise<void> {
  const clips = await getRecordedClipUris().catch(() => ({}) as Record<string, string>);
  // Neighbouring parts that have no clip are spoken as one phrase rather than as separate
  // stop-start fragments.
  let pendingText: string[] = [];
  const flushText = async () => {
    if (pendingText.length === 0) return;
    const text = pendingText.join(", ");
    pendingText = [];
    await speakText(text, volume, null);
  };

  for (const segment of segments) {
    if (mine !== generation) return;
    const uri = segment.clipKey ? clips[segment.clipKey] : undefined;
    if (!clipFileExists(uri)) {
      pendingText.push(segment.text);
      continue;
    }
    await flushText();
    if (mine !== generation) return;
    const played = await playClip(uri, volume);
    if (mine !== generation) return;
    // The file was there but wouldn't play (corrupt, or the audio system refused it): say it.
    if (!played) await speakText(segment.text, volume, null);
  }
  if (mine !== generation) return;
  await flushText();
}

async function speakPersona(personaId: string, text: string, volume: number, mine: number): Promise<void> {
  const uri = await Promise.race([
    getPersonaSpeechUri(personaId, text).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PERSONA_WAIT_MS)),
  ]);
  if (mine !== generation) return;
  const played = uri ? await playClip(uri, volume) : false;
  if (mine !== generation) return;
  if (!played) await speakText(text, volume, null);
}

/**
 * Says one planned utterance in the selected voice.
 *
 * By default it cuts off anything already being said -- right for a turn, which can't wait.
 * With `politely`, it waits for the current utterance to finish instead -- right for a report
 * call-out, which must never talk over "turn left".
 */
export function speakPlan(plan: SpeechPlan, options: SpeakOptions, politely = false): void {
  if (politely && speaking) {
    waiting = { plan, options };
    return;
  }
  stopNavSpeech();
  const mine = generation;
  speaking = true;
  const voice = parseVoiceIdentifier(options.voiceIdentifier);

  let run: Promise<void>;
  if (voice.kind === "recorded") run = speakRecorded(plan.segments, options.volume, mine);
  else if (voice.kind === "persona") run = speakPersona(voice.personaId, plan.fullText, options.volume, mine);
  else run = speakText(plan.fullText, options.volume, voice.identifier);

  run
    .catch(() => {})
    .finally(() => {
      if (mine !== generation) return;
      speaking = false;
      options.onDone?.();
      const next = waiting;
      waiting = null;
      if (next) speakPlan(next.plan, next.options);
    });
}

export interface NavPhraseOptions extends SpeakOptions {
  /** The master "voice guidance" switch. */
  enabled: boolean;
  /** The Sound sheet's "Spoken directions" choice. */
  mode: SpokenDirectionsMode;
}

/**
 * Says one of the non-turn phrases (setting off, re-routing, arriving, a report nearby), if the
 * driver's sound settings allow that kind of phrase at all.
 */
export async function speakNavPhrase(phrase: NavPhrase, options: NavPhraseOptions): Promise<void> {
  if (!options.enabled || !shouldSpeakPhrase(options.mode, phrase)) return;
  const voice = parseVoiceIdentifier(options.voiceIdentifier);
  const isCallOut = phrase.kind === "report" || phrase.kind === "heavyTraffic";

  let plan: SpeechPlan;
  if (voice.kind === "recorded") {
    const [clips, custom] = await Promise.all([
      getRecordedClipUris().catch(() => ({}) as Record<string, string>),
      getCustomStartPhrases().catch(() => []),
    ]);
    plan = planPhrase(phrase, {
      customStartPhrases: custom.map((c) => ({ clipKey: c.key, text: c.label })),
      recordedKeys: new Set(Object.keys(clips)),
    });
  } else {
    plan = planPhrase(phrase);
    if (voice.kind === "persona") {
      const line = personaLine(voice.personaId, phrase);
      if (line) plan = { segments: [{ text: line }], fullText: line };
    }
  }
  speakPlan(plan, options, isCallOut);
}

// How many steps ahead a character voice's clips are fetched. Far enough that a run of quick
// turns is covered; not so far that a long trip synthesizes sentences a re-route will discard.
const PERSONA_PREFETCH_STEPS = 6;

/**
 * For a character voice only: starts fetching the sentences guidance is about to say, so they're
 * already on the phone when each turn comes up. Does nothing for any other kind of voice.
 */
export function prefetchUpcomingSpeech(
  steps: RouteStep[],
  fromStepIndex: number,
  unit: DistanceUnit,
  mode: SpokenDirectionsMode,
  voiceIdentifier: string | null
): void {
  const voice = parseVoiceIdentifier(voiceIdentifier);
  if (voice.kind !== "persona" || mode === "off" || mode === "onlyAlerts") return;
  const thresholds = mode === "normal" ? earlyAnnouncementThresholds(unit) : [];
  const texts: string[] = [];
  for (let i = fromStepIndex; i < Math.min(steps.length, fromStepIndex + PERSONA_PREFETCH_STEPS); i++) {
    for (const announcement of expectedAnnouncements(steps, i, thresholds)) {
      texts.push(planStepAnnouncement(announcement, unit).fullText);
    }
  }
  // The character's own lines, the first time a trip starts in that voice (they're cached after).
  if (fromStepIndex === 0) texts.push(...allPersonaLines(voice.personaId), "Re-routing", "You've arrived");
  prefetchPersonaSpeech(voice.personaId, texts);
}

/** Plain text in the selected voice -- for things that aren't navigation (e.g. a voice preview). */
export function speakInSelectedVoice(text: string, options: SpeakOptions): void {
  speakPlan({ segments: [{ text }], fullText: text }, options);
}
