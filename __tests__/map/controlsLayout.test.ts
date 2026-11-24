// Permanent fix §5: controls never overlap. Home map: Re-centre (only in FREE) sits ABOVE the
// yellow Report with a 12pt gap in the bottom-right column; Menu/Compass top-left, Audio/Sound
// top-right. Driving: speed sign above the speedometer bottom-left, the Re-centre pill under them
// (bottom-left, only in FREE), Report bottom-right, mic and sound top-right, and the ahead banner never on top of any of them.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { homeControlFrames, type HomeFrame } from "@/map/homeMapLogic";
import { aheadRoom, navControlFrames, overlaps } from "@/nav/navControlsLayout";
import { scaleFor } from "@/theme/tokens";

const PHONES = [
  { width: 320, height: 568, safeTop: 20, safeBottom: 0 },
  { width: 375, height: 667, safeTop: 20, safeBottom: 0 },
  { width: 390, height: 844, safeTop: 47, safeBottom: 34 },
  { width: 430, height: 932, safeTop: 59, safeBottom: 34 },
];

const intersect = (a: HomeFrame, b: HomeFrame) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
function homeOverlaps(frames: Partial<Record<string, HomeFrame>>): string[] {
  const keys = Object.keys(frames);
  const out: string[] = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (intersect(frames[keys[i]]!, frames[keys[j]]!)) out.push(`${keys[i]}×${keys[j]}`);
  return out;
}
const bools = [false, true];

describe("home map controls (§5)", () => {
  it.each(PHONES.map((p) => [p.width, p] as const))("%ipt: no two controls intersect in any state", (_w, p) => {
    const scale = scaleFor(p.width);
    for (const showRecenter of bools)
      for (const showCompass of bools)
        for (const showAudioPlayer of bools)
          for (const showSound of bools)
            for (const sheet of [140, 220, p.height * 0.45]) {
              const frames = homeControlFrames({
                width: p.width,
                height: p.height,
                topInset: p.safeTop,
                scale,
                sheetVisibleHeight: sheet,
                bottomInset: 0,
                showCompass,
                showAudioPlayer,
                showSound,
                showRecenter,
                // The street pill is hidden while Re-centre shows (MapScreen: !pannedAwayIdle).
                showStreetPill: !showRecenter,
              });
              expect([p.width, showRecenter, sheet, homeOverlaps(frames)]).toEqual([p.width, showRecenter, sheet, []]);
              for (const [k, f] of Object.entries(frames)) expect([k, f!.x >= 0 && f!.x + f!.width <= p.width && f!.y >= 0]).toEqual([k, true]);
            }
  });

  it("Re-centre is directly above Report, same column, 12pt gap", () => {
    for (const p of PHONES) {
      const scale = scaleFor(p.width);
      const f = homeControlFrames({ width: p.width, height: p.height, topInset: p.safeTop, scale, sheetVisibleHeight: 180, bottomInset: 0, showCompass: true, showAudioPlayer: true, showSound: true, showRecenter: true, showStreetPill: false });
      expect(f.recenter!.x).toBeCloseTo(f.report!.x);
      expect(f.report!.y - (f.recenter!.y + f.recenter!.height)).toBeCloseTo(12 * scale);
    }
  });

  it("HomeMapControls renders Re-centre bottom-right above Report, and only shows it in FREE", () => {
    const src = readFileSync("src/components/HomeMapControls.tsx", "utf8");
    expect(src).toMatch(/style=\{\[styles\.anchored, \{ right: size\.side \}, recenterStyle\]\}/);
    expect(src).toMatch(/bottom: sheetVisibleHeight\.value \+ bottomInset \+ FLOATING_GAP \+ size\.round \+ size\.column/);
    expect(src).not.toMatch(/\{ left: size\.side \}, aboveSheetStyle, recenterStyle/);
    const map = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(map).toMatch(/const pannedAwayIdle = !route && cameraMode === "FREE";/);
    expect(map).toMatch(/showRecenter=\{pannedAwayIdle\}/);
  });
});

describe("driving controls with the ahead banner (§5)", () => {
  it.each(PHONES.map((p) => [p.width, p] as const))("%ipt: no frames intersect with the banner showing, Re-centre on or off", (_w, p) => {
    for (const showRecenter of bools)
      for (const showSpeedLimit of bools) {
        const frames = navControlFrames({
          ...p,
          bottomBarHeight: 110,
          topBarHeight: 120,
          showSpeedLimit,
          showRecenter,
          showCompass: true,
          showSound: true,
          showVoice: true,
          showInfoBanner: true,
          dropBy: aheadRoom(88),
          aheadBanner: { height: 88, progress: 1 },
        });
        expect([p.width, showRecenter, showSpeedLimit, overlaps(frames)]).toEqual([p.width, showRecenter, showSpeedLimit, []]);
        // Speed sign above the speedometer (bottom-left); Re-centre pill bottom-left under the
        // speedometer (fix pass 5 §4); Report bottom-right; mic + sound top-right.
        if (showSpeedLimit && frames.speedLimit!.x <= frames.speedometer!.x + 1) expect(frames.speedLimit!.y + frames.speedLimit!.height).toBeLessThanOrEqual(frames.speedometer!.y);
        if (showRecenter) {
          // Fix pass 7 §4: right column, right above Report (12pt gap), never near the speedometer.
          expect(frames.recenter!.x).toBe(frames.report!.x);
          expect(frames.recenter!.y + frames.recenter!.height + 12).toBeCloseTo(frames.report!.y);
          expect(frames.recenter!.x).toBeGreaterThan(frames.speedometer!.x + frames.speedometer!.width);
        }
        // Mic and sound top-right. (On a 320 x 568 phone there's no room under a dropped banner:
        // they step aside for the few seconds it shows -- never on top of anything.)
        if (p.width >= 375) {
          expect(frames.sound!.x).toBeGreaterThan(p.width / 2);
          expect(frames.voice!.x).toBeGreaterThan(p.width / 2);
        }
      }
  });
});
