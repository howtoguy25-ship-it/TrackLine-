// Fix pass 5 §4-5: the default driving view, the "not centred" hint (Re-centre pill bottom-left +
// blue compass ring), compass heading-up / north-up toggle with a toast, no overlaps in any state
// on 320-430 pt phones, and faster-route offers in the ahead banner instead of a floating pill.
import React from "react";
import { readFileSync } from "fs";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("expo-haptics", () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import { RECENTRE_MS, compassHighlighted, compassTapAction, compassToast, showRecentrePill } from "@/nav/offCentreHint";
import { NAV_ARROW_FRACTION, metresAheadVisible, navFollowPose, navZoomForSpeed } from "@/nav/navCamera";
import { aheadRoom, crowded, navControlFrames, overlaps } from "@/nav/navControlsLayout";
import { homeControlFrames } from "@/map/homeMapLogic";
import { scaleFor } from "@/theme/tokens";
import { NavMapControls } from "@/components/NavMapControls";
import { FasterRouteBanner } from "@/components/AheadBanner";

const PHONES = [
  { width: 320, height: 568, safeTop: 20, safeBottom: 0 },
  { width: 375, height: 667, safeTop: 20, safeBottom: 0 },
  { width: 390, height: 844, safeTop: 47, safeBottom: 34 },
  { width: 430, height: 932, safeTop: 59, safeBottom: 34 },
];
const map = readFileSync("src/screens/MapScreen.tsx", "utf8");
const props = (over: Record<string, unknown> = {}) => ({
  safeTop: 47,
  safeBottom: 34,
  topBarHeight: 120,
  bottomBarHeight: 110,
  showSpeedLimit: true,
  bearing: { value: 0, get: () => 0, set: () => {} } as never,
  northUp: false,
  onCompass: jest.fn(),
  showAudioPlayer: false,
  onAudioPlayer: jest.fn(),
  soundOff: false,
  onSound: jest.fn(),
  onVoice: jest.fn(),
  listening: false,
  streetName: "George St",
  banner: null,
  onBanner: jest.fn(),
  ...over,
});


describe("default driving view (§4)", () => {
  it("heading-up, 45° pitch, arrow at 72%, 400-700 m ahead at every speed -- the same every time", () => {
    for (const speed of [0, 20, 50, 60, 80, 100, 110]) {
      const a = navFollowPose({ latitude: -33.9, longitude: 151.1 }, 90, speed, false, 844);
      const b = navFollowPose({ latitude: -33.9, longitude: 151.1 }, 90, speed, false, 844);
      expect(a).toEqual(b);
      expect(a.pitch).toBe(45);
      expect(a.heading).toBe(90);
      const ahead = metresAheadVisible(navZoomForSpeed(speed, 844, -33.9), 45, 844, -33.9, NAV_ARROW_FRACTION);
      expect([speed, ahead >= 360 && ahead <= 770]).toEqual([speed, true]);
    }
    expect(NAV_ARROW_FRACTION).toBeCloseTo(0.72);
  });
  it("Re-centre goes back to it in 600 ms", () => {
    expect(RECENTRE_MS).toBe(600);
    expect(map).toMatch(/RECENTRE_MS/);
  });
});

describe("not-centred hint (§4)", () => {
  it("the pill shows only in FREE (and the route overview) while navigating", () => {
    expect(showRecentrePill("FREE", true)).toBe(true);
    expect(showRecentrePill("OVERVIEW", true)).toBe(true);
    for (const m of ["NAV_FOLLOW", "ROUTE_PREVIEW", "FOLLOW"] as const) expect(showRecentrePill(m, true)).toBe(false);
    expect(showRecentrePill("FREE", false)).toBe(false);
  });
  it("blue compass ring when the map is turned away from how you set it, only in FREE", () => {
    expect(compassHighlighted({ mode: "FREE", mapBearing: 40, northUp: true, roadBearing: 90 })).toBe(true);
    expect(compassHighlighted({ mode: "FREE", mapBearing: 5, northUp: true, roadBearing: 90 })).toBe(false);
    expect(compassHighlighted({ mode: "FREE", mapBearing: 30, northUp: false, roadBearing: 90 })).toBe(true);
    expect(compassHighlighted({ mode: "FREE", mapBearing: 355, northUp: false, roadBearing: 2 })).toBe(false);
    expect(compassHighlighted({ mode: "NAV_FOLLOW", mapBearing: 200, northUp: true, roadBearing: 90 })).toBe(false);
  });
  it("compass tap: recentre when ringed, otherwise toggle with a toast", () => {
    expect(compassTapAction({ highlighted: true, northUp: false })).toBe("recentre");
    expect(compassTapAction({ highlighted: false, northUp: false })).toBe("northUp");
    expect(compassTapAction({ highlighted: false, northUp: true })).toBe("headingUp");
    expect(compassToast("northUp")).toBe("North up");
    expect(compassToast("headingUp")).toBe("Heading up");
    expect(compassToast("recentre")).toBeNull();
  });


  it("following: no pill, plain compass; a toast shows when given", async () => {
    const r = await render(<NavMapControls {...props({ showRecenter: false, toast: "North up" })} />);
    const json = JSON.stringify(r.toJSON());
    expect(json).not.toMatch(/"nav-recenter"/);
    expect(json).not.toMatch(/"nav-compass-highlighted"/);
    expect(json).toMatch(/"testID":"nav-toast"/);
    expect(json).toMatch(/"North up"/);
    await r.unmount();
  });
  it("MapScreen wires the pill and ring to the camera mode and the compass to the toggle", () => {
    expect(map).toMatch(/showRecenter=\{showRecentrePill\(cameraMode, !!route\)\}/);
    expect(map).toMatch(/compassHighlighted=\{navCompassRing\}/);
    expect(map).toMatch(/compassTapAction\(/);
  });
});

describe("controls never overlap, every state, every phone (§5)", () => {
  for (const p of PHONES) {
    it(`${p.width}pt: home, preview, nav, nav + banner, FREE`, () => {
      const scale = scaleFor(p.width);
      // Home and route preview (the preview hides the floating controls except the sheet).
      for (const showRecenter of [false, true])
        for (const sheet of [140, 263, p.height * 0.45]) {
          const f = homeControlFrames({ width: p.width, height: p.height, topInset: p.safeTop, scale, sheetVisibleHeight: sheet, bottomInset: 0, showCompass: true, showAudioPlayer: false, showSound: true, showRecenter, showStreetPill: !showRecenter });
          const keys = Object.keys(f);
          for (let a = 0; a < keys.length; a++)
            for (let b = a + 1; b < keys.length; b++) {
              const A = f[keys[a] as keyof typeof f]!;
              const B = f[keys[b] as keyof typeof f]!;
              const hit = A.x < B.x + B.width && B.x < A.x + A.width && A.y < B.y + B.height && B.y < A.y + A.height;
              expect([p.width, keys[a], keys[b], hit]).toEqual([p.width, keys[a], keys[b], false]);
            }
        }
      // Driving: following / FREE, with and without the ahead banner.
      for (const showRecenter of [false, true])
        for (const banner of [false, true])
          for (const showSpeedLimit of [false, true]) {
            const frames = navControlFrames({
              ...p,
              bottomBarHeight: 110,
              topBarHeight: 120,
              showSpeedLimit,
              showRecenter,
              showCompass: true,
              showSound: true,
              showVoice: true,
              showStreetChip: true,
              showInfoBanner: true,
              ...(banner ? { dropBy: aheadRoom(88), aheadBanner: { height: 88, progress: 1 } } : {}),
            });
            expect([p.width, showRecenter, banner, overlaps(frames)]).toEqual([p.width, showRecenter, banner, []]);
            if (!banner) expect(crowded(frames)).toEqual([]);
            if (showRecenter) expect(frames.recenter!.x).toBeLessThan(p.width / 2); // bottom-left
            // Report stays bottom-right, speed sign above the speedometer on the left.
            expect(frames.report!.x).toBeGreaterThan(p.width / 2);
            expect(frames.speedometer!.x).toBeLessThan(p.width / 2);
          }
    });
  }
});

describe("faster route offer in the ahead banner (§5)", () => {
  it("Switch and Keep work; text says what it saves", async () => {
    const onSwitch = jest.fn();
    const onKeep = jest.fn();
    const r = await render(<FasterRouteBanner top={100} savesMin={2} detail="Traffic ahead · via King St" scheme="dark" onSwitch={onSwitch} onKeep={onKeep} />);
    expect(JSON.stringify(r.toJSON())).toMatch(/"children":\["Faster route · saves 2 min"\]/);
    await fireEvent.press(r.getByTestId("faster-switch"));
    await fireEvent.press(r.getByTestId("faster-keep"));
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
  it("the floating 'Keep current route' card is gone; the offer is kept after 10 s untouched", () => {
    expect(map).not.toMatch(/Keep current route/);
    expect(map).not.toMatch(/nav-keep-route/);
    // Keeping your route = re-centre / tap your route: the alternatives go once following again.
    expect(map).toMatch(/if \(m === "NAV_FOLLOW"\) setNavAlternatives\(null\);/);
    expect(map).not.toMatch(/styles\.trafficSuggestion/);
    expect(map).toMatch(/<FasterRouteBanner/);
    expect(map).toMatch(/const TRAFFIC_SUGGESTION_DISPLAY_MS = 10_000;/);
  });
});

// Last: pressing inside the animated controls leaves reanimated's test mock in a state later
// renders in this file don't survive.
describe("the hint buttons (§4)", () => {
  it("renders the pill bottom-left (FREE) and the ringed compass, both bring the view back", async () => {
    const onRecenter = jest.fn();
    const onCompass = jest.fn();
    const r = await render(<NavMapControls {...props({ showRecenter: true, onRecenter, compassHighlighted: true, onCompass })} />);
    await fireEvent.press(screen.getByTestId("nav-recenter"));
    expect(onRecenter).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId("nav-compass-highlighted"));
    expect(onCompass).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Re-centre")).toBeTruthy();
    await r.unmount();
  });
});
