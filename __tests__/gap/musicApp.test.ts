// Gap item 8 (BLOCKED for the in-app player): the "Audio player" button really opens the driver's
// own music app -- the first one installed -- and says so when none is.
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Linking, Platform } from "react-native";
import { openMusicApp } from "@/services/musicApp";

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("Audio player button", () => {
  it("opens the first installed music app", async () => {
    expect(Platform.OS).toBe("ios");
    jest.spyOn(Linking, "canOpenURL").mockImplementation(async (url: string) => url === "music://");
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    expect(await openMusicApp()).toBe(true);
    expect(open).toHaveBeenCalledWith("music://");
  });

  it("none installed: resolves false (the map shows a message) and opens nothing", async () => {
    jest.spyOn(Linking, "canOpenURL").mockResolvedValue(false);
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    expect(await openMusicApp()).toBe(false);
    expect(open.mock.calls).toEqual([]);
  });
});
