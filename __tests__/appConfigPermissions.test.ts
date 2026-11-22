// Apple rejects an upload whose binary uses the camera, microphone, photos or speech without the
// matching Info.plist text -- the build is accepted by EAS but never appears in TestFlight
// (builds 189-201: expo-image-picker's `cameraPermission: false` deleted NSCameraUsageDescription).
 
import { describe, expect, test } from "@jest/globals";
const config = require("../app.config.js").expo;

const REQUIRED = [
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSLocationWhenInUseUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
  "NSContactsUsageDescription",
];

describe("iOS permission texts Apple requires", () => {
  test.each(REQUIRED)("%s is set", (key) => {
    expect(typeof config.ios.infoPlist[key]).toBe("string");
    expect(config.ios.infoPlist[key].length).toBeGreaterThan(20);
  });
  test("no plugin is told to remove a permission text the app needs", () => {
    for (const p of config.plugins) {
      if (!Array.isArray(p) || typeof p[1] !== "object" || !p[1]) continue;
      for (const k of ["cameraPermission", "microphonePermission", "photosPermission"]) {
        expect([p[0], k, p[1][k]]).not.toEqual([p[0], k, false]);
      }
    }
  });
});
