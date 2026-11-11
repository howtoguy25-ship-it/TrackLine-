import AsyncStorage from "@react-native-async-storage/async-storage";
import { httpsCallable } from "@firebase/functions";
import { Directory, File, Paths } from "expo-file-system";
import { functions } from "@/services/firebase";

// App side of the character voices. A sentence is synthesized once by the server
// (synthesizePersonaSpeech in firebase/functions/index.js), saved on this phone, and played from
// that file every time after -- so a regular commute costs nothing after its first drive.

const AVAILABLE_KEY = "@trackline/personaVoicesAvailable";
// How long to trust a remembered "not available" before asking the server again -- so the
// voices unlock on their own within the hour once the key has been set, with no app update.
const UNAVAILABLE_RECHECK_MS = 60 * 60 * 1000;
// Longer than anything navigation says; anything beyond this isn't a turn instruction.
export const PERSONA_MAX_TEXT_LENGTH = 220;

interface SynthesizeResponse {
  status: "ok" | "not_configured" | "limit_reached" | "failed";
  audioBase64?: string;
}

let availableMemo: { value: boolean; checkedAt: number } | null = null;

/**
 * Whether the server can actually produce character voices right now. False (never a guess)
 * when the ElevenLabs secret hasn't been set, or when the server can't be reached.
 */
export async function getPersonaVoicesAvailable(forceRefresh = false): Promise<boolean> {
  const now = Date.now();
  if (!forceRefresh && availableMemo && (availableMemo.value || now - availableMemo.checkedAt < UNAVAILABLE_RECHECK_MS)) {
    return availableMemo.value;
  }
  if (!forceRefresh && !availableMemo) {
    const stored = await AsyncStorage.getItem(AVAILABLE_KEY).catch(() => null);
    if (stored === "true") {
      // Trusted straight away so a drive can start in the chosen voice with no round trip; if
      // the key is later removed, the first failed synthesis flips this back (see below).
      availableMemo = { value: true, checkedAt: now };
      return true;
    }
  }
  try {
    const call = httpsCallable<Record<string, never>, { available: boolean }>(functions, "personaVoicesStatus");
    const available = (await call({})).data.available === true;
    availableMemo = { value: available, checkedAt: now };
    AsyncStorage.setItem(AVAILABLE_KEY, available ? "true" : "false").catch(() => {});
    return available;
  } catch {
    availableMemo = { value: false, checkedAt: now };
    return false;
  }
}

function markUnavailable(): void {
  availableMemo = { value: false, checkedAt: Date.now() };
  AsyncStorage.setItem(AVAILABLE_KEY, "false").catch(() => {});
}

// A short, stable name for a sentence's cache file. Two independent 32-bit FNV-1a passes -- this
// only has to keep one phone's own few thousand sentences apart, not resist an attacker.
export function speechCacheKey(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export function normalizeSpeechText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cacheFile(personaId: string, text: string): File {
  const root = new Directory(Paths.document, "personaSpeech");
  if (!root.exists) root.create();
  const dir = new Directory(root, personaId);
  if (!dir.exists) dir.create();
  return new File(dir, `${speechCacheKey(text)}.mp3`);
}

const inFlight = new Map<string, Promise<string | null>>();

/**
 * A local audio file of this character saying this sentence, or null if one can't be had
 * (not configured, offline, over the daily limit, or the sentence is too long). Never throws --
 * the caller's fallback is simply the phone's own voice.
 */
export function getPersonaSpeechUri(personaId: string, rawText: string): Promise<string | null> {
  const text = normalizeSpeechText(rawText);
  if (!text || text.length > PERSONA_MAX_TEXT_LENGTH) return Promise.resolve(null);

  let file: File;
  try {
    file = cacheFile(personaId, text);
    if (file.exists && file.size > 0) return Promise.resolve(file.uri);
  } catch {
    return Promise.resolve(null);
  }

  const key = `${personaId}:${text}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async (): Promise<string | null> => {
    try {
      const call = httpsCallable<{ personaId: string; text: string }, SynthesizeResponse>(
        functions,
        "synthesizePersonaSpeech"
      );
      const { data } = await call({ personaId, text });
      if (data.status === "not_configured") markUnavailable();
      if (data.status !== "ok" || !data.audioBase64) return null;
      if (file.exists) file.delete();
      file.create();
      file.write(data.audioBase64, { encoding: "base64" });
      return file.uri;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, request);
  return request;
}

/**
 * Starts fetching sentences that are about to be needed, a few at a time, so they're already on
 * the phone when the turn comes up. Fire-and-forget; anything that fails is simply spoken by the
 * phone's voice at the time.
 */
export function prefetchPersonaSpeech(personaId: string, texts: string[]): void {
  const queue = [...new Set(texts.map(normalizeSpeechText).filter(Boolean))];
  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      await getPersonaSpeechUri(personaId, next);
    }
  };
  void Promise.all([worker(), worker()]);
}
