// Waze-match: the home arrow sits at ~72% of the screen with the street pill directly under it.
// Before: the "Where to?" peek was 24% of the screen (~171 pt on 390x844), so the arrow could only
// sit at ~58-61%. Now the peek is the search field only (WHERE_TO_PEEK_PT) and the Home / Work
// chips are one swipe up.
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/services/firebase", () => ({ db: {}, functions: {} }));
jest.mock("@firebase/functions", () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }));

import { threeSnapHeights } from "@/components/ThreeSnapBottomSheet";
import { whereToSnapFractions } from "@/map/homeMapLogic";
import { ARROW_ABOVE_PILL, FLOATING_GAP, STREET_PILL_HEIGHT, WHERE_TO_PEEK_PT, homeArrowTargetY, homeControlFrames, streetPillTopY } from "@/map/homeMapLogic";
import { PILL_ABOVE_SHEET } from "@/components/HomeInfoPill";

const BANNER = 50;
// width, height, top inset, bottom inset (real iPhone sizes)
const PHONES: [number, number, number, number][] = [
  [375, 667, 20, 0],
  [390, 844, 47, 34],
  [393, 852, 59, 34],
  [430, 932, 59, 34],
];

function layout([w, h, top, bottom]: [number, number, number, number]) {
  const bannerArea = BANNER + bottom;
  const mapH = h - bannerArea;
  const peek = threeSnapHeights(h, top, bannerArea, whereToSnapFractions(h, top, bannerArea)).peek;
  return { w, h, mapH, peek, arrowY: homeArrowTargetY(mapH, peek), pillTop: streetPillTopY(mapH, peek) };
}

describe("home arrow at ~72%", () => {
  it("the peek is the fixed search-field height on every phone", () => {
    for (const p of PHONES) expect(Math.round(layout(p).peek)).toBe(WHERE_TO_PEEK_PT);
  });

  it("390x844: the arrow is at 71-73% of the screen", () => {
    const l = layout(PHONES[1]);
    expect(l.arrowY / l.h).toBeGreaterThan(0.705);
    expect(l.arrowY / l.h).toBeLessThan(0.73);
  });

  it("every phone: between 68% and 75%, and the street pill sits directly under the arrow", () => {
    for (const p of PHONES) {
      const l = layout(p);
      expect(l.arrowY / l.h).toBeGreaterThan(0.68);
      expect(l.arrowY / l.h).toBeLessThan(0.75);
      expect(l.pillTop - l.arrowY).toBe(ARROW_ABOVE_PILL);
      // and the pill ends above the sheet
      expect(l.pillTop + STREET_PILL_HEIGHT + FLOATING_GAP).toBeCloseTo(l.mapH - l.peek, 5);
    }
  });

  it("the street pill is still a full 44 pt tap target and no control overlaps it", () => {
    expect(STREET_PILL_HEIGHT).toBeGreaterThanOrEqual(44);
    const l = layout(PHONES[1]);
    const f = homeControlFrames({ width: l.w, height: l.mapH, topInset: 47, scale: 1, sheetVisibleHeight: l.peek, bottomInset: 0, showCompass: true, showAudioPlayer: false, showSound: true, showRecenter: false, showStreetPill: true });
    const pill = f.streetPill!;
    const report = f.report!;
    expect(pill.x + pill.width).toBeLessThanOrEqual(report.x);
  });

  it("the Trackys pill takes the street pill's slot, so it never covers the arrow", () => {
    expect(PILL_ABOVE_SHEET).toBe(FLOATING_GAP);
  });
});
