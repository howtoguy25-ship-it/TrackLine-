// The dark alert card a pin tap opens: what each line says (live distance, "Here", road +
// suburb, note, byline, real thanks count), the thumbs-up rules, the compact navigation version,
// and the three ways it closes (8 s idle, swipe up, tap -- tap opens the details instead).
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ settings: { alertIconTheme: "default" } }) }));

import { AlertCard } from "@/components/AlertCard";
import {
  ALERT_CARD_IDLE_MS,
  bylineText,
  cardForOfficial,
  cardForReport,
  distanceLine,
  roadAndSuburb,
  spotlightCentre,
  timeAgo,
} from "@/map/alertCard";
import type { AlertDoc } from "@/types/alert";
import type { NearbyIncident } from "@/services/trafficNswModel";

const NOW = Date.UTC(2026, 10, 16, 1, 0, 0);

function alert(overrides: Partial<AlertDoc> = {}): AlertDoc {
  return {
    id: "a1",
    type: "police",
    lat: -33.9105,
    lng: 151.0559,
    geohash: "r3gx",
    region: "NSW",
    createdBy: "reporter",
    createdAt: NOW - 4 * 60_000,
    expiresAt: NOW + 40 * 60_000,
    confirmCount: 0,
    denyCount: 0,
    hiddenBy: {},
    thanksCount: 3,
    ...overrides,
  };
}

const incident: NearbyIncident = {
  id: "ltn-1",
  kind: "incident",
  category: "Crash",
  headline: "CRASH Punchbowl",
  where: "Canterbury Road at Punchbowl Road, Punchbowl",
  delay: "",
  advice: "Exercise caution",
  major: false,
  lat: -33.92,
  lng: 151.05,
  updatedAt: NOW - 12 * 60_000,
  distanceMeters: 800,
} as NearbyIncident;

describe("alert card text", () => {
  it("distance: 'Here' under 20 m, metres, then one decimal of km", () => {
    expect(distanceLine(5)).toBe("Here");
    expect(distanceLine(19.9)).toBe("Here");
    expect(distanceLine(20)).toBe("20 m away");
    expect(distanceLine(350)).toBe("350 m away");
    expect(distanceLine(1000)).toBe("1.0 km away");
    expect(distanceLine(2460)).toBe("2.5 km away");
    expect(distanceLine(12_400)).toBe("12 km away");
    expect(distanceLine(1609.344, "miles")).toBe("1.0 mi away");
    expect(distanceLine(null)).toBeNull();
  });

  it("time ago and byline", () => {
    expect(timeAgo(NOW - 20_000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 4 * 60_000, NOW)).toBe("4 min ago");
    expect(timeAgo(NOW - 3 * 3600_000, NOW)).toBe("3 h ago");
    expect(bylineText(cardForReport(alert(), null), NOW)).toBe("4 min ago by anonymous");
    expect(bylineText(cardForReport(alert({ reporterName: "Sam" }), null), NOW)).toBe("4 min ago by Sam");
    expect(bylineText(cardForOfficial(incident), NOW)).toBe("12 min ago by Live Traffic NSW");
  });

  it("road + suburb from a formatted address, without house number, state, postcode or country", () => {
    expect(roadAndSuburb("1234 Canterbury Rd, Punchbowl NSW 2196, Australia")).toBe("Canterbury Rd, Punchbowl");
    expect(roadAndSuburb("4/12 The Boulevarde, Strathfield NSW 2135, Australia")).toBe("The Boulevarde, Strathfield");
    expect(roadAndSuburb("Hume Hwy, Liverpool NSW 2170, Australia")).toBe("Hume Hwy, Liverpool");
    expect(roadAndSuburb("Australia")).toBeNull();
    expect(roadAndSuburb(null)).toBeNull();
  });

  it("official incidents use Transport for NSW's own category, place and advice", () => {
    const card = cardForOfficial(incident);
    expect(card).toMatchObject({ source: "official", title: "Crash", note: "Exercise caution", officialWhere: incident.where, by: "by Live Traffic NSW" });
  });

  it("the spotlight sits where the camera puts the pin: the centre of the padded map", () => {
    expect(spotlightCentre(390, 800, { top: 0, right: 0, bottom: 0, left: 0 })).toEqual({ x: 195, y: 400 });
    expect(spotlightCentre(390, 800, { top: 300, right: 0, bottom: 100, left: 0 })).toEqual({ x: 195, y: 500 });
  });
});

describe("<AlertCard />", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const base = (overrides: Record<string, unknown> = {}) => ({
    card: cardForReport(alert({ comment: "Behind the bus stop" }), "viewer"),
    incident: null,
    distanceText: "1.0 km away",
    place: "Canterbury Rd, Punchbowl",
    now: NOW,
    thanked: false,
    compact: false,
    top: 47,
    scale: 1,
    onThanks: jest.fn(),
    onOpenDetails: jest.fn(),
    onDismiss: jest.fn(),
    ...overrides,
  });

  it("shows the type, live distance, place, note in quotes, byline and the real thanks count", async () => {
    await render(<AlertCard {...base()} />);
    expect(screen.getByTestId("alert-card-title").props.children).toBe("Police");
    expect(screen.getByTestId("alert-card-distance").props.children).toBe("1.0 km away");
    expect(screen.getByTestId("alert-card-place").props.children).toBe("Canterbury Rd, Punchbowl");
    expect(screen.getByTestId("alert-card-note").props.children).toBe("“Behind the bus stop”");
    expect(screen.getByTestId("alert-card-byline").props.children).toBe("4 min ago by anonymous");
    expect(screen.getByTestId("alert-card-thanks-count").props.children).toBe(3);
  });

  it("the spec sizes: Rubik 400 34pt / 700 48pt / 500 20pt, 110pt icon with a 6pt white ring", async () => {
    await render(<AlertCard {...base()} />);
    const flat = (id: string) => Object.assign({}, ...[screen.getByTestId(id).props.style].flat(5).filter(Boolean));
    expect(flat("alert-card-title")).toMatchObject({ fontSize: 34, fontWeight: "400", color: "#FFFFFF" });
    expect(flat("alert-card-distance")).toMatchObject({ fontSize: 48, fontWeight: "700" });
    expect(flat("alert-card-place")).toMatchObject({ fontSize: 20, fontWeight: "500" });
    expect(flat("alert-card-icon")).toMatchObject({ width: 110, height: 110, borderWidth: 6, borderColor: "#FFFFFF" });
  });

  it("leaves out lines it doesn't know rather than guessing", async () => {
    await render(<AlertCard {...base({ distanceText: null, place: null, card: cardForReport(alert(), "viewer") })} />);
    expect(screen.queryByTestId("alert-card-distance")).toBeNull();
    expect(screen.queryByTestId("alert-card-place")).toBeNull();
    expect(screen.queryByTestId("alert-card-note")).toBeNull();
  });

  it("thumbs-up: works once, greyed out on your own report, none on official alerts", async () => {
    const onThanks = jest.fn();
    const { rerender } = await render(<AlertCard {...base({ onThanks })} />);
    await fireEvent.press(screen.getByTestId("alert-card-thanks"));
    expect(onThanks).toHaveBeenCalledTimes(1);

    await rerender(<AlertCard {...base({ onThanks, thanked: true })} />);
    expect(screen.getByTestId("alert-card-thanks").props.accessibilityState).toMatchObject({ disabled: true });

    await rerender(<AlertCard {...base({ onThanks, card: cardForReport(alert(), "reporter") })} />);
    expect(screen.getByTestId("alert-card-thanks").props.accessibilityState).toMatchObject({ disabled: true });

    await rerender(<AlertCard {...base({ card: cardForOfficial(incident), incident })} />);
    expect(screen.queryByTestId("alert-card-thanks")).toBeNull();
  });

  it("closes itself after 8 s without a touch; a touch restarts the clock", async () => {
    const onDismiss = jest.fn();
    await render(<AlertCard {...base({ onDismiss })} />);
    await act(async () => {
      jest.advanceTimersByTime(ALERT_CARD_IDLE_MS - 1000);
    });
    await fireEvent(screen.getByLabelText(/Police/), "touchStart", { nativeEvent: { pageY: 100 } });
    await act(async () => {
      jest.advanceTimersByTime(ALERT_CARD_IDLE_MS - 1000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("swipe up closes it; a tap opens the details", async () => {
    const onDismiss = jest.fn();
    const onOpenDetails = jest.fn();
    await render(<AlertCard {...base({ onDismiss, onOpenDetails })} />);
    const card = screen.getByLabelText(/Police/);
    await fireEvent(card, "touchStart", { nativeEvent: { pageY: 200 } });
    await fireEvent(card, "touchEnd", { nativeEvent: { pageY: 140 } });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await fireEvent(card, "touchStart", { nativeEvent: { pageY: 200 } });
    await fireEvent(card, "touchEnd", { nativeEvent: { pageY: 198 } });
    await fireEvent.press(card);
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });

  it("compact (navigation): smaller, no note, placed where it's told (under the instruction card)", async () => {
    await render(<AlertCard {...base({ compact: true, top: 230 })} />);
    expect(screen.getByTestId("alert-card-compact")).toBeTruthy();
    expect(screen.queryByTestId("alert-card-note")).toBeNull();
    const wrap = Object.assign({}, ...[screen.getByTestId("alert-card-compact").props.style].flat(5).filter(Boolean));
    expect(wrap.top).toBe(230);
    const icon = Object.assign({}, ...[screen.getByTestId("alert-card-icon").props.style].flat(5).filter(Boolean));
    expect(icon.width).toBe(56);
  });
});
