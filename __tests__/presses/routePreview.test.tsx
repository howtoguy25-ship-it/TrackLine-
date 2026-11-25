// Route preview, Waze-style: a white top card (Waze-match §1), and Edit drive / Go now when it came from Plan a drive.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { RouteSelectionSheet, RouteSelectionTopCard, type RouteChoiceRow } from "@/components/RouteSelection";

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
    travelMode: "drive" as const,
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

describe("route preview, Waze-style", () => {
  it("the top card is white over the light map", async () => {
    const r = await render(<RouteSelectionTopCard {...topCard()} />);
    const card = r.getByTestId("route-preview-top");
    const bg = (Array.isArray(card.props.style) ? Object.assign({}, ...card.props.style.flat(3).filter(Boolean)) : card.props.style).backgroundColor;
    expect(bg).toBe("#FFFFFF");
    r.unmount();
  });

  it("from Plan a drive the buttons are Edit drive / Go now; otherwise Leave later / Go now", async () => {
    const onEditDrive = jest.fn();
    const r = await render(<RouteSelectionSheet {...sheet({ onEditDrive })} />);
    expect(r.queryByText("Leave later")).toBeNull();
    await fireEvent.press(r.getByTestId("route-edit-drive"));
    expect(onEditDrive).toHaveBeenCalledTimes(1);
    r.unmount();
    const r2 = await render(<RouteSelectionSheet {...sheet()} />);
    expect(r2.getByTestId("route-leave-later")).toBeTruthy();
    expect(r2.queryByText("Edit drive")).toBeNull();
  });
});

