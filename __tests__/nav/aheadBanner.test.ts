// The ahead banner's one controller: timing (7 s / 6 s minor), early dismiss on passing, tap pauses,
// swipe dismisses, one critical reminder at 150 m, queue with a 400 ms gap, priority replacement,
// rapid-fire alerts, manoeuvre hold, and every lifecycle reset leaving zero timers.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AheadAlert } from "@/nav/ahead/aheadFeed";
import { AheadBannerController, type BannerState } from "@/nav/ahead/bannerController";
import { CRITICAL_KINDS, KIND_TIER, MINOR_KINDS, type AheadKind } from "@/nav/ahead/aheadKinds";

const alert = (key: string, kind: AheadKind, alongM: number, source: AheadAlert["source"] = "official"): AheadAlert => ({
  key,
  kind,
  item: null,
  source,
  lat: 0,
  lng: 0,
  alongM,
  aheadM: alongM,
  tier: KIND_TIER[kind],
  critical: CRITICAL_KINDS.has(kind),
  minor: MINOR_KINDS.has(kind),
  title: kind,
});

let ctl: AheadBannerController;
let shows: { key: string; reminder: boolean }[];
let states: BannerState[];
const consoleErrors: unknown[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  shows = [];
  states = [];
  ctl = new AheadBannerController({ setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }, () => Date.now(), {
    onShow: (a, reminder) => shows.push({ key: a.key, reminder }),
  });
  ctl.subscribe((s) => states.push(s));
  jest.spyOn(console, "error").mockImplementation((...a) => void consoleErrors.push(a));
});
afterEach(() => {
  ctl.reset("unmount");
  expect(ctl.activeTimers()).toBe(0);
  expect(consoleErrors).toEqual([]);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const drive = (feed: AheadAlert[], carAlongM: number, speedMps = 14, manoeuvreBusy = false) => ctl.update({ feed, carAlongM, speedMps, manoeuvreBusy });
const tick = (ms: number) => jest.advanceTimersByTime(ms);
const showing = () => ctl.getState().alert?.key ?? null;

describe("timing", () => {
  it("shows for 7 s then slides away (220 ms); 6 s for a minor road feature", () => {
    drive([alert("roadwork", "roadwork", 250)], 0);
    expect(showing()).toBe("roadwork");
    expect(ctl.getState().phase).toBe("entering");
    tick(220);
    expect(ctl.getState().phase).toBe("shown");
    tick(6779);
    expect(ctl.getState().phase).toBe("shown");
    tick(1);
    expect(ctl.getState().phase).toBe("leaving");
    tick(220);
    expect(showing()).toBeNull();

    tick(1000);
    drive([alert("hump", "hump", 100)], 0);
    expect(showing()).toBe("hump");
    tick(5999);
    expect(ctl.getState().phase).toBe("shown");
    tick(1);
    expect(ctl.getState().phase).toBe("leaving");
  });

  it("is not shown before its warning distance", () => {
    drive([alert("roadwork", "roadwork", 900)], 0, 14);
    expect(showing()).toBeNull();
    drive([alert("roadwork", "roadwork", 900)], 610, 14);
    expect(showing()).toBe("roadwork");
  });

  it("passing the spot before 7 s slides it away at once", () => {
    const a = alert("police", "police", 200);
    drive([a], 0);
    tick(2000);
    drive([a], 205);
    expect(ctl.getState().phase).toBe("leaving");
  });

  it("a driver report stays (for Still there / Not there) until 30 m past", () => {
    const a = alert("rep", "hazard", 200, "community");
    drive([a], 0);
    drive([a], 210);
    expect(ctl.getState().phase).not.toBe("leaving");
    expect(ctl.getState().aheadM).toBe(-10);
    drive([a], 231);
    expect(ctl.getState().phase).toBe("leaving");
  });

  it("tap pauses (stays past 7 s) until tapped again; moving past still dismisses", () => {
    const a = alert("cam", "camera", 280);
    drive([a], 0);
    tick(3000);
    ctl.tap();
    expect(ctl.getState().paused).toBe(true);
    tick(20000);
    expect(ctl.getState().phase).toBe("shown");
    ctl.tap();
    tick(3999);
    expect(ctl.getState().phase).toBe("shown");
    tick(1);
    expect(ctl.getState().phase).toBe("leaving");

    tick(1000);
    const b = alert("cam2", "camera", 600);
    drive([b], 400);
    ctl.tap();
    drive([b], 610);
    expect(ctl.getState().phase).toBe("leaving");
  });

  it("swipe sends it away now, and it never returns (no reminder either)", () => {
    const crash = alert("crash", "crash", 500);
    drive([crash], 0);
    ctl.swipe();
    expect(ctl.getState().phase).toBe("leaving");
    tick(2000);
    drive([crash], 400);
    expect(showing()).toBeNull();
    expect(shows).toEqual([{ key: "crash", reminder: false }]);
  });

  it("a critical alert gets ONE 4 s reminder at ~150 m; nothing else repeats", () => {
    const crash = alert("crash", "crash", 600);
    const cam = alert("cam", "camera", 400);
    drive([crash], 0);
    tick(8000);
    drive([crash, cam], 100);
    tick(8000);
    drive([crash, cam], 460);
    expect(showing()).toBe("crash");
    expect(ctl.getState().reminder).toBe(true);
    tick(3999);
    expect(ctl.getState().phase).toBe("shown");
    tick(1);
    expect(ctl.getState().phase).toBe("leaving");
    tick(1000);
    drive([crash, cam], 500);
    expect(showing()).toBeNull();
    expect(shows).toEqual([
      { key: "crash", reminder: false },
      { key: "cam", reminder: false },
      { key: "crash", reminder: true },
    ]);
  });
});

describe("queue and priority", () => {
  it("one at a time; the next slides in 400 ms after the previous has fully left", () => {
    const a = alert("a", "roadwork", 250);
    const b = alert("b", "roadwork", 280);
    drive([a, b], 0);
    expect(showing()).toBe("a");
    tick(7000 + 220);
    expect(showing()).toBeNull();
    drive([a, b], 10);
    expect(showing()).toBeNull();
    tick(399);
    expect(showing()).toBeNull();
    tick(1);
    expect(showing()).toBe("b");
  });

  it("a higher-priority alert replaces the current one at once; the replaced one isn't shown again", () => {
    const hump = alert("hump", "hump", 120);
    const closure = alert("closure", "closure", 500);
    drive([hump], 0);
    tick(1000);
    drive([hump, closure], 0);
    expect(ctl.getState().phase).toBe("leaving");
    tick(220);
    expect(showing()).toBe("closure");
    tick(8000);
    drive([hump, closure], 10);
    tick(1000);
    expect(showing()).toBeNull();
    expect(shows.map((s) => s.key)).toEqual(["hump", "closure"]);
  });

  it("a replaced critical alert comes back after the more important one", () => {
    const light = alert("light", "brokenLight", 500);
    const crash = alert("crash", "crash", 550);
    drive([light], 0);
    drive([light, crash], 0);
    tick(220);
    expect(showing()).toBe("crash");
    tick(7000 + 220 + 400);
    expect(showing()).toBe("light");
  });

  it("10 alerts in 5 s: shown one at a time, each once, no duplicates", () => {
    const feed = Array.from({ length: 10 }, (_, i) => alert(`a${i}`, "roadwork", 200 + i * 5));
    for (let i = 0; i < 10; i++) {
      drive(feed, i * 2);
      tick(500);
    }
    const seen: string[] = [];
    for (let i = 0; i < 200; i++) {
      drive(feed, 20);
      if (showing() && seen[seen.length - 1] !== showing()) seen.push(showing()!);
      tick(500);
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(10);
    expect(shows).toHaveLength(10);
    expect(states.every((s) => !s.alert || s.phase !== null)).toBe(true);
  });

  it("holds during a manoeuvre close-up unless critical within 200 m", () => {
    drive([alert("cam", "camera", 250)], 0, 14, true);
    expect(showing()).toBeNull();
    drive([alert("cam", "camera", 250)], 0, 14, false);
    expect(showing()).toBe("cam");
    ctl.reset("end");
    drive([alert("crash", "crash", 300)], 0, 14, true);
    expect(showing()).toBeNull();
    drive([alert("crash", "crash", 300)], 120, 14, true);
    expect(showing()).toBe("crash");
  });
});

describe("lifecycle: nothing stuck, nothing leaked", () => {
  it.each(["reroute", "background", "end"] as const)("%s clears the banner and every timer", (reason) => {
    drive([alert("a", "roadwork", 250), alert("b", "roadwork", 270)], 0);
    tick(100);
    expect(ctl.activeTimers()).toBeGreaterThan(0);
    ctl.reset(reason);
    expect(ctl.activeTimers()).toBe(0);
    expect(showing()).toBeNull();
    tick(20000);
    expect(showing()).toBeNull();
  });

  it("after a reroute the same alert isn't shown twice; after the drive ends it can be", () => {
    const a = alert("a", "police", 250);
    drive([a], 0);
    ctl.reset("reroute");
    drive([a], 0);
    expect(showing()).toBeNull();
    ctl.reset("end");
    drive([a], 0);
    expect(showing()).toBe("a");
  });

  it("unmount: no more updates, no setState after unmount, zero timers", () => {
    const listener = jest.fn();
    ctl.subscribe(listener);
    drive([alert("a", "roadwork", 250)], 0);
    listener.mockClear();
    ctl.reset("unmount");
    drive([alert("b", "roadwork", 250)], 0);
    ctl.tap();
    ctl.swipe();
    tick(20000);
    expect(listener).not.toHaveBeenCalled();
    expect(ctl.activeTimers()).toBe(0);
  });

  it("a failing voice callback never breaks the banner", () => {
    const c = new AheadBannerController({ setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }, () => Date.now(), {
      onShow: () => {
        throw new Error("speech engine gone");
      },
    });
    c.update({ feed: [alert("a", "police", 250)], carAlongM: 0, speedMps: 14, manoeuvreBusy: false });
    expect(c.getState().alert?.key).toBe("a");
    c.reset("unmount");
    expect(c.activeTimers()).toBe(0);
  });
});

describe("MapScreen wires every reset", () => {
   
  const src = (require("fs") as typeof import("fs")).readFileSync("src/screens/MapScreen.tsx", "utf8");
  it("end, reroute, background and unmount each clear the controller", () => {
    expect(src).toMatch(/if \(prev && !route\) aheadCtl\.reset\("end"\);/);
    expect(src).toMatch(/else if \(prev && route && prev !== route\) aheadCtl\.reset\("reroute"\);/);
    expect(src).toMatch(/if \(next !== "active"\) aheadCtl\.reset\("background"\);/);
    expect(src).toMatch(/useEffect\(\(\) => \(\) => aheadCtl\.reset\("unmount"\), \[aheadCtl\]\);/);
  });
  it("one controller per screen, created once; manoeuvre close-ups hold new banners", () => {
    expect(src.match(/new AheadBannerController\(/g)).toHaveLength(1);
    expect(src).toMatch(/manoeuvreBusy: exitZoomActive/);
  });
});
