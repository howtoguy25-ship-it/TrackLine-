import { AudioModule, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from "expo-audio";
import { YamnetSiren, canStreamYamnet, isYamnetAvailable, type StreamWindow } from "@/native/yamnetNative";
import { setMicInUse } from "@/services/audioSession";
import { SirenTracker, type SirenEvent } from "@/services/sirenTracker";
import { File } from "expo-file-system";

const WINDOW_MS = 1000;

export type SirenDetectionListener = (event: { confidence: number; label: string }) => void;
export type SirenEventListener = (event: SirenEvent) => void;

class SirenDetectionEngine {
  private recorder: InstanceType<typeof AudioModule.AudioRecorder> | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private consecutiveHits = 0;
  private listeners = new Set<SirenDetectionListener>();
  private eventListeners = new Set<SirenEventListener>();
  private tracker = new SirenTracker();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private sensitivity = 0.6;
  // True while something else needs the microphone to itself for a moment (voice search). The
  // one-second capture loop keeps ticking but skips its work, so resuming is instant and there's
  // no start-up cost -- and no window is ever recorded while it's set.
  private suspended = false;

  // The app's own voice: windows heard while it's talking are skipped (MapScreen passes
  // navSpeech's isNavSpeaking). A phone call needs no check: iOS gives the call the microphone.
  private ownAudio: () => boolean = () => false;
  setOwnAudioCheck(fn: () => boolean) {
    this.ownAudio = fn;
  }

  setSensitivity(threshold: number) {
    this.sensitivity = threshold;
    this.tracker.threshold = threshold;
  }

  onDetection(listener: SirenDetectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Start / closer-or-away / end of a siren (services/sirenTracker.ts: 3 of 5 windows, 8 s end). */
  onEvent(listener: SirenEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emit(events: SirenEvent[]) {
    for (const ev of events) {
      this.eventListeners.forEach((l) => l(ev));
      if (ev.kind === "start") this.listeners.forEach((l) => l({ confidence: 1, label: ev.type }));
    }
  }

  // The radar starts and stops as you drive (MapScreen): a stop() that lands while start() is
  // still waiting on the permission or the model wins, and two starts never overlap.
  private wanted = false;
  private starting = false;

  async start(): Promise<void> {
    this.wanted = true;
    if (this.running || this.starting) return;
    this.starting = true;
    try {
      await this.startNow();
    } finally {
      this.starting = false;
    }
  }

  private async startNow(): Promise<void> {
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
    if (!this.wanted) return;

    setMicInUse(true);
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });

    // The live stream (half-overlapping windows, nothing written to disk) when this build has it.
    if (canStreamYamnet && (await this.startStreaming())) {
      if (!this.wanted) {
        await this.stopStreaming();
        return;
      }
      this.tickHandle = setInterval(() => {
        this.emit(this.tracker.tick(Date.now()));
        // iOS stops the engine for a phone call or another app; take the microphone back after.
        if (this.streamSub && !this.suspended && YamnetSiren.isStreaming && !YamnetSiren.isStreaming()) YamnetSiren.startStream?.().catch(() => false);
      }, 1000);
      this.running = true;
      return;
    }

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
    // Metering on: each window's loudness drives "Getting closer" / "Moving away".
    // eslint-disable-next-line import/namespace -- AudioRecorder is a native class on expo-audio's AudioModule (typed, checked by tsc); the import plugin can't see native exports
    this.recorder = new AudioModule.AudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
    this.tickHandle = setInterval(() => this.emit(this.tracker.tick(Date.now())), 1000);

    this.running = true;
    this.consecutiveHits = 0;
    this.pollHandle = setInterval(() => {
      this.captureAndClassifyWindow().catch((err) =>
        console.warn("[siren] window classification failed", err)
      );
    }, WINDOW_MS);
  }

  private streamSub: { remove(): void } | null = null;

  private async startStreaming(): Promise<boolean> {
    if (!YamnetSiren.addListener || !YamnetSiren.startStream) return false;
    this.streamSub = YamnetSiren.addListener("onWindow", (w) => this.onStreamWindow(w));
    let ok = false;
    try {
      ok = await YamnetSiren.startStream();
    } catch {
      ok = false;
    }
    if (!ok) {
      this.streamSub.remove();
      this.streamSub = null;
    }
    return ok;
  }

  private async stopStreaming(): Promise<void> {
    this.streamSub?.remove();
    this.streamSub = null;
    try {
      await YamnetSiren.stopStream?.();
    } catch {
      // already stopped
    }
  }

  /** One live window (0.975 s, every 0.48 s): the same tracker rules as a recorded one. */
  onStreamWindow(w: StreamWindow): void {
    if (this.suspended) return;
    if (this.ownAudio()) {
      this.emit(this.tracker.tick(Date.now()));
      return;
    }
    const rmsDb = typeof w.rmsDb === "number" && Number.isFinite(w.rmsDb) && w.rmsDb > -150 ? w.rmsDb : null;
    this.emit(this.tracker.push({ at: Date.now(), scores: Object.fromEntries((w.scores ?? []).map((r) => [r.label, r.confidence])), rmsDb }));
  }

  /** Hands the microphone over: stops any capture in progress and holds off until resume(). */
  async suspend(): Promise<void> {
    this.suspended = true;
    // The live stream gives the microphone back too (wake phrase / voice search need it).
    if (this.streamSub) await YamnetSiren.stopStream?.().catch(() => false);
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
    if (this.streamSub) await YamnetSiren.startStream?.().catch(() => false);
  }

  async stop(): Promise<void> {
    this.wanted = false;
    this.running = false;
    setMicInUse(false);
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    if (this.streamSub) await this.stopStreaming();
    // A siren being heard when the radar stops still ends properly.
    if (this.tracker.isActive) this.emit(this.tracker.tick(Date.now() + 60_000));
    this.tracker.reset();
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
    const ownAudio = this.ownAudio();
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS));
    let rmsDb: number | null = null;
    try {
      const m = recorder.getStatus().metering;
      rmsDb = typeof m === "number" && Number.isFinite(m) ? m : null;
    } catch {
      // No metering on this device: closeness stays "Nearby".
    }
    await recorder.stop();
    const uri = recorder.uri;
    // Suspended part-way through this window: what was captured is discarded unread.
    if (this.suspended || !uri) {
      deleteWindow(uri);
      return;
    }
    // Our own voice was playing: this window says nothing either way (not even classified).
    if (ownAudio || this.ownAudio()) {
      deleteWindow(uri);
      this.emit(this.tracker.tick(Date.now()));
      return;
    }
    let results: Awaited<ReturnType<typeof YamnetSiren.classifyFile>>;
    try {
      results = await YamnetSiren.classifyFile(uri);
    } finally {
      // No audio is kept: each window is deleted as soon as it's classified.
      deleteWindow(uri);
    }
    // services/sirenTracker.ts decides: 3 of the last 5 windows at >= 0.6, type, closeness, end.
    this.emit(this.tracker.push({ at: Date.now(), scores: Object.fromEntries(results.map((r) => [r.label, r.confidence])), rmsDb }));
  }
}

export const sirenDetection = new SirenDetectionEngine();

function deleteWindow(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}
