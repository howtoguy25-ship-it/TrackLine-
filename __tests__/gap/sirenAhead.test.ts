// Gap item 5: the siren radar hearing an emergency vehicle while navigating -> the ahead banner
// ("Emergency vehicle nearby", "Nearby", "Heard by your phone", spoken "move aside safely"), once
// per episode, ending 60 s after the last detection; never on the map or in the route list.
import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { noteSiren, sirenActive, sirenAheadAlert, SIREN_HOLD_MS, SIREN_SPOKEN, SIREN_TITLE } from "@/nav/ahead/sirenAhead";
import { AheadBannerController } from "@/nav/ahead/bannerController";
import { distanceText } from "@/nav/ahead/aheadTiming";
import { aheadSourceLine, aheadSubtitle } from "@/nav/ahead/aheadText";

const here = { latitude: -33.87, longitude: 151.2 };

describe("siren episode", () => {
  it("detections within the hold continue one episode; after it, a new one", () => {
    const a = noteSiren(null, 1000, here);
    const b = noteSiren(a, 1000 + 30_000, here);
    expect(b.firstAt).toBe(1000);
    expect(b.lastAt).toBe(31_000);
    const c = noteSiren(b, 31_000 + SIREN_HOLD_MS + 1, here);
    expect(c.firstAt).toBe(31_000 + SIREN_HOLD_MS + 1);
    expect(sirenActive(b, 31_000 + SIREN_HOLD_MS)).toBe(true);
    expect(sirenActive(b, 31_000 + SIREN_HOLD_MS + 1)).toBe(false);
    expect(sirenActive(null, 0)).toBe(false);
  });

  it("the alert rides just ahead of the car, says Nearby, and names the phone as the source", () => {
    const ep = noteSiren(null, 5000, here);
    const at500 = sirenAheadAlert(ep, 500, 5000)!;
    const at900 = sirenAheadAlert(ep, 900, 5000)!;
    expect(at500.key).toBe(at900.key);
    expect(at900.alongM - 900).toBeGreaterThan(0);
    expect(at500).toMatchObject({ kind: "emergency", source: "siren", title: SIREN_TITLE });
    expect(distanceText(at500.aheadM, "km", at500.source)).toBe("Nearby");
    expect(aheadSourceLine(at500)).toBe("Heard by your phone");
    expect(aheadSubtitle(at500, "George St", "km", 5000)).toBe("Siren heard · move aside when it's safe");
    expect(sirenAheadAlert(ep, 900, 5000 + SIREN_HOLD_MS + 1)).toBeNull();
    expect(SIREN_SPOKEN).toBe("Emergency vehicle nearby, move aside safely");
  });

  it("through the real banner controller: shown once per episode, 7 s, not again on more detections", () => {
    jest.useFakeTimers();
    const shows: string[] = [];
    const ctl = new AheadBannerController({ setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }, () => Date.now(), {
      onShow: (a) => shows.push(a.key),
    });
    let ep = noteSiren(null, 0, here);
    let car = 0;
    const step = () => {
      car += 14;
      const a = sirenAheadAlert(ep, car, ep.lastAt);
      ctl.update({ feed: a ? [a] : [], carAlongM: car, speedMps: 14, manoeuvreBusy: false });
    };
    step();
    expect(ctl.getState().alert?.title).toBe(SIREN_TITLE);
    const heardEverySecondFor = (n: number) => {
      for (let i = 0; i < n; i++) {
        jest.advanceTimersByTime(1000);
        ep = noteSiren(ep, ep.lastAt + 1000, here);
        step();
      }
    };
    heardEverySecondFor(5);
    // Still the same banner, never "passed" although the car moved 70 m.
    expect(ctl.getState().alert?.key).toBe(`siren:0`);
    // Gone after its 7 s, and more detections of the same siren don't bring it back.
    heardEverySecondFor(20);
    expect(ctl.getState().alert).toBeNull();
    expect(shows).toEqual(["siren:0"]);
    // Heard again after the hold ended: a new episode, a new banner.
    ep = noteSiren(ep, ep.lastAt + SIREN_HOLD_MS + 1000, here);
    step();
    expect(shows).toEqual(["siren:0", `siren:${ep.firstAt}`]);
    ctl.reset("unmount");
    expect(ctl.activeTimers()).toBe(0);
    jest.useRealTimers();
  });

  // Moved: the siren radar now has its own top banner (components/EmergencyVehicleBanner.tsx,
  // __tests__/siren/sirenRadar.test.tsx), so MapScreen no longer puts a siren into the ahead feed
  // (that would be two banners for one siren). The ahead banner waits while it's up.
  it("MapScreen: a siren gets the radar banner, not a second ahead banner; the ahead banner waits", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).not.toMatch(/sirenAheadAlert\(/);
    expect(src).toMatch(/setRadarBanner\(\{ type: ev\.type, closeness: ev\.closeness \}\)/);
    expect(src).toMatch(/state=\{navOptionsSheetOpen \|\| radarBanner \? \{ \.\.\.aheadState, alert: null \} : aheadState\}/);
    expect(src).toMatch(/announcePhraseRef\.current\(\{ kind: "said", text: RADAR_SPOKEN \}\)/);
    expect(src).toMatch(/aheadFeedNow\.filter\(\(x\) => \(x\.source === "map" \|\| x\.source === "traffic"\)/);
  });
});
