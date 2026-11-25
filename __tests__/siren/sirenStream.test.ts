// The siren radar's live stream (builds with the native stream: a 0.975 s window every 0.48 s,
// half-overlapping, in memory only). The native module is stood in for; the engine must use the
// stream instead of recorded files, apply the same 3-of-5 rule, skip windows while the app talks,
// hand the microphone over for the wake phrase / voice search, and let go on stop.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type Listener = (w: { scores: { label: string; confidence: number }[]; rmsDb: number; at: number }) => void;
const mockState = { listener: null as Listener | null, streaming: false, starts: 0, stops: 0, removed: 0 };

jest.mock("expo-audio", () => ({
  AudioModule: { AudioRecorder: class {} },
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: async () => ({ status: "granted" }),
  getRecordingPermissionsAsync: async () => ({ status: "granted", granted: true }),
  setAudioModeAsync: async () => {},
}));
jest.mock("@/services/audioSession", () => ({ setMicInUse: () => {} }));
jest.mock("expo-file-system", () => ({ File: class {} }));
jest.mock("@/native/yamnetNative", () => ({
  isYamnetAvailable: true,
  canStreamYamnet: true,
  YamnetSiren: {
    loadModel: async () => true,
    classifyFile: async () => {
      throw new Error("files must not be used when the stream is available");
    },
    startStream: async () => {
      mockState.streaming = true;
      mockState.starts++;
      return true;
    },
    stopStream: async () => {
      mockState.streaming = false;
      mockState.stops++;
      return true;
    },
    isStreaming: () => mockState.streaming,
    addListener: (_e: string, l: Listener) => {
      mockState.listener = l;
      return {
        remove: () => {
          mockState.removed++;
          mockState.listener = null;
        },
      };
    },
  },
}));

import { sirenDetection } from "@/services/sirenDetection";

const siren = { scores: [{ label: "Police car (siren)", confidence: 0.85 }, { label: "Siren", confidence: 0.8 }], rmsDb: -30, at: 0 };
const quiet = { scores: [{ label: "Vehicle", confidence: 0.7 }], rmsDb: -40, at: 0 };

describe("siren radar live stream", () => {
  beforeEach(async () => {
    await sirenDetection.stop();
    Object.assign(mockState, { listener: null, streaming: false, starts: 0, stops: 0, removed: 0 });
    sirenDetection.setOwnAudioCheck(() => false);
  });

  it("uses the native stream; 3 of the last 5 half-overlapping windows start it (about 1.5 s of siren)", async () => {
    await sirenDetection.start();
    expect(mockState.starts).toBe(1);
    expect(mockState.listener).not.toBeNull();
    const events: string[] = [];
    const off = sirenDetection.onEvent((e) => events.push(`${e.kind}${e.kind !== "end" ? ":" + e.type : ""}`));
    mockState.listener!(quiet);
    mockState.listener!(siren);
    mockState.listener!(siren);
    expect(events).toEqual([]);
    mockState.listener!(siren);
    expect(events).toEqual(["start:police"]);
    off();
    await sirenDetection.stop();
  });

  it("windows while the app itself is talking don't count", async () => {
    await sirenDetection.start();
    sirenDetection.setOwnAudioCheck(() => true);
    const events: string[] = [];
    const off = sirenDetection.onEvent((e) => events.push(e.kind));
    for (let i = 0; i < 6; i++) mockState.listener!(siren);
    expect(events).toEqual([]);
    off();
    await sirenDetection.stop();
  });

  it("hands the microphone over (wake phrase / voice search) and takes it back", async () => {
    await sirenDetection.start();
    await sirenDetection.suspend();
    expect(mockState.streaming).toBe(false);
    const events: string[] = [];
    const off = sirenDetection.onEvent((e) => events.push(e.kind));
    for (let i = 0; i < 5; i++) mockState.listener!(siren);
    expect(events).toEqual([]);
    await sirenDetection.resume();
    expect(mockState.streaming).toBe(true);
    expect(mockState.starts).toBe(2);
    off();
    await sirenDetection.stop();
  });

  it("stop() stops the stream and removes the listener; a siren being heard ends", async () => {
    await sirenDetection.start();
    const events: string[] = [];
    const off = sirenDetection.onEvent((e) => events.push(e.kind));
    for (let i = 0; i < 3; i++) mockState.listener!(siren);
    await sirenDetection.stop();
    expect(events).toEqual(["start", "end"]);
    expect(mockState.streaming).toBe(false);
    expect(mockState.removed).toBe(1);
    off();
  });
});
