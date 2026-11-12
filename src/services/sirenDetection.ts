import { AudioModule, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from "expo-audio";
import { YamnetSiren, isYamnetAvailable } from "@/native/yamnetNative";
import { setMicInUse } from "@/services/audioSession";

const WINDOW_MS = 1000;
const CONSECUTIVE_WINDOWS_REQUIRED = 2;
const SIREN_LABELS = new Set(["Siren", "Emergency vehicle", "Police car (siren)", "Ambulance (siren)", "Fire engine, fire truck (siren)"]);

export type SirenDetectionListener = (event: { confidence: number; label: string }) => void;

class SirenDetectionEngine {
  private recorder: InstanceType<typeof AudioModule.AudioRecorder> | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private consecutiveHits = 0;
  private listeners = new Set<SirenDetectionListener>();
  private running = false;
  private sensitivity = 0.6;
  // True while something else needs the microphone to itself for a moment (voice search). The
  // one-second capture loop keeps ticking but skips its work, so resuming is instant and there's
  // no start-up cost -- and no window is ever recorded while it's set.
  private suspended = false;

  setSensitivity(threshold: number) {
    this.sensitivity = threshold;
  }

  onDetection(listener: SirenDetectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.running) return;

    const { status } = await requestRecordingPermissionsAsync();
    if (status !== "granted") {
      console.warn("[siren] Microphone permission denied; EV Radar disabled.");
      return;
    }

    if (!isYamnetAvailable) {
      console.warn(
        "[siren] Skipping start(): no native YamnetSiren module in this build " +
          "(requires an Expo Dev Build, see /modules/yamnet-siren/README.md)."
      );
      return;
    }

    // Real, confirmed bug this fixes: the return value was never checked, so a real model/label
    // load failure (bundled asset missing, a bad TFLite interpreter init, etc.) still fell
    // through into starting the recorder/poll loop -- every window would then classify against a
    // null interpreter (classifyFile's own real guard returns [] for that), silently running
    // "EV Radar: on" for the rest of the session while never actually detecting anything, with no
    // way for the driver to know. Bailing out here instead surfaces that failure the same honest
    // way the permission/no-native-module checks above already do.
    const loaded = await YamnetSiren.loadModel();
    if (!loaded) {
      console.warn("[siren] Model failed to load; EV Radar disabled for this session.");
      return;
    }

    setMicInUse(true);
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });

    // Real, explicit request: "volume glitching" / "voice keeps glitching" during navigation --
    // this is the app's own always-on background microphone loop (siren/EV detection, running
    // for as long as MapScreen is mounted, not just while actively navigating). It used to
    // construct a brand-new AudioModule.AudioRecorder every single WINDOW_MS (1s) tick --
    // allocating a fresh native recorder object and re-preparing it from scratch, every second,
    // for the entire time the app is open. On iOS, that's real, repeated audio-session/hardware
    // churn happening concurrently with expo-speech's own TTS playback (which shares the same
    // system audio session) -- exactly the kind of thing that produces audible clicks/dropouts
    // in whatever else is currently playing through that session, and volume changes (either the
    // in-app slider or the phone's own hardware buttons) trigger their own real audio-route
    // events on top of that already-churning session. One recorder instance, created once here
    // and reused every cycle below (prepare -> record -> stop -> read -> repeat on the SAME
    // object) instead of a fresh one each time, cuts that per-second allocation/session churn
    // down to what's structurally unavoidable for capturing a real, distinct 1s window --
    // functionally identical output, meaningfully less native audio-session thrashing.
    this.recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);

    this.running = true;
    this.consecutiveHits = 0;
    this.pollHandle = setInterval(() => {
      this.captureAndClassifyWindow().catch((err) =>
        console.warn("[siren] window classification failed", err)
      );
    }, WINDOW_MS);
  }

  /** Hands the microphone over: stops any capture in progress and holds off until resume(). */
  async suspend(): Promise<void> {
    this.suspended = true;
    this.consecutiveHits = 0;
    if (this.recorder) {
      try {
        await this.recorder.stop();
      } catch {
        // Not recording at that instant -- nothing to stop.
      }
    }
  }

  /** Takes the microphone back. Safe to call when detection was never running. */
  async resume(): Promise<void> {
    if (!this.suspended) return;
    this.suspended = false;
    if (!this.running) return;
    // Whatever borrowed the microphone may have left the audio session in its own mode; put
    // back the one this loop was started with.
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: true });
    } catch {
      // The next capture window will surface any real problem.
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    setMicInUse(false);
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.recorder) {
      try {
        await this.recorder.stop();
      } catch {
        // already stopped
      }
      this.recorder = null;
    }
    this.consecutiveHits = 0;
  }

  private async captureAndClassifyWindow(): Promise<void> {
    // Capture a short recording, hand the real recorded file straight to the native classifier
    // (which decodes it itself -- see classifyFile's own comment for why: this app never has
    // raw PCM on hand, only a compressed .m4a, on either platform), then discard the audio
    // immediately — nothing is ever written to persistent storage or uploaded, matching the "no
    // recording stored" promise shown in the mic permission prompt. Reuses the single recorder
    // created once in start() -- see its own comment for why a fresh AudioRecorder every single
    // window was real, confirmed audio-glitch territory.
    const recorder = this.recorder;
    if (!recorder || this.suspended) return;
    await recorder.prepareToRecordAsync();
    recorder.record();
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS));
    await recorder.stop();
    // Suspended part-way through this window: what was captured is discarded unread.
    if (this.suspended) return;

    const uri = recorder.uri;
    if (!uri) return;

    const results = await YamnetSiren.classifyFile(uri);

    const sirenResult = results.find((r) => SIREN_LABELS.has(r.label));
    const confidence = sirenResult?.confidence ?? 0;

    if (confidence >= this.sensitivity) {
      this.consecutiveHits += 1;
    } else {
      this.consecutiveHits = 0;
    }

    if (this.consecutiveHits >= CONSECUTIVE_WINDOWS_REQUIRED) {
      this.consecutiveHits = 0;
      this.listeners.forEach((listener) =>
        listener({ confidence, label: sirenResult?.label ?? "Siren" })
      );
    }
  }
}

export const sirenDetection = new SirenDetectionEngine();
