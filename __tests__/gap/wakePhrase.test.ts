// Gap item 4: "Hey TrackLine" -- what follows the phrase, what it asks for, and that it is opt-in,
// on-device, foreground-only, and out of the way of the mic button and voice search.
import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";

// A stand-in for the phone's recogniser: records start/abort and lets the test fire results.
const mockRec = {
  started: [] as Record<string, unknown>[],
  aborted: 0,
  listeners: {} as Record<string, ((e: unknown) => void)[]>,
  isRecognitionAvailable: () => true,
  supportsOnDeviceRecognition: () => true,
  requestPermissionsAsync: async () => ({ granted: true }),
  start(opts: Record<string, unknown>) {
    this.started.push(opts);
  },
  abort() {
    this.aborted += 1;
  },
  addListener(name: string, fn: (e: unknown) => void) {
    (this.listeners[name] ??= []).push(fn);
    return { remove: () => (this.listeners[name] = this.listeners[name].filter((f) => f !== fn)) };
  },
  emit(name: string, e: unknown) {
    for (const f of this.listeners[name] ?? []) f(e);
  },
};
jest.mock("expo-speech-recognition", () => ({ ExpoSpeechRecognitionModule: mockRec }));
const mockSiren = { suspended: 0, resumed: 0 };
jest.mock("@/services/sirenDetection", () => ({
  sirenDetection: {
    suspend: async () => void (mockSiren.suspended += 1),
    resume: async () => void (mockSiren.resumed += 1),
  },
}));
let mockSearching = false;
jest.mock("@/services/voiceSearch", () => ({ isVoiceSearchActive: () => mockSearching }));

import { afterWakePhrase, startWakeListener, wakeIntent, type WakeIntent } from "@/services/wakePhrase";
import { DEFAULT_SETTINGS } from "@/services/settings";

describe("wake phrase", () => {
  it("finds the phrase and what comes after it", () => {
    expect(afterWakePhrase("Hey TrackLine, crash ahead")).toBe("crash ahead");
    expect(afterWakePhrase("hey track line navigate home")).toBe("navigate home");
    expect(afterWakePhrase("OK TrackLine")).toBe("");
    expect(afterWakePhrase("crash ahead")).toBeNull();
    expect(afterWakePhrase("the trackline app is good")).toBeNull();
  });

  it.each([
    ["crash ahead", "report"],
    ["police on the left", "report"],
    ["navigate home", "drive"],
    ["take me to work", "drive"],
    ["mute", "mute"],
    ["unmute", "unmute"],
    ["what's my ETA", "eta"],
    ["when will I arrive", "eta"],
    ["stop navigation", "stop"],
    ["sing a song", "unknown"],
  ])("%s -> %s", (said, kind) => {
    expect(wakeIntent(said).kind).toBe(kind);
  });

  it("drive to home vs work", () => {
    expect(wakeIntent("navigate home")).toEqual({ kind: "drive", to: "home" });
    expect(wakeIntent("drive to the office")).toEqual({ kind: "drive", to: "work" });
  });

  it("off by default", () => {
    expect(DEFAULT_SETTINGS.wakePhrase).toBe(false);
  });

  it("listener: on-device, acts on the phrase, waits 5 s for a command, restarts, steps aside for voice search, cleans up", async () => {
    jest.useFakeTimers();
    const got: WakeIntent[] = [];
    const status: string[] = [];
    const stop = await startWakeListener("en-AU", (i) => got.push(i), (s) => status.push(s));
    expect(mockRec.started).toHaveLength(1);
    expect(mockRec.started[0]).toMatchObject({ lang: "en-AU", continuous: true, requiresOnDeviceRecognition: true });
    expect(status).toEqual(["listening"]);
    expect(mockSiren.suspended).toBeGreaterThan(0);

    const said = (t: string) => mockRec.emit("result", { results: [{ transcript: t }] });
    said("just talking about the weather");
    expect(got).toHaveLength(0);
    said("Hey TrackLine, crash ahead");
    expect(got[0]).toMatchObject({ kind: "report" });
    said("Hey TrackLine");
    said("navigate home");
    expect(got[1]).toEqual({ kind: "drive", to: "home" });
    // The phrase alone, then nothing for over 5 s: the next words are not a command.
    said("Hey TrackLine");
    jest.setSystemTime(Date.now() + 6000);
    said("mute");
    expect(got).toHaveLength(2);

    // A voice search has the microphone: results are ignored and restarts wait.
    mockSearching = true;
    said("Hey TrackLine, mute");
    expect(got).toHaveLength(2);
    mockRec.emit("end", {});
    jest.advanceTimersByTime(500);
    expect(mockRec.started).toHaveLength(1);
    mockSearching = false;
    jest.advanceTimersByTime(2000);
    expect(mockRec.started).toHaveLength(2);

    stop();
    expect(mockRec.aborted).toBe(1);
    expect(status.at(-1)).toBe("stopped");
    expect(Object.values(mockRec.listeners).every((l) => l.length === 0)).toBe(true);
    await Promise.resolve();
    expect(mockSiren.resumed).toBe(1);
    // Nothing restarts after stop, and no timers are left.
    mockRec.emit("end", {});
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it("MapScreen: only with the setting on, the app in front, this screen open and the mic button idle", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/const wakeOn = settings\.wakePhrase && appActive && isFocused && !navListening;/);
    const settings = readFileSync("src/screens/SettingsScreen.tsx", "utf8");
    expect(settings).toMatch(/testID: "wake-phrase-switch"/);
  });
});
