// The ahead banner as drawn: title, real detail, source, live distance ("Now" under 30 m); tap
// pauses while moving and opens the card when stopped; swipe up dismisses; Still there /
// Not there only for a passed (or crawled-past) driver report; the jam's faster-route offer;
// every meaning colour readable; the spoken line respects Less chatty; the ETA sheet's list.
import React, { createRef } from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@gorhom/bottom-sheet", () => {
  const React = require("react");
  const { View, ScrollView } = require("react-native");
  const Sheet = React.forwardRef(function Sheet(p: { children: React.ReactNode }, _r: unknown) {
    return React.createElement(View, null, p.children);
  });
  return { __esModule: true, default: Sheet, BottomSheetScrollView: ScrollView, BottomSheetView: View };
});

import { AheadBanner } from "@/components/AheadBanner";
import type { AheadAlert } from "@/nav/ahead/aheadFeed";
import type { BannerState } from "@/nav/ahead/bannerController";
import { CRITICAL_KINDS, KIND_TIER, MINOR_KINDS, type AheadKind } from "@/nav/ahead/aheadKinds";
import { aheadSourceLine, aheadSubtitle } from "@/nav/ahead/aheadText";
import { AHEAD_COLOURS, SURFACES, contrastRatio } from "@/theme/colors";
import { shouldSpeakPhrase, planPhrase } from "@/services/navSpeechPlan";
import { NavOptionsSheet } from "@/screens/NavOptionsSheet";

const NOW = 1_800_000_000_000;
const alert = (kind: AheadKind, extra: Partial<AheadAlert> = {}): AheadAlert => ({
  key: `${kind}-1`,
  kind,
  item: null,
  source: "official",
  lat: 0,
  lng: 0,
  alongM: 1000,
  aheadM: 400,
  tier: KIND_TIER[kind],
  critical: CRITICAL_KINDS.has(kind),
  minor: MINOR_KINDS.has(kind),
  title: "Roadwork",
  ...extra,
});
const state = (a: AheadAlert, aheadM = 400, extra: Partial<BannerState> = {}): BannerState => ({ alert: a, aheadM, reminder: false, phase: "shown", paused: false, seq: 1, ...extra });

function show(s: BannerState, overrides: Record<string, unknown> = {}) {
  const props = {
    state: s,
    unit: "km" as const,
    dark: true,
    road: "Stacey St",
    warnM: 600,
    speedKmh: 50,
    nowMs: NOW,
    top: 120,
    room: (() => {
      let v = 0;
      return { value: 0, get: () => v, set: (n: unknown) => void (v = typeof n === "number" ? n : v) };
    })() as never,
    onHeight: jest.fn(),
    onTap: jest.fn(),
    onSwipe: jest.fn(),
    onOpenCard: jest.fn(),
    canVote: true,
    onStillThere: jest.fn(),
    onNotThere: jest.fn(),
    fasterRoute: null,
    ...overrides,
  };
  return { props, el: <AheadBanner {...props} /> };
}

describe("the banner", () => {
  it("title, the real detail line, the source and the live distance", async () => {
    const { el } = show(state(alert("roadwork", { officialText: "2 lanes closed" })));
    await render(el);
    expect(screen.getByTestId("ahead-title")).toHaveTextContent("Roadwork");
    expect(screen.getByTestId("ahead-subtitle")).toHaveTextContent("2 lanes closed");
    expect(screen.getByTestId("ahead-source")).toHaveTextContent("Live Traffic NSW");
    expect(screen.getByTestId("ahead-distance")).toHaveTextContent("400 m");
  });

  it("counts down to 'Now' under 30 m", async () => {
    const { el } = show(state(alert("hump", { title: "Speed hump", source: "map" }), 20));
    await render(el);
    expect(screen.getByTestId("ahead-distance")).toHaveTextContent("Now");
  });

  it("missing fields: no road, no text -> lines are left out, never 'undefined'", async () => {
    const { el } = show(state(alert("police", { title: "Police", source: "community", createdAt: null })), { road: null });
    await render(el);
    expect(screen.queryByTestId("ahead-subtitle")).toBeNull();
    expect(screen.getByTestId("ahead-source")).toHaveTextContent("by a Tracky");
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/undefined|NaN/);
  });

  it("tap while moving pauses; tap while stopped opens the full card; swipe up dismisses", async () => {
    const moving = show(state(alert("camera", { title: "Speed camera" })));
    await render(moving.el);
    await fireEvent.press(screen.getByTestId("ahead-banner-camera"));
    expect(moving.props.onTap).toHaveBeenCalledTimes(1);
    expect(moving.props.onOpenCard).not.toHaveBeenCalled();

    const stopped = show(state(alert("camera", { title: "Speed camera" })), { speedKmh: 3 });
    await render(stopped.el);
    await fireEvent.press(screen.getByTestId("ahead-banner-camera"));
    expect(stopped.props.onOpenCard).toHaveBeenCalledTimes(1);

    const swipe = show(state(alert("camera", { title: "Speed camera" })));
    await render(swipe.el);
    const card = screen.getByTestId("ahead-banner-camera");
    await fireEvent(card, "touchStart", { nativeEvent: { pageY: 660 } });
    await fireEvent(card, "touchEnd", { nativeEvent: { pageY: 600 } });
    expect(swipe.props.onSwipe).toHaveBeenCalledTimes(1);
  });

  it("Still there / Not there only for a driver report once passed (or crawling), and only signed in", async () => {
    const report = alert("hazard", { title: "Hazard", source: "community", alertId: "abc" });
    await render(show(state(report, 300)).el);
    expect(screen.queryByTestId("ahead-still-there")).toBeNull();
    const passed = show(state(report, -10));
    await render(passed.el);
    await fireEvent.press(screen.getByTestId("ahead-still-there"));
    expect(passed.props.onStillThere).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId("ahead-not-there"));
    expect(passed.props.onNotThere).toHaveBeenCalledTimes(1);
    await render(show(state(report, -10), { canVote: false }).el);
    expect(screen.queryByTestId("ahead-still-there")).toBeNull();
    await render(show(state(alert("hazard", { source: "official" }), -10)).el);
    expect(screen.queryByTestId("ahead-still-there")).toBeNull();
  });

  it("a jam with a faster route offers Switch / Keep", async () => {
    const onSwitch = jest.fn();
    const onKeep = jest.fn();
    await render(show(state(alert("heavyTraffic", { title: "Heavy traffic", source: "traffic", lengthM: 1200, delaySeconds: 240 })), { fasterRoute: { savesMin: 6, onSwitch, onKeep } }).el);
    expect(screen.getByText("Faster route · saves 6 min")).toBeTruthy();
    expect(screen.getByTestId("ahead-subtitle")).toHaveTextContent("On Stacey St · Slow for 1.2 km · +4 min");
    await fireEvent.press(screen.getByTestId("ahead-switch"));
    await fireEvent.press(screen.getByTestId("ahead-keep"));
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("nothing drawn without an alert", async () => {
    await render(show({ alert: null, aheadM: 0, reminder: false, phase: null, paused: false, seq: 0 }).el);
    expect(screen.queryByTestId("ahead-banner")).toBeNull();
  });
});

describe("words, colours and voice", () => {
  it("community detail: age and drivers; source by name only when given", () => {
    const a = alert("police", { title: "Police", source: "community", createdAt: NOW - 6 * 60000, confirmCount: 2 });
    expect(aheadSubtitle(a, "Stacey St", "km", NOW)).toBe("On Stacey St · Reported 6 min ago · 3 drivers");
    expect(aheadSourceLine({ ...a, reporterName: "Sam" })).toBe("by Sam");
  });

  it("every meaning colour: the glyph reads on its fill (3:1), and the card text reads in light and dark", () => {
    for (const [kind, c] of Object.entries(AHEAD_COLOURS)) expect([kind, contrastRatio(c.glyph, c.fill) >= 3]).toEqual([kind, true]);
    for (const scheme of ["light", "dark"] as const) {
      const s = SURFACES[scheme];
      expect(contrastRatio(s.text, s.raised)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(s.textMuted, s.raised)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("spoken directions: Normal and Only alerts speak every alert; Less chatty only critical; Off none", () => {
    const hump = { kind: "ahead" as const, text: "Speed hump ahead", critical: false };
    const crash = { kind: "ahead" as const, text: "Crash reported ahead", critical: true };
    expect(shouldSpeakPhrase("normal", hump)).toBe(true);
    expect(shouldSpeakPhrase("onlyAlerts", hump)).toBe(true);
    expect(shouldSpeakPhrase("lessChatty", hump)).toBe(false);
    expect(shouldSpeakPhrase("lessChatty", crash)).toBe(true);
    expect(shouldSpeakPhrase("off", crash)).toBe(false);
    // A recorded voice uses the driver's clip only when they recorded it.
    expect(planPhrase({ ...crash, clipKey: "report_crash" }, { recordedKeys: new Set(["report_crash"]) }).segments[0]).toMatchObject({ clipKey: "report_crash" });
    expect(planPhrase({ ...crash, clipKey: "report_crash" }, { recordedKeys: new Set() }).segments[0].clipKey).toBeUndefined();
  });
});

describe("ETA sheet: On your route", () => {
  const base = {
    arrivalClockText: "9:42 am",
    etaText: "24 min",
    distanceText: "18 km",
    distanceUnit: "km" as const,
    destinationName: "Central",
    events: [],
    loadLeaveTimes: jest.fn(async () => []),
    onShowMoreTimes: jest.fn(),
    onOpenSettings: jest.fn(),
    onRoutes: jest.fn(),
    onShareDrive: jest.fn(),
    onReportAlert: jest.fn(),
    onAddStop: jest.fn(),
    onSoundVoice: jest.fn(),
    mapViewLabel: "3D",
    onMapView: jest.fn(),
    avoidSummary: "None",
    onAvoid: jest.fn(),
    onHelp: jest.fn(),
    onOpenDetection: jest.fn(),
    onOpenMapTools: jest.fn(),
    onEndNavigation: jest.fn(),
    onClose: jest.fn(),
  };
  it("every upcoming alert with road, distance and time; tap shows it on the map", async () => {
    const onAheadPress = jest.fn();
    await render(
      <NavOptionsSheet
        ref={createRef() as never}
        {...base}
        ahead={[
          { key: "a", kind: "hump", title: "Speed hump", road: "Stacey St", aheadM: 400, etaSeconds: 40 },
          { key: "b", kind: "roadwork", title: "Roadwork", road: null, aheadM: 2300, etaSeconds: 200 },
        ]}
        onAheadPress={onAheadPress}
      />
    );
    expect(screen.getByTestId("eta-sheet-ahead-a")).toHaveTextContent(/Speed hump.*Stacey St.*400 m · in 1 min/);
    await fireEvent.press(screen.getByTestId("eta-sheet-ahead-b"));
    expect(onAheadPress).toHaveBeenCalledWith("b");
  });
  it("'Nothing reported on your route' when there's nothing", async () => {
    await render(<NavOptionsSheet ref={createRef() as never} {...base} ahead={[]} onAheadPress={jest.fn()} />);
    expect(screen.getByTestId("eta-sheet-no-ahead")).toHaveTextContent("Nothing reported on your route");
  });
});
