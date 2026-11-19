// The ETA sheet (tap the arrival time while driving): reports on the road ahead in driving
// order, real 15-minute departure slots, the quickest one picked from real predictions only,
// failures shown as failures, and every action wired.
import React, { createRef } from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { departureSlots, eventsAlongRoute, predictLeaveTimes, quickestSlot } from "@/travel/etaSheet";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@gorhom/bottom-sheet", () => {
  const React = require("react");
  const { View, ScrollView } = require("react-native");
  const BottomSheet = React.forwardRef(function BottomSheet(props: { children: React.ReactNode; onChange?: (i: number) => void }, ref: unknown) {
    React.useImperativeHandle(ref, () => ({ expand: () => props.onChange?.(0), close: () => props.onChange?.(-1) }));
    return React.createElement(View, null, props.children);
  });
  return { __esModule: true, default: BottomSheet, BottomSheetScrollView: ScrollView, BottomSheetView: View };
});

import { NavOptionsSheet } from "@/screens/NavOptionsSheet";

// A straight road north, about 1.1 km long.
const ROAD = [
  { latitude: -33.8, longitude: 151.2 },
  { latitude: -33.795, longitude: 151.2 },
  { latitude: -33.79, longitude: 151.2 },
];

describe("events along the route", () => {
  it("keeps points on the road, in driving order, and drops ones off it", () => {
    const events = eventsAlongRoute(ROAD, [
      { id: "far", kind: "report", label: "Police", lat: -33.791, lng: 151.2 },
      { id: "off", kind: "report", label: "Hazard", lat: -33.795, lng: 151.21 }, // ~900 m east
      { id: "near", kind: "incident", label: "Crash", lat: -33.799, lng: 151.2002 }, // ~20 m off
    ]);
    expect(events.map((e) => e.id)).toEqual(["near", "far"]);
    expect(events[0].alongMeters).toBeGreaterThan(80);
    expect(events[0].alongMeters).toBeLessThan(140);
    expect(events[1].fraction).toBeGreaterThan(0.85);
  });

  it("an empty or one-point route has no events", () => {
    expect(eventsAlongRoute([ROAD[0]], [{ id: "x", kind: "report", label: "Police", lat: -33.8, lng: 151.2 }])).toEqual([]);
  });
});

describe("departure slots", () => {
  it("now, then the next quarter hours on the clock", () => {
    const now = new Date(2026, 10, 17, 9, 7, 30).getTime();
    const slots = departureSlots(now, 4);
    expect(slots[0]).toBe(now);
    expect(slots.slice(1).map((ms) => new Date(ms).getMinutes())).toEqual([15, 30, 45]);
  });

  it("exactly on a mark, the next slot is the following mark", () => {
    const now = new Date(2026, 10, 17, 9, 15, 0).getTime();
    expect(new Date(departureSlots(now, 2)[1]).getMinutes()).toBe(30);
  });
});

describe("leave-time predictions", () => {
  it("asks 'now' for the first slot and Unix seconds for the rest; a failed slot has no figure", async () => {
    const asked: (number | "now")[] = [];
    const preds = await predictLeaveTimes([1_000_000, 2_000_000, 3_000_000], async (t) => {
      asked.push(t);
      if (t === 2000) throw new Error("timeout");
      return t === "now" ? 900 : 600;
    });
    expect(asked).toEqual(["now", 2000, 3000]);
    expect(preds.map((p) => p.durationSeconds)).toEqual([900, null, 600]);
    expect(quickestSlot(preds)?.departMs).toBe(3_000_000);
  });

  it("no figures means no quickest slot", () => {
    expect(quickestSlot([{ departMs: 1, durationSeconds: null }])).toBeNull();
  });
});

function renderSheet(overrides: Partial<React.ComponentProps<typeof NavOptionsSheet>> = {}) {
  const ref = createRef<{ expand: () => void }>();
  const props = {
    arrivalClockText: "9:42 am",
    etaText: "24 min",
    distanceText: "18 km",
    distanceUnit: "km" as const,
    destinationName: "Central Station",
    destinationAddress: "Eddy Ave, Haymarket NSW",
    viaText: "M1",
    events: eventsAlongRoute(ROAD, [{ id: "p", kind: "report" as const, label: "Police", lat: -33.795, lng: 151.2 }]),
    loadLeaveTimes: jest.fn(async () => [
      { departMs: new Date(2026, 10, 17, 9, 7).getTime(), durationSeconds: 1500 },
      { departMs: new Date(2026, 10, 17, 9, 15).getTime(), durationSeconds: 1300 },
      { departMs: new Date(2026, 10, 17, 9, 30).getTime(), durationSeconds: null },
    ]),
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
    ...overrides,
  };
  return { ref, props, el: <NavOptionsSheet ref={ref as never} {...props} /> };
}

describe("ETA sheet", () => {
  it("shows To / Via, the arrival time, and the reports on the road ahead", async () => {
    const { el } = renderSheet();
    await render(el);
    expect(screen.getByTestId("eta-sheet-arrival")).toHaveTextContent("9:42 am");
    expect(screen.getByTestId("eta-sheet-to")).toHaveTextContent("Central Station");
    expect(screen.getByTestId("eta-sheet-via")).toHaveTextContent("M1");
    expect(screen.getByText("Police")).toBeTruthy();
  });

  it("says when nothing is reported ahead", async () => {
    const { el } = renderSheet({ events: [] });
    await render(el);
    expect(screen.getByTestId("eta-sheet-no-events")).toBeTruthy();
  });

  it("opening loads real predictions and marks the quickest; a missing slot has no bar value", async () => {
    const { el, ref, props } = renderSheet();
    await render(el);
    await act(async () => ref.current?.expand());
    expect(props.loadLeaveTimes).toHaveBeenCalledTimes(1);
    const best = screen.getByTestId("eta-sheet-leave-best");
    expect(best.props.accessibilityLabel).toMatch(/22 min.*quickest/);
    expect(screen.getByLabelText(/no prediction/)).toBeTruthy();
  });

  it("a failed load says why and retries on tap", async () => {
    const loadLeaveTimes = jest.fn(async () => {
      throw new Error("No internet");
    });
    const { el, ref } = renderSheet({ loadLeaveTimes: loadLeaveTimes as never });
    await render(el);
    await act(async () => ref.current?.expand());
    expect(screen.getByTestId("eta-sheet-leave-error")).toHaveTextContent(/No internet\. Tap to try again/);
    await act(async () => fireEvent.press(screen.getByTestId("eta-sheet-leave-error")));
    expect(loadLeaveTimes).toHaveBeenCalledTimes(2);
  });

  it("every row and button does its job", async () => {
    const { el, props } = renderSheet();
    await render(el);
    const pairs: [string, jest.Mock][] = [
      ["eta-sheet-settings", props.onOpenSettings as jest.Mock],
      ["eta-sheet-routes", props.onRoutes as jest.Mock],
      ["eta-sheet-more", props.onShowMoreTimes as jest.Mock],
      ["eta-sheet-share", props.onShareDrive as jest.Mock],
      ["eta-sheet-report", props.onReportAlert as jest.Mock],
      ["eta-sheet-add-stop", props.onAddStop as jest.Mock],
      ["eta-sheet-sound", props.onSoundVoice as jest.Mock],
      ["eta-sheet-map-view", props.onMapView as jest.Mock],
      ["eta-sheet-avoid", props.onAvoid as jest.Mock],
      ["eta-sheet-help", props.onHelp as jest.Mock],
      ["eta-sheet-dashcam", props.onOpenDetection as jest.Mock],
      ["eta-sheet-map", props.onOpenMapTools as jest.Mock],
      ["eta-sheet-stop", props.onEndNavigation as jest.Mock],
      ["eta-sheet-go", props.onClose as jest.Mock],
    ];
    for (const [id, fn] of pairs) {
      await fireEvent.press(screen.getByTestId(id));
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
});

describe("ETA sheet looks like a driving sheet", () => {
  it("is dark like the bottom bar, with the trip's options as 56pt rows and Stop / Continue", async () => {
    const { el } = renderSheet();
    await render(el);
    const json = JSON.stringify(screen.getByTestId("eta-sheet-options"));
    for (const id of ["eta-sheet-share", "eta-sheet-add-stop", "eta-sheet-report", "eta-sheet-sound", "eta-sheet-map-view", "eta-sheet-dashcam", "eta-sheet-avoid", "eta-sheet-help"]) expect(json).toContain(id);
    expect(screen.getByText("Share drive")).toBeTruthy();
    expect(screen.getByText("3D")).toBeTruthy();
    const src = require("fs").readFileSync("src/screens/NavOptionsSheet.tsx", "utf8");
    expect(src).toMatch(/SurfaceScheme value="dark"/);
    expect(src).toMatch(/minHeight: 56/);
    expect(screen.getByText("Stop")).toBeTruthy();
    expect(screen.getByText("Continue")).toBeTruthy();
  });
});

describe("See what's ahead", () => {
  it("counts what's on the route and opens the sheet on tap", async () => {
    const { SeeWhatsAheadBanner } = require("@/components/SeeWhatsAheadBanner");
    const onPress = jest.fn();
    await render(<SeeWhatsAheadBanner top={100} count={3} onPress={onPress} />);
    expect(screen.getByText("See what's ahead · 3 reports on your route")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("see-whats-ahead"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
