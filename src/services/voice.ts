import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";

const VOICE_ENABLED_KEY = "@trackline/voiceEnabled";
const VOICE_VOLUME_KEY = "@trackline/voiceVolume";
const VOICE_IDENTIFIER_KEY = "@trackline/voiceIdentifier";

/**
 * voiceEnabled is stored separately from the rest of AppSettings because it can change
 * mid-session via the map's mute button and must survive app restarts on its own —
 * Settings' "default voice guidance" toggle only seeds this value, it doesn't own it.
 */
export async function getVoiceEnabled(fallback: boolean): Promise<boolean> {
  const raw = await AsyncStorage.getItem(VOICE_ENABLED_KEY);
  if (raw === null) return fallback;
  return raw === "true";
}

export async function setVoiceEnabled(value: boolean): Promise<void> {
  await AsyncStorage.setItem(VOICE_ENABLED_KEY, value ? "true" : "false");
}

// Same pattern as voiceEnabled above -- set live from the map's volume slider while
// navigating, persisted so it survives app restarts on its own.
export async function getVoiceVolume(fallback = 1.0): Promise<number> {
  const raw = await AsyncStorage.getItem(VOICE_VOLUME_KEY);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function setVoiceVolume(value: number): Promise<void> {
  await AsyncStorage.setItem(VOICE_VOLUME_KEY, String(value));
}

// Real, explicit request for "voice changes for character" -- these are real, distinct voices
// actually installed on the driver's own device (expo-speech's getAvailableVoicesAsync, the same
// on-device TTS engine iOS/Android's own Settings > Accessibility > Spoken Content voice picker
// exposes), never invented personas with no real audio behind them. null/undefined means "use
// whatever the OS picks as its own default voice" -- the exact previous behavior, unchanged
// until a driver actually picks one.
export async function getVoiceIdentifier(): Promise<string | null> {
  return AsyncStorage.getItem(VOICE_IDENTIFIER_KEY);
}

export async function setVoiceIdentifier(identifier: string | null): Promise<void> {
  if (identifier === null) await AsyncStorage.removeItem(VOICE_IDENTIFIER_KEY);
  else await AsyncStorage.setItem(VOICE_IDENTIFIER_KEY, identifier);
}

// English-only -- turn-by-turn instructions are only ever generated in English (Google
// Directions' own html_instructions, see services/directions.ts), so a non-English voice would
// just mispronounce them, not offer a genuinely usable alternative. Sorted with Enhanced-quality
// voices first (Speech.VoiceQuality.Enhanced -- the OS's own higher-fidelity neural voices,
// where installed) since those are the ones actually worth surfacing as a real "which voice"
// choice; Default-quality entries still show, just after.
export async function getAvailableVoices(): Promise<Speech.Voice[]> {
  const voices = await Speech.getAvailableVoicesAsync();
  const englishVoices = voices
    .filter((v) => v.language?.toLowerCase().startsWith("en"))
    .sort((a, b) => (a.quality === b.quality ? a.name.localeCompare(b.name) : a.quality === "Enhanced" ? -1 : 1));

  // Real, confirmed duplicate: the same named voice (e.g. "Eddy", "Flo", "Grandma") is often
  // registered under more than one English locale (en-US, en-GB, en-AU, ...) as two separate
  // entries with the same real display name but different identifiers -- which is exactly why
  // the picker showed the same pill twice. Keep just one real voice per distinct name; the sort
  // above already puts an Enhanced-quality entry first for a given name, so that's the one kept.
  const seenNames = new Set<string>();
  const deduped: Speech.Voice[] = [];
  for (const v of englishVoices) {
    if (seenNames.has(v.name)) continue;
    seenNames.add(v.name);
    deduped.push(v);
  }
  return deduped;
}

// Real, explicit request (Waze-style redesign, Phase 3 voice picker) -- the picker's "All
// languages" section needs every real voice actually installed on this device, not just the
// English ones getAvailableVoices() above deliberately limits itself to (that function is kept
// as-is since the live turn-by-turn instructions it feeds are English-only regardless). Deduped
// by identifier (never by display name across languages -- unlike the English-only list above,
// a same-named voice in two different languages is two genuinely different real voices here,
// not a true duplicate).
export async function getAllDeviceVoices(): Promise<Speech.Voice[]> {
  const voices = await Speech.getAvailableVoicesAsync();
  const seen = new Set<string>();
  const deduped: Speech.Voice[] = [];
  for (const v of voices) {
    if (seen.has(v.identifier)) continue;
    seen.add(v.identifier);
    deduped.push(v);
  }
  return deduped.sort((a, b) => {
    const langCompare = (a.language ?? "").localeCompare(b.language ?? "");
    if (langCompare !== 0) return langCompare;
    if (a.quality !== b.quality) return a.quality === "Enhanced" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const VOICE_CONSENT_COUNT_KEY = "@trackline/voiceConsentShownCount";
// Real, explicit request -- "show this modal only the first 3 times ever (counter persisted),
// then select directly."
export const VOICE_CONSENT_MAX_SHOWS = 3;

export async function getVoiceConsentShownCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(VOICE_CONSENT_COUNT_KEY);
  const parsed = raw === null ? 0 : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function incrementVoiceConsentShownCount(): Promise<number> {
  const next = (await getVoiceConsentShownCount()) + 1;
  await AsyncStorage.setItem(VOICE_CONSENT_COUNT_KEY, String(next));
  return next;
}

export function speak(instruction: string, volume = 1.0, voiceIdentifier?: string | null, onDone?: () => void): void {
  Speech.stop();
  Speech.speak(instruction, {
    rate: 1.0,
    pitch: 1.0,
    volume,
    ...(voiceIdentifier ? { voice: voiceIdentifier } : {}),
    ...(onDone ? { onDone, onStopped: onDone, onError: onDone } : {}),
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}
