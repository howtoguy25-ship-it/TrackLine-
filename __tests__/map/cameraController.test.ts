// Permanent fix §2: the user's zoom is respected. Any gesture -> FREE, and in FREE nothing moves
// the camera automatically (follow, fit, overview, timers); only Recentre / start / end bring it back.
import { describe, expect, it, jest } from "@jest/globals";
import { AUTO_RECENTRE_IDLE_MS, CameraController, allowed, shouldAutoRecentre, type CameraMode, type MoveSource } from "@/map-v2/cameraController";

function setup() {
  const target = { animateCamera: jest.fn(), animateToRegion: jest.fn(), fitToCoordinates: jest.fn() };
  return { target, cam: new CameraController(() => target) };
}
const here = { latitude: -33.9, longitude: 151 };

describe("camera controller", () => {
  it("pinch-out on the home map: FREE, and the follow updates for the next 60 s move nothing", () => {
    const { cam, target } = setup();
    expect(cam.move("follow", { center: here }, { duration: 500 })).toBe(true);
    target.animateCamera.mockClear();
    cam.gesture(0);
    expect(cam.state).toBe("FREE");
    for (let t = 1000; t <= 60_000; t += 1000) cam.move("follow", { center: here, zoom: 16 });
    expect(target.animateCamera).not.toHaveBeenCalled();
  });

  it("Recentre restores follow (home) / nav follow (driving)", () => {
    const { cam, target } = setup();
    cam.gesture();
    expect(cam.recentre()).toBe("FOLLOW");
    expect(cam.move("follow", { center: here })).toBe(true);
    cam.setMode("NAV_FOLLOW", true);
    cam.gesture();
    expect(cam.move("navFollow", { zoom: 17 })).toBe(false);
    expect(cam.recentre()).toBe("NAV_FOLLOW");
    expect(cam.move("navFollow", { zoom: 17 })).toBe(true);
    expect(target.animateCamera).toHaveBeenCalledTimes(2);
  });

  it("each kind of move only in its own state", () => {
    const table: [CameraMode, MoveSource, boolean][] = [
      ["FOLLOW", "follow", true],
      ["FREE", "follow", false],
      ["ROUTE_PREVIEW", "follow", false],
      ["ROUTE_PREVIEW", "previewFit", true],
      ["FREE", "previewFit", false],
      ["NAV_FOLLOW", "navFollow", true],
      ["FREE", "navFollow", false],
      ["OVERVIEW", "navFollow", false],
      ["OVERVIEW", "overview", true],
      ["FREE", "overview", false],
      ["FREE", "focus", true],
      ["FREE", "recentre", true],
    ];
    for (const [m, s, ok] of table) expect([m, s, allowed(m, s)]).toEqual([m, s, ok]);
  });

  it("looking at something you tapped leaves the camera there (FREE), not yanked back by follow", () => {
    const { cam, target } = setup();
    expect(cam.move("focus", { center: { latitude: -33.8, longitude: 151.1 } })).toBe(true);
    expect(cam.state).toBe("FREE");
    expect(cam.move("follow", { center: here })).toBe(false);
    expect(target.animateCamera).toHaveBeenCalledTimes(1);
  });

  it("route preview: location updates never move it; only the fit does", () => {
    const { cam, target } = setup();
    cam.setMode("ROUTE_PREVIEW");
    expect(cam.move("follow", { center: here })).toBe(false);
    expect(cam.fit("previewFit", [here, { latitude: -33.8, longitude: 151.1 }])).toBe(true);
    expect(target.fitToCoordinates).toHaveBeenCalledTimes(1);
  });

  it("auto-recentre: only navigating, setting on, moving > 10 km/h, after 15 s untouched; never on the home map", () => {
    const base = { mode: "FREE" as CameraMode, navigating: true, settingOn: true, speedKmh: 40, idleMs: AUTO_RECENTRE_IDLE_MS };
    expect(shouldAutoRecentre(base)).toBe(true);
    expect(shouldAutoRecentre({ ...base, idleMs: AUTO_RECENTRE_IDLE_MS - 1 })).toBe(false);
    expect(shouldAutoRecentre({ ...base, speedKmh: 10 })).toBe(false);
    expect(shouldAutoRecentre({ ...base, settingOn: false })).toBe(false);
    expect(shouldAutoRecentre({ ...base, navigating: false })).toBe(false);
    expect(shouldAutoRecentre({ ...base, mode: "NAV_FOLLOW" })).toBe(false);
  });

  it("tells listeners when the state changes", () => {
    const { cam } = setup();
    const seen: CameraMode[] = [];
    cam.onChange((m) => seen.push(m));
    cam.gesture();
    cam.gesture();
    cam.recentre();
    expect(seen).toEqual(["FREE", "FOLLOW"]);
  });
});
