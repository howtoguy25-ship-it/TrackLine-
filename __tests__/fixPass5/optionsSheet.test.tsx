// Fix pass 5 §8: the options/ETA sheet never covers the guidance (max height = screen - bar -
// 120, content scrolls inside), headings in sentence case, and the best-time chart: equal bars,
// one-line labels, a "Best" tag above the quickest, real data only, and a timeout that says
// "Couldn't load traffic predictions — tap to retry".
import { readFileSync } from "fs";
import { describe, expect, it, jest } from "@jest/globals";
import { LEAVE_ERROR_TEXT, LEAVE_TIMEOUT_MS, SHEET_GAP_BELOW_BAR, leaveChartBars, optionsSheetHeights, shortClock, withTimeout } from "@/travel/etaSheet";
import { formatArrivalClock } from "@/utils/navFormat";

const PHONES = [
  { h: 568, top: 20 },
  { h: 667, top: 20 },
  { h: 844, top: 47 },
  { h: 932, top: 59 },
];
const src = readFileSync("src/screens/NavOptionsSheet.tsx", "utf8");

describe("the sheet never covers the guidance", () => {
  for (const p of PHONES) {
    for (const bar of [110, 120, 168]) {
      it(`${p.h}pt phone, instruction bar ${bar}pt`, () => {
        const topBarBottom = p.top + bar;
        const { half, full } = optionsSheetHeights(p.h, topBarBottom);
        // Its top edge stays at least 120pt under the bar (240pt minimum on a 4-inch phone).
        if (p.h - topBarBottom - SHEET_GAP_BELOW_BAR >= 240) expect(p.h - full).toBeGreaterThanOrEqual(topBarBottom + SHEET_GAP_BELOW_BAR);
        expect(half).toBeLessThanOrEqual(full);
        expect(half).toBeGreaterThan(0);
      });
    }
  }
  it("the sheet uses those heights and scrolls its content", () => {
    expect(src).toMatch(/optionsSheetHeights\(screenHeight, topBarBottom/);
    expect(src).toMatch(/snapPoints=\{snapPoints\}/);
    expect(src).toMatch(/<BottomSheetScrollView/);
    expect(src).not.toMatch(/"72%"/);
    expect(readFileSync("src/screens/MapScreen.tsx", "utf8")).toMatch(/topBarBottom=\{insets\.top \+ instructionCardHeight\}/);
  });
});

describe("sentence-case headings", () => {
  it("no upper-casing, headings written as sentences", () => {
    expect(src).not.toMatch(/textTransform: "uppercase"/);
    const labels = [...src.matchAll(/<Text style=\{styles\.sectionLabel\}>([^<{]+)<\/Text>/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).toMatch(/^[A-Z][a-z' ]+$/);
  });
});

describe("best time to leave", () => {
  const preds = [0, 15, 30, 45, 60, 75].map((m, i) => ({ departMs: Date.UTC(2026, 10, 24, 8, m), durationSeconds: i === 3 ? null : [1500, 1380, 1320, 0, 1440, 1560][i] }));
  it("bars come only from real predictions; a missing slot has no number; one Best", () => {
    const bars = leaveChartBars(preds, 72, formatArrivalClock);
    expect(bars.map((b) => b.minutes)).toEqual([25, 23, 22, null, 24, 26]);
    expect(bars.filter((b) => b.best).map((b) => b.minutes)).toEqual([22]);
    expect(bars[0].label).toBe("Now");
    for (const b of bars) expect(b.label).not.toMatch(/am|pm|\s/); // fits one line
    // taller = longer drive
    expect(bars[5].height).toBeGreaterThan(bars[2].height);
  });
  it("short clock labels", () => {
    expect(shortClock("9:15 am")).toBe("9:15");
    expect(shortClock("10:45 pm")).toBe("10:45");
  });
  it("equal bar widths, one-line labels, Best tag above the bar", () => {
    expect(src).toMatch(/bar: \{ width: BAR_WIDTH/);
    expect(src).toMatch(/numberOfLines=\{1\} adjustsFontSizeToFit/);
    const tag = src.indexOf('testID="eta-sheet-best-tag"');
    const barAt = src.indexOf("styles.bar, b.minutes");
    expect(tag).toBeGreaterThan(0);
    expect(tag).toBeLessThan(barAt);
  });
  it("a request that never answers times out with the retry message", async () => {
    jest.useFakeTimers();
    const never = new Promise<never>(() => {});
    const p = withTimeout(never, LEAVE_TIMEOUT_MS);
    jest.advanceTimersByTime(LEAVE_TIMEOUT_MS + 1);
    await expect(p).rejects.toThrow("timed out");
    jest.useRealTimers();
    expect(LEAVE_ERROR_TEXT).toBe("Couldn't load traffic predictions — tap to retry");
    expect(src).toMatch(/withTimeout\(loadLeaveTimes\(\), LEAVE_TIMEOUT_MS\)/);
    expect(src).toMatch(/\{LEAVE_ERROR_TEXT\}/);
  });
});
