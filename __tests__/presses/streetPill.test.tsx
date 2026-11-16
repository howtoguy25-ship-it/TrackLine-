// The live street-name pill: where it sits (bottom-centre, riding the sheet on the report
// button's baseline, never overlapping it at any phone width), what it shows, and when it hides.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

jest.mock("expo-haptics", () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: "light" } }));

import { HomeMapControls } from "@/components/HomeMapControls";
import { streetPillText } from "@/components/StreetPill";
import {
  ARROW_ABOVE_PILL,
  FLOATING_GAP,
  RoadLookupTracker,
  STREET_PILL_HEIGHT,
  countReportsAround,
  homeArrowTargetY,
  streetPillMaxWidth,
  streetPillTopY,
} from "@/map/homeMapLogic";
import { scaleFor } from "@/theme/tokens";

const shared = (v: number) => ({ value: v, get: () => v, set: () => {} }) as never;

function props(overrides: Record<string, unknown> = {}) {
  return {
    sheetVisibleHeight: shared(200),
    sheetHalfHeight: 420,
    bottomInset: 0,
    topInset: 0,
    unreadCount: 0,
    dashcamBadge: false,
    onMenu: jest.fn(),
    showCompass: true,
    bearing: shared(0),
    onCompass: jest.fn(),
    showAudioPlayer: true,
    onAudioPlayer: jest.fn(),
    soundOff: false,
    onSound: jest.fn(),
    onReport: jest.fn(),
    showRecenter: false,
    onRecenter: jest.fn(),
    streetPill: { streetName: "Canterbury Road", reportsAround: 0, stationary: false },
    ...overrides,
  } as unknown as React.ComponentProps<typeof HomeMapControls>;
}

describe("placement at every phone width (320 / 375 / 390 / 430 pt)", () => {
  it.each([320, 375, 390, 430])("%ipt: centred pill never reaches the report button", (w) => {
    const k = scaleFor(w);
    const report = 56 * k;
    const reportLeft = w - 16 * k - report;
    const max = streetPillMaxWidth(w, report, 16 * k);
    expect(max).toBe(w - (report + Math.max(16, 16 * k)) * 2);
    expect(w / 2 + max / 2).toBeLessThanOrEqual(reportLeft); // right edge of the widest pill
    expect(w / 2 - max / 2).toBeGreaterThanOrEqual(16 * k + report); // and the left side mirrors it
  });

  it("sits 12pt above the sheet, as tall as the report button; the arrow is just above it", () => {
    const map = 800;
    const sheet = 200;
    expect(streetPillTopY(map, sheet)).toBe(map - sheet - FLOATING_GAP - STREET_PILL_HEIGHT);
    expect(homeArrowTargetY(map, sheet)).toBe(streetPillTopY(map, sheet) - ARROW_ABOVE_PILL);
  });

  it("rides the sheet on exactly the report button's baseline", async () => {
    await render(<HomeMapControls {...props()} />);
    const row = StyleSheet.flatten(screen.getByTestId("street-pill-row").props.style);
    const report = StyleSheet.flatten(screen.getByTestId("report-anchor").props.style);
    expect(row.bottom).toBe(200 + FLOATING_GAP);
    expect(report.bottom).toBe(row.bottom);
  });
});

describe("what it shows", () => {
  it("the street name, in 22pt bold, shrinking to 16pt then cut with ...", async () => {
    await render(<HomeMapControls {...props({ streetPill: { streetName: "The Grand Parade Service Road Northbound", reportsAround: 0, stationary: false } })} />);
    const t = screen.getByTestId("street-pill-text");
    expect(t.props.numberOfLines).toBe(1);
    expect(t.props.ellipsizeMode).toBe("tail");
    expect(t.props.adjustsFontSizeToFit).toBe(true);
    expect(t.props.minimumFontScale).toBeCloseTo(16 / 22);
    const style = StyleSheet.flatten(t.props.style);
    expect(style.fontWeight).toBe("700");
    expect(style.color).toBe("#1F2125");
  });

  it("no name known: no pill at all (never 'Unknown road')", async () => {
    await render(<HomeMapControls {...props({ streetPill: { streetName: null, reportsAround: 0, stationary: false } })} />);
    expect(screen.queryByTestId("street-pill")).toBeNull();
    expect(streetPillText("   ", 0, false)).toBeNull();
  });

  it("stationary 10 s with real reports nearby: 'N reports around you'; zero reports: the street", () => {
    expect(streetPillText("Canterbury Road", 3, true)).toBe("3 reports around you");
    expect(streetPillText("Canterbury Road", 1, true)).toBe("1 report around you");
    expect(streetPillText("Canterbury Road", 0, true)).toBe("Canterbury Road");
    expect(streetPillText("Canterbury Road", 3, false)).toBe("Canterbury Road");
    const here = { latitude: -33.92, longitude: 151.05 };
    const alerts = [
      { lat: -33.921, lng: 151.051 },
      { lat: -34.5, lng: 151.05 }, // 60 km away
    ];
    expect(countReportsAround(alerts, here)).toBe(1);
  });

  it("hidden during navigation (no pill passed) -- the top card and banner take over", async () => {
    await render(<HomeMapControls {...props({ streetPill: null })} />);
    expect(screen.queryByTestId("street-pill-row")).toBeNull();
  });
});

describe("lookups", () => {
  it("only after moving 25 m or turning 30 degrees, and a known stretch costs nothing", () => {
    const t = new RoadLookupTracker<string>();
    const at = (dLat: number, heading = 90) => ({ latitude: -33.92 + dLat, longitude: 151.05, heading });
    expect(t.update(at(0))).toBe(true);
    t.resolve(at(0), "Canterbury Road");
    expect(t.update(at(0.0001))).toBe(false); // ~11 m
    expect(t.value).toBe("Canterbury Road");
    expect(t.update(at(0.0004))).toBe(true); // ~44 m
  });
});
