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
  return voices
    .filter((v) => v.language?.toLowerCase().startsWith("en"))
    .sort((a, b) => (a.quality === b.quality ? a.name.localeCompare(b.name) : a.quality === "Enhanced" ? -1 : 1));
}

export function speak(instruction: string, volume = 1.0, voiceIdentifier?: string | null): void {
  Speech.stop();
  Speech.speak(instruction, {
    rate: 1.0,
    pitch: 1.0,
    volume,
    ...(voiceIdentifier ? { voice: voiceIdentifier } : {}),
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}
