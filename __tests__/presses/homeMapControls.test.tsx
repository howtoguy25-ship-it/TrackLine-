// The home map's floating buttons each call their action -- and stop being tappable once the
// sheet hides them.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("expo-haptics", () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: "light" } }));

import { HomeMapControls } from "@/components/HomeMapControls";

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
    showRecenter: true,
    onRecenter: jest.fn(),
    ...overrides,
  };
}

describe("Home map buttons", () => {
  it.each([
    ["Menu", "onMenu"],
    ["Compass. Tap to face north.", "onCompass"],
    ["Audio player", "onAudioPlayer"],
    ["Sound", "onSound"],
    ["Report something on the road", "onReport"],
    ["Re-centre on my location", "onRecenter"],
  ])("%s calls %s", async (label, handler) => {
    const p = props();
    await render(<HomeMapControls {...(p as unknown as React.ComponentProps<typeof HomeMapControls>)} />);
    await fireEvent.press(screen.getByLabelText(label));
    expect(p[handler as keyof typeof p]).toHaveBeenCalledTimes(1);
  });

  it("the buttons can't be tapped once the sheet is pulled above half height", async () => {
    const p = props({ sheetVisibleHeight: shared(800) });
    await render(<HomeMapControls {...(p as unknown as React.ComponentProps<typeof HomeMapControls>)} />);
    // The whole layer is pointerEvents="none" while faded out.
    const layer = screen.getByLabelText("Menu").parent;
    let node = layer;
    let blocked = false;
    while (node) {
      if (node.props?.pointerEvents === "none") blocked = true;
      node = node.parent;
    }
    expect(blocked).toBe(true);
  });
});
