// Fix pass 7 §5 (found in the proof render): the exit-gate card was placed only above the bottom
// controls, so on an 844 pt phone its bottom edge (y 592) clipped the top of the driving arrow
// (586-630). It now sits above the arrow too, and still clears every control.
import { readFileSync } from "fs";
import { describe, expect, it } from "@jest/globals";
import { ARROW_HALF, EXIT_CARD_HEIGHT, EXIT_CARD_SIDE, exitCardPlacement, intersects, navControlFrames, type Frame } from "@/nav/navControlsLayout";
import { NAV_ARROW_FRACTION } from "@/nav/navCamera";

const CARD_HEIGHT = EXIT_CARD_HEIGHT;
const phones = [
  { width: 375, height: 667, safeTop: 20, safeBottom: 0 },
  { width: 390, height: 844, safeTop: 47, safeBottom: 34 },
  { width: 430, height: 932, safeTop: 59, safeBottom: 34 },
];

describe("exit question card placement", () => {
  for (const p of phones) {
    it(`${p.width}x${p.height}: above the arrow and clear of every control`, () => {
      const bottomBarHeight = 110;
      const { bottom, right } = exitCardPlacement({ windowHeight: p.height, safeTop: p.safeTop, safeBottom: p.safeBottom, topBarHeight: 92, bottomBarHeight });
      const card: Frame = { x: EXIT_CARD_SIDE, y: p.height - bottom - CARD_HEIGHT, width: p.width - EXIT_CARD_SIDE - right, height: CARD_HEIGHT };
      // Still wide enough for the question and two 44 pt buttons.
      expect(card.width).toBeGreaterThanOrEqual(270);
      const arrowTop = NAV_ARROW_FRACTION * p.height - ARROW_HALF;
      expect(card.y + card.height).toBeLessThanOrEqual(arrowTop - 12);
      const frames = navControlFrames({ ...p, bottomBarHeight, topBarHeight: 92, showSpeedLimit: true, showRecenter: true, showCompass: true, showAudioPlayer: true, showSound: true, showVoice: true, showStreetChip: true });
      const hit = Object.entries(frames).filter(([, f]) => f && intersects(card, f)).map(([k]) => k);
      expect(hit).toEqual([]);
    });
  }

  it("the map screen uses it (and keeps room for the live view when it's open)", () => {
    expect(readFileSync("src/screens/MapScreen.tsx", "utf8")).toMatch(/<ExitGateCard[\s\S]{0,120}\{\.\.\.exitCardPlacement\(\{ windowHeight, safeTop: insets\.top, safeBottom: insets\.bottom, topBarHeight: instructionCardHeight, bottomBarHeight, reservedBottom: liveViewReserved \}\)\}/);
  });
});
