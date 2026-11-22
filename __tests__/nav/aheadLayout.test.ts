// The ahead banner never overlaps the top bar, speedometer, speed sign, Report, Re-centre or the
// ETA bar -- at any frame of its animation: the bottom controls rise first, then it slides in.
import { describe, expect, it } from "@jest/globals";
import { AHEAD_BANNER_HEIGHT, aheadRoom, crowded, navControlFrames, overlaps } from "@/nav/navControlsLayout";

const PHONES = [
  { width: 320, height: 568, safeTop: 20, safeBottom: 0 },
  { width: 375, height: 667, safeTop: 20, safeBottom: 0 },
  { width: 390, height: 844, safeTop: 47, safeBottom: 34 },
  { width: 430, height: 932, safeTop: 59, safeBottom: 34 },
];
const steps = Array.from({ length: 11 }, (_, i) => i / 10);

describe("ahead banner layout, frame by frame", () => {
  it.each(PHONES.map((p) => [p.width, p] as const))("%ipt: controls rise, then the banner slides in; nothing ever overlaps", (_w, p) => {
    // With Still there / Not there buttons the banner is taller.
    for (const height of [AHEAD_BANNER_HEIGHT, AHEAD_BANNER_HEIGHT + 48]) {
      for (const showSpeedLimit of [true, false]) {
        for (const showRecenter of [true, false]) {
          const frame = (room: number, progress: number) =>
            navControlFrames({
              ...p,
              bottomBarHeight: 110,
              topBarHeight: 120,
              showSpeedLimit,
              showRecenter,
              showCompass: true,
              showSound: true,
              showVoice: true,
              showStreetChip: true,
              raiseBy: room * aheadRoom(height),
              aheadBanner: { height, progress },
            });
          const frames = [...steps.map((r) => frame(r, 0)), ...steps.map((b) => frame(1, b))];
          for (const f of frames) {
            expect(overlaps(f)).toEqual([]);
            expect(crowded(f)).toEqual([]);
            for (const [k, fr] of Object.entries(f)) expect([k, fr!.y >= 0 && fr!.y + fr!.height <= p.height]).toEqual([k, true]);
            // The always-needed controls keep their place.
            for (const k of ["speedometer", "report", ...(p.height >= 667 ? ["compass"] : [])]) expect([k, !!f[k as keyof typeof f]]).toEqual([k, true]);
            if (showSpeedLimit) expect(!!f.speedLimit).toBe(true);
          }
          const full = frame(1, 1).aheadBanner!;
          expect(full.x).toBe(12);
          expect(full.width).toBe(p.width - 24);
          // It sits right above the ETA bar.
          expect(full.y + full.height).toBe(p.height - p.safeBottom - 110 - 12);
          // On every phone taller than the 4-inch one, sound and voice keep their place too.
          if (p.height >= 844) for (const k of ["sound", "voice"]) expect([k, !!frame(1, 1)[k as "sound"]]).toEqual([k, true]);
        }
      }
    }
  });
});
