// Gap item 1 (Android): the ongoing navigation notification -- silent channel, sticky, the same
// next turn / ETA / road as the Live Activity, updated in place (one id), removed at the end.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockSchedule = jest.fn((_: unknown) => Promise.resolve("id"));
const mockDismiss = jest.fn((_: unknown) => Promise.resolve());
const mockChannel = jest.fn((_a: unknown, _b: unknown) => Promise.resolve(null));
const mockPerm = { granted: true, canAskAgain: true };
jest.mock("expo-notifications", () => ({
  setNotificationChannelAsync: (a: unknown, b: unknown) => mockChannel(a, b),
  getPermissionsAsync: () => Promise.resolve(mockPerm),
  requestPermissionsAsync: () => Promise.resolve({ granted: false }),
  scheduleNotificationAsync: (x: unknown) => mockSchedule(x),
  dismissNotificationAsync: (x: unknown) => mockDismiss(x),
  AndroidImportance: { LOW: 2 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));
const mockPlatform = { OS: "android" };
jest.mock("react-native", () => ({ Platform: mockPlatform }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Android navigation notification", () => {
  beforeEach(() => {
    jest.resetModules();
    mockSchedule.mockClear();
    mockDismiss.mockClear();
    mockChannel.mockClear();
    mockPlatform.OS = "android";
    mockPerm.granted = true;
  });

  it("content: the next instruction; ETA, distance left and the road (left out when unknown)", () => {
    const { navNotificationContent } = require("@/services/navNotification");
    expect(navNotificationContent("Work", { instruction: "Turn left onto Stacey St", distanceText: "8.4 km", etaText: "12 min", roadName: "Hume Hwy" })).toEqual({
      title: "Turn left onto Stacey St",
      body: "12 min · 8.4 km left · on Hume Hwy",
    });
    expect(navNotificationContent("Work", { instruction: "", distanceText: "", etaText: "", roadName: "" })).toEqual({ title: "Driving to Work", body: "Driving to Work" });
  });

  it("start: a silent low channel, a sticky notification; updates replace it (same id); end removes it", async () => {
    const n = require("@/services/navNotification");
    n.startNavNotification("Work", { instruction: "Head north", distanceText: "9 km", etaText: "14 min", roadName: "" });
    await flush();
    await flush();
    expect(mockChannel).toHaveBeenCalledWith("navigation", expect.objectContaining({ importance: 2, sound: null }));
    expect(mockSchedule).toHaveBeenCalledWith(expect.objectContaining({ identifier: n.NAV_NOTIFICATION_ID, content: expect.objectContaining({ sticky: true, title: "Head north" }), trigger: { channelId: "navigation" } }));
    n.updateNavNotification({ instruction: "Turn right", distanceText: "8 km", etaText: "12 min", roadName: "Stacey St" });
    await flush();
    await flush();
    const ids = mockSchedule.mock.calls.map((c) => (c[0] as { identifier: string }).identifier);
    expect(new Set(ids)).toEqual(new Set([n.NAV_NOTIFICATION_ID]));
    n.endNavNotification();
    expect(mockDismiss).toHaveBeenCalledWith(n.NAV_NOTIFICATION_ID);
    n.updateNavNotification({ instruction: "x", distanceText: "", etaText: "", roadName: "" });
    await flush();
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });

  it("no permission: nothing shown, no error; iOS: nothing at all (the Live Activity does it)", async () => {
    mockPerm.granted = false;
    let n = require("@/services/navNotification");
    n.startNavNotification("Work", { instruction: "Head north", distanceText: "", etaText: "", roadName: "" });
    await flush();
    await flush();
    expect(mockSchedule).not.toHaveBeenCalled();
    jest.resetModules();
    mockChannel.mockClear();
    mockPlatform.OS = "ios";
    mockPerm.granted = true;
    n = require("@/services/navNotification");
    n.startNavNotification("Work", { instruction: "Head north", distanceText: "", etaText: "", roadName: "" });
    await flush();
    expect(mockChannel).not.toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("MapScreen starts, updates and ends it with the Live Activity", () => {
    const src = (require("fs") as typeof import("fs")).readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/startNavNotification\(destination\.name/);
    expect(src).toMatch(/updateNavNotification\(\{/);
    expect(src).toMatch(/endLiveActivity\(\);\n\s*endNavNotification\(\);/);
  });
});
