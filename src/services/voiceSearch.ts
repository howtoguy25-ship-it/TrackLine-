import { sirenDetection } from "@/services/sirenDetection";
import type { NavLanguage } from "@/services/navLanguage";

// Voice search for the "Where to?" sheet: tap the microphone, say a place, and the words land
// in the search box. Recognition is the phone's own speech service (iOS Speech / Android's
// speech recognizer) through expo-speech-recognition -- nothing is sent to TrackLine.
//
// Two things here are deliberate:
//
// 1. The native module is loaded lazily, inside a try. A copy of the app built before this
//    library was added doesn't contain it, and importing it at the top of the file would crash
//    that copy on launch instead of just leaving the microphone unavailable.
//
// 2. Siren detection normally holds the microphone the whole time the map is open. It is
//    suspended for the few seconds a search is listening and resumed the moment it ends,
//    however it ends -- two recorders competing for one microphone is how you get neither.

type SpeechModule = typeof import("expo-speech-recognition");

let cachedModule: SpeechModule | null | undefined;
function loadModule(): SpeechModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("expo-speech-recognition") as SpeechModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

const RECOGNITION_LOCALE: Record<NavLanguage, string> = {
  en: "en-AU",
  ar: "ar-SA",
  ru: "ru-RU",
  es: "es-ES",
  tr: "tr-TR",
};

export type VoiceSearchFailure =
  | "unavailable" // this copy of the app, or this phone, has no speech recognition
  | "denied" // microphone or speech-recognition permission refused
  | "noSpeech" // listened, heard nothing it could use
  | "network" // the phone's recognizer needed a connection and had none
  | "failed"; // anything else

export const VOICE_SEARCH_MESSAGES: Record<VoiceSearchFailure, string> = {
  unavailable: "Voice search isn't available on this phone.",
  denied: "Voice search needs microphone and speech recognition access. You can turn them on in your phone's Settings.",
  noSpeech: "Didn't catch that -- tap the microphone and try again.",
  network: "Voice search needs an internet connection right now.",
  failed: "Voice search stopped unexpectedly -- try again.",
};

/** Maps the recognizer's own error codes onto the handful of outcomes the sheet explains. */
export function classifyRecognitionError(code: string | undefined): VoiceSearchFailure {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "no-speech":
    case "speech-timeout":
      return "noSpeech";
    case "network":
      return "network";
    case "language-not-supported":
      return "unavailable";
    default:
      return "failed";
  }
}

export interface VoiceSearchHandlers {
  /** Words so far, while still listening. */
  onPartial: (text: string) => void;
  /** The finished phrase. Called at most once. */
  onFinal: (text: string) => void;
  /** Listening is over, for any reason. Always called exactly once after a successful start. */
  onEnd: () => void;
  onError: (failure: VoiceSearchFailure) => void;
}

export interface VoiceSearchSession {
  /** Stops listening and keeps whatever was heard. */
  stop: () => void;
}

/**
 * Starts listening. Resolves to a session once the microphone is live, or to null if it never
 * got that far -- in which case onError has already been called with why, and onEnd has not.
 */
export async function startVoiceSearch(
  language: NavLanguage,
  handlers: VoiceSearchHandlers
): Promise<VoiceSearchSession | null> {
  const speech = loadModule();
  if (!speech) {
    handlers.onError("unavailable");
    return null;
  }
  const recognizer = speech.ExpoSpeechRecognitionModule;

  try {
    if (!recognizer.isRecognitionAvailable()) {
      handlers.onError("unavailable");
      return null;
    }
    const permission = await recognizer.requestPermissionsAsync();
    if (!permission.granted) {
      handlers.onError("denied");
      return null;
    }
  } catch {
    handlers.onError("failed");
    return null;
  }

  await sirenDetection.suspend();

  let finished = false;
  let deliveredFinal = false;
  let latest = "";
  const subscriptions: { remove: () => void }[] = [];
  const finish = () => {
    if (finished) return;
    finished = true;
    subscriptions.forEach((subscription) => subscription.remove());
    sirenDetection.resume().catch(() => {});
    // Some recognizers end without ever marking a result final; what was heard still counts.
    if (!deliveredFinal && latest) {
      deliveredFinal = true;
      handlers.onFinal(latest);
    }
    handlers.onEnd();
  };

  subscriptions.push(
    recognizer.addListener("result", (event) => {
      const text = event.results[0]?.transcript?.trim() ?? "";
      if (!text) return;
      latest = text;
      if (event.isFinal) {
        if (!deliveredFinal) {
          deliveredFinal = true;
          handlers.onFinal(text);
        }
      } else {
        handlers.onPartial(text);
      }
    }),
    recognizer.addListener("error", (event) => {
      // "aborted" is this app stopping it on purpose, not a failure to report.
      if (event.error !== "aborted" && !latest) handlers.onError(classifyRecognitionError(event.error));
    }),
    recognizer.addListener("end", finish)
  );

  try {
    recognizer.start({
      lang: RECOGNITION_LOCALE[language],
      interimResults: true,
      continuous: false,
      // A place name, not a sentence: no punctuation wanted, and iOS tunes for short queries.
      addsPunctuation: false,
      iosTaskHint: "search",
    });
  } catch {
    handlers.onError("failed");
    finish();
    return null;
  }

  return {
    stop: () => {
      try {
        recognizer.stop();
      } catch {
        finish();
      }
    },
  };
}
