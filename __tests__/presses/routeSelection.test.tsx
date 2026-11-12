// The route screen's controls: Avoid, the travel-mode pill, back/swap/edit rows, route rows,
// Leave later, Go now (and its countdown), Add a stop.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import {
  AvoidSheet,
  RouteSelectionSheet,
  RouteSelectionTopCard,
  TravelModeSheet,
  type RouteChoiceRow,
} from "@/components/RouteSelection";
import { DEFAULT_ROUTE_AVOID } from "@/map/routeChoices";
import { SurfaceScheme } from "@/components/ui/surfaceScheme";
import { paints } from "../support/darkScan";

const rows: RouteChoiceRow[] = [
  { key: "a", timeText: "10 min", distanceText: "5.2 km", title: "Via M2", subtitle: "Best route, Typical traffic · Toll" },
  { key: "b", timeText: "13 min", distanceText: "6.0 km", title: "Via Epping Rd", subtitle: "No tolls, Light traffic" },
];

function topCard(overrides: Partial<React.ComponentProps<typeof RouteSelectionTopCard>> = {}) {
  const props = {
    originLabel: "Your location",
    destinationLabel: "Westfield",
    onBack: jest.fn(),
    onEditOrigin: jest.fn(),
    onEditDestination: jest.fn(),
    onSwap: jest.fn(),
    avoidLabel: "Avoid",
    avoidActive: false,
    onOpenAvoid: jest.fn(),
    travelMode: "driving" as const,
    onOpenMode: jest.fn(),
    ...overrides,
  };
  return props;
}

function sheet(overrides: Partial<React.ComponentProps<typeof RouteSelectionSheet>> = {}) {
  return {
    rows,
    selectedIndex: 0,
    onSelect: jest.fn(),
    loading: false,
    errorText: null,
    loadingText: "Finding the best routes…",
    onLeaveLater: jest.fn(),
    onGoNow: jest.fn(),
    countdownRunning: false,
    onCountdownDone: jest.fn(),
    onAddStop: jest.fn(),
    hasStop: false,
    ...overrides,
  };
}

describe("Route screen top card", () => {
  it("every control calls its action", async () => {
    const p = topCard();
    await render(<RouteSelectionTopCard {...p} />);
    await fireEvent.press(screen.getByLabelText("Back"));
    await fireEvent.press(screen.getByLabelText("Starting from Your location. Tap to change."));
    await fireEvent.press(screen.getByLabelText("Going to Westfield. Tap to change."));
    await fireEvent.press(screen.getByLabelText("Swap: start from Westfield and go to Your location"));
    await fireEvent.press(screen.getByLabelText("Avoid. Choose what routes avoid."));
    await fireEvent.press(screen.getByLabelText(/Change how you're getting there/));
    for (const fn of [p.onBack, p.onEditOrigin, p.onEditDestination, p.onSwap, p.onOpenAvoid, p.onOpenMode]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
});

describe("Avoid sheet", () => {
  it("switching Toll roads on reports it; unsupported options can't be switched", async () => {
    const onToggle = jest.fn();
    await render(<AvoidSheet visible prefs={DEFAULT_ROUTE_AVOID} onToggle={onToggle} onClose={jest.fn()} />);
    await fireEvent(screen.getByLabelText("Avoid toll roads"), "valueChange", true);
    expect(onToggle).toHaveBeenCalledWith("tolls", true);
    expect(screen.getByLabelText("Avoid unpaved roads").props.disabled).toBe(true);
  });

  it("Done closes it", async () => {
    const onClose = jest.fn();
    await render(<AvoidSheet visible prefs={DEFAULT_ROUTE_AVOID} onToggle={jest.fn()} onClose={onClose} />);
    await fireEvent.press(screen.getByLabelText("Done"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Travel mode sheet", () => {
  it("picking Walk reports walking", async () => {
    const onSelect = jest.fn();
    await render(<TravelModeSheet visible mode="driving" onSelect={onSelect} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByText("Walk"));
    expect(onSelect).toHaveBeenCalledWith("walking");
  });
});

describe("Route screen bottom sheet", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it("Go now starts navigation; Leave later opens planning", async () => {
    const p = sheet();
    await render(<RouteSelectionSheet {...p} />);
    await fireEvent.press(screen.getByText("Go now"));
    await fireEvent.press(screen.getByText("Leave later"));
    expect(p.onGoNow).toHaveBeenCalledTimes(1);
    expect(p.onLeaveLater).toHaveBeenCalledTimes(1);
  });

  it("pulled up, tapping a route row selects it, and Add a stop works", async () => {
    const p = sheet();
    await render(<RouteSelectionSheet {...p} />);
    await fireEvent.press(screen.getByLabelText("Show all routes"));
    await fireEvent.press(screen.getByLabelText(/^13 min, 6\.0 km/));
    expect(p.onSelect).toHaveBeenCalledWith(1);
    await fireEvent.press(screen.getByText("Add a stop"));
    expect(p.onAddStop).toHaveBeenCalled();
  });

  it("buttons are disabled while routes are loading", async () => {
    const p = sheet({ loading: true });
    await render(<RouteSelectionSheet {...p} />);
    await fireEvent.press(screen.getByText("Go now"));
    expect(p.onGoNow).not.toHaveBeenCalled();
  });

  it("the Go now countdown starts navigation by itself after 10 s", async () => {
    jest.useFakeTimers();
    const p = sheet({ countdownRunning: true });
    await render(<RouteSelectionSheet {...p} />);
    await act(async () => {
      jest.advanceTimersByTime(10_500);
    });
    expect(p.onCountdownDone).toHaveBeenCalledTimes(1);
  });
});

describe("with the map in its Dark theme", () => {
  it("the top card and the bottom sheet have no light surfaces or dark-on-light text left", async () => {
    for (const el of [<RouteSelectionTopCard key="t" {...topCard()} />, <RouteSelectionSheet key="s" {...sheet()} />]) {
      const r = await render(<SurfaceScheme value="dark">{el}</SurfaceScheme>);
      const p = paints(r.toJSON() as never);
      expect(p.lightSurfacesLeft).toEqual([]);
      expect(p.lightTextLeft).toEqual([]);
      expect(p.texts.has("#FFFFFF")).toBe(true);
      r.unmount();
    }
  });
});
