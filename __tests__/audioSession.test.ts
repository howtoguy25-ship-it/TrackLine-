// iOS: navigation sound plays with the phone on silent and the screen locked, without ever
// turning off the siren listener's microphone (expo-audio replaces the whole session each call).
import { describe, expect, it, jest } from "@jest/globals";

const mockSetAudioMode = jest.fn(async (_mode: unknown) => {});
jest.mock("expo-audio", () => ({ setAudioModeAsync: (m: unknown) => mockSetAudioMode(m) }));

const session = require("@/services/audioSession") as typeof import("@/services/audioSession");

describe("navigation audio session", () => {
  it("plays on silent and in the background; keeps the mic only while the siren listener has it", async () => {
    session.setMicInUse(false);
    await session.prepareNavigationAudio();
    expect(mockSetAudioMode).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true });
    session.setMicInUse(true);
    await session.prepareNavigationAudio();
    expect(mockSetAudioMode).toHaveBeenLastCalledWith({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: true });
  });

  it("never throws if the session can't be set", async () => {
    mockSetAudioMode.mockImplementationOnce(async () => {
      throw new Error("session busy");
    });
    await expect(session.prepareNavigationAudio()).resolves.toBeUndefined();
  });
});
