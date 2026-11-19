// Starting a drive with no internet: the route sheet says the route is a saved one and Go now works.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { RouteSelectionSheet } from "@/components/RouteSelection";

const props = {
  rows: [{ key: "a", timeText: "5 min", distanceText: "2.5 km", title: "Via Stacey St", subtitle: "Best route" }],
  selectedIndex: 0,
  onSelect: jest.fn(),
  loading: false,
  errorText: null,
  loadingText: "Finding the best routes…",
  countdownRunning: false,
  onCountdownDone: jest.fn(),
  hasStop: false,
};

describe("offline start", () => {
  it("a saved route shows the offline note and Go now still works", async () => {
    const onGoNow = jest.fn();
    await render(<RouteSelectionSheet {...props} notice="No internet. Using the route saved today; traffic isn't live." onGoNow={onGoNow} />);
    // (The note sits inside the swipe area, which the test renderer's queries don't search into.)
    expect(JSON.stringify(screen.toJSON())).toContain("No internet. Using the route saved today; traffic isn't live.");
    await fireEvent.press(screen.getByText("Go now"));
    expect(onGoNow).toHaveBeenCalledTimes(1);
  });
});
