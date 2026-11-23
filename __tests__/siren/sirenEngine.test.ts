// The siren radar engine (services/sirenDetection.ts) with the microphone and model stood in:
// each window's audio is deleted, windows while our own voice talks are skipped, a voice search
// or "Hey TrackLine" borrowing the mic skips windows, and stop() during start() wins.
import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockDeleted: string[] = [];
let mockScores: { label: string; confidence: number }[] = [];
const mockClassify = jest.fn(async (_uri: string) => mockScores);
let mockPermissionGate: Promise<void> = Promise.resolve();

jest.mock("expo-audio", () => ({
  AudioModule: {
    AudioRecorder: class {
      uri = "file:///tmp/window.m4a";
      async prepareToRecordAsync() {}
      record() {}
      async stop() {}
      getStatus() {
        return { metering: -30 };
      }
    },
  },
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: async () => {
    await mockPermissionGate;
    return { status: "granted" };
  },
  setAudioModeAsync: async () => {},
}));
jest.mock("@/native/yamnetNative", () => ({ isYamnetAvailable: true, YamnetSiren: { loadModel: async () => true, classifyFile: (u: string) => mockClassify(u) } }));
jest.mock("@/services/audioSession", () => ({ setMicInUse: () => {} }));
jest.mock("expo-file-system", () => ({
  File: class {
    mockUri: string;
    exists = true;
    constructor(mockUri: string) {
      this.mockUri = mockUri;
    }
    delete() {
      mockDeleted.push(this.mockUri);
    }
  },
}));

const { sirenDetection } = require("@/services/sirenDetection") as typeof import("@/services/sirenDetection");
type Engine = { captureAndClassifyWindow(): Promise<void>; running: boolean };
const engine = sirenDetection as unknown as Engine;

const siren = [{ label: "Siren", confidence: 0.9 }];

describe("siren radar engine", () => {
  afterAll(async () => {
    await sirenDetection.stop();
    jest.useRealTimers();
  });
  beforeEach(async () => {
    jest.useFakeTimers();
    await sirenDetection.stop();
    mockDeleted.length = 0;
    mockClassify.mockClear();
    mockScores = siren;
    sirenDetection.setOwnAudioCheck(() => false);
    mockPermissionGate = Promise.resolve();
  });

  it("3 siren windows start it; every window's audio is deleted", async () => {
    await sirenDetection.start();
    const events: string[] = [];
    const off = sirenDetection.onEvent((e) => events.push(e.kind));
    for (let i = 0; i < 3; i++) {
      const p = engine.captureAndClassifyWindow();
      await jest.advanceTimersByTimeAsync(1000);
      await p;
    }
    expect(events).toEqual(["start"]);
    // The 1 s poll also runs windows while the clock moves: every window classified was deleted.
    expect(mockDeleted.length).toBeGreaterThanOrEqual(3);
    expect(mockDeleted.length).toBe(mockClassify.mock.calls.length);
    off();
    await sirenDetection.stop();
  });

  it("windows heard while the app itself is talking are skipped (and still deleted, never classified)", async () => {
    await sirenDetection.start();
    sirenDetection.setOwnAudioCheck(() => true);
    const events: string[] = [];
    const off = sirenDetection.onEvent((e) => events.push(e.kind));
    for (let i = 0; i < 5; i++) {
      const p = engine.captureAndClassifyWindow();
      await jest.advanceTimersByTimeAsync(1000);
      await p;
    }
    expect(events).toEqual([]);
    expect(mockClassify).not.toHaveBeenCalled();
    expect(mockDeleted.length).toBeGreaterThanOrEqual(5);
    off();
    await sirenDetection.stop();
  });

  it("mic sharing: while the wake phrase / voice search has the mic, nothing is recorded or classified", async () => {
    await sirenDetection.start();
    await sirenDetection.suspend();
    await engine.captureAndClassifyWindow();
    expect(mockClassify).not.toHaveBeenCalled();
    await sirenDetection.resume();
    const p = engine.captureAndClassifyWindow();
    await jest.advanceTimersByTimeAsync(1000);
    await p;
    expect(mockClassify).toHaveBeenCalledTimes(1);
    await sirenDetection.stop();
  });

  it("stop() while start() is still waiting on the permission wins", async () => {
    let release!: () => void;
    mockPermissionGate = new Promise<void>((r) => (release = r));
    const starting = sirenDetection.start();
    await sirenDetection.stop();
    release();
    await starting;
    expect(engine.running).toBe(false);
  });

  it("stopping while a siren is heard ends it (so the question can be asked)", async () => {
    await sirenDetection.start();
    const events: string[] = [];
    const off = sirenDetection.onEvent((e) => events.push(e.kind));
    for (let i = 0; i < 3; i++) {
      const p = engine.captureAndClassifyWindow();
      await jest.advanceTimersByTimeAsync(1000);
      await p;
    }
    await sirenDetection.stop();
    expect(events).toEqual(["start", "end"]);
    off();
  });
});
