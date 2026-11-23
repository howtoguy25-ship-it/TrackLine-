// "Hey TrackLine" (Settings > Voice > "Hey TrackLine", off by default): while the app is open on
// the map, the phone's own recogniser listens on the device (no audio leaves the phone) for the
// phrase, then for what follows -- a report ("crash ahead"), "navigate home" / "drive to work",
// "mute" / "unmute", "what's my ETA", "stop navigation". Stops when the app leaves the screen or
// goes to the background. The siren radar shares the microphone, so it pauses while this listens.
// Pure parts tested in __tests__/gap/wakePhrase.test.ts.
import { parseVoiceReport, type VoiceReport } from "@/nav/voiceReport";
import { parseNavVoiceCommand } from "@/nav/voiceCommand";
import { sirenDetection } from "@/services/sirenDetection";
import { isVoiceSearchActive } from "@/services/voiceSearch";

const WAKE = /\b(hey|hi|ok|okay)[,\s]+track ?line\b[,.!\s]*/i;

/** The words after "Hey TrackLine" ("" when the phrase was said alone), or null if not said. */
export function afterWakePhrase(transcript: string): string | null {
  const m = WAKE.exec(transcript);
  if (!m) return null;
  return transcript.slice(m.index + m[0].length).trim();
}

export type WakeIntent =
  | { kind: "report"; report: VoiceReport }
  | { kind: "drive"; to: "home" | "work" }
  | { kind: "mute" }
  | { kind: "unmute" }
  | { kind: "eta" }
  | { kind: "stop" }
  | { kind: "unknown"; text: string };

export function wakeIntent(text: string): WakeIntent {
  const t = text.trim();
  const drive = /\b(navigate|take me|drive|go|directions|head)\b.*\b(home|work|the office)\b/i.exec(t);
  if (drive) return { kind: "drive", to: /home/i.test(drive[2]) ? "home" : "work" };
  if (/\b(eta|arrival time|when (will|do|am) i (get|arrive|be there)|how long (left|to go|till|until))\b/i.test(t)) return { kind: "eta" };
  const report = parseVoiceReport(t);
  if (report) return { kind: "report", report };
  const cmd = parseNavVoiceCommand(t);
  if (cmd === "mute" || cmd === "unmute" || cmd === "stop") return { kind: cmd };
  return { kind: "unknown", text: t };
}

type SpeechModule = typeof import("expo-speech-recognition");
function loadSpeech(): SpeechModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-speech-recognition") as SpeechModule;
  } catch {
    return null;
  }
}

export type WakeStatus = "listening" | "unavailable" | "denied" | "stopped";

/**
 * Listens until stop(). Each time "Hey TrackLine ..." is heard (the command in the same breath,
 * or within the next few seconds), onIntent gets what was asked. The recogniser is restarted when
 * the phone ends a session; nothing is kept or sent.
 */
export async function startWakeListener(
  locale: string,
  onIntent: (intent: WakeIntent) => void,
  onStatus: (s: WakeStatus) => void
): Promise<() => void> {
  const speech = loadSpeech();
  const rec = speech?.ExpoSpeechRecognitionModule;
  if (!rec || !rec.isRecognitionAvailable() || !rec.supportsOnDeviceRecognition()) {
    onStatus("unavailable");
    return () => {};
  }
  const perm = await rec.requestPermissionsAsync().catch(() => ({ granted: false }));
  if (!perm.granted) {
    onStatus("denied");
    return () => {};
  }
  let stopped = false;
  let awaitingUntil = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  await sirenDetection.suspend().catch(() => {});
  const start = () => {
    if (stopped) return;
    // A voice search has the recogniser: try again once it's done.
    if (isVoiceSearchActive()) {
      restartTimer = setTimeout(start, 2000);
      return;
    }
    // A finished voice search resumes the siren radar; this one needs the microphone again.
    sirenDetection.suspend().catch(() => {});
    try {
      rec.start({ lang: locale, interimResults: false, continuous: true, requiresOnDeviceRecognition: true, addsPunctuation: false, contextualStrings: ["TrackLine", "Hey TrackLine"] });
      onStatus("listening");
    } catch {
      restartTimer = setTimeout(start, 2000);
    }
  };
  const subs = [
    rec.addListener("result", (e) => {
      if (isVoiceSearchActive()) return;
      const text = e.results?.[0]?.transcript ?? "";
      if (!text) return;
      const after = afterWakePhrase(text);
      if (after !== null) {
        if (after) {
          awaitingUntil = 0;
          onIntent(wakeIntent(after));
        } else awaitingUntil = Date.now() + 5000;
      } else if (awaitingUntil > Date.now()) {
        awaitingUntil = 0;
        onIntent(wakeIntent(text));
      }
    }),
    rec.addListener("end", () => {
      if (!stopped) restartTimer = setTimeout(start, 500);
    }),
  ];
  start();
  return () => {
    stopped = true;
    if (restartTimer) clearTimeout(restartTimer);
    for (const s of subs) s.remove();
    try {
      rec.abort();
    } catch {
      // already stopped
    }
    onStatus("stopped");
    sirenDetection.resume().catch(() => {});
  };
}
