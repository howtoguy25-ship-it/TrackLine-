// The shared press-animation button forwards presses, honours disabled, and its touchable area
// is the button itself (not a flex:1 child that can collapse to zero height).
import React from "react";
import { Text } from "react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("expo-haptics", () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: "light" } }));

import { PressableScale } from "@/components/ui/PressableScale";
import { componentNameFromHierarchy } from "@/debug/touchDebug";

describe("PressableScale", () => {
  it("calls onPress", async () => {
    const onPress = jest.fn();
    await render(
      <PressableScale onPress={onPress} accessibilityLabel="Go">
        <Text>Go</Text>
      </PressableScale>
    );
    await fireEvent.press(screen.getByLabelText("Go"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("doesn't call onPress when disabled, and isn't stuck disabled otherwise", async () => {
    const onPress = jest.fn();
    const { rerender } = await render(
      <PressableScale onPress={onPress} disabled accessibilityLabel="Go">
        <Text>Go</Text>
      </PressableScale>
    );
    await fireEvent.press(screen.getByLabelText("Go"));
    expect(onPress).not.toHaveBeenCalled();
    await rerender(
      <PressableScale onPress={onPress} accessibilityLabel="Go">
        <Text>Go</Text>
      </PressableScale>
    );
    await fireEvent.press(screen.getByLabelText("Go"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("the touchable element carries the button's own size", async () => {
    await render(
      <PressableScale onPress={() => {}} style={{ width: 58, height: 58 }} accessibilityLabel="Re-centre">
        <Text>x</Text>
      </PressableScale>
    );
    const flat = Object.assign({}, ...[screen.getByLabelText("Re-centre").props.style].flat(Infinity).filter(Boolean));
    expect(flat.width).toBe(58);
    expect(flat.height).toBe(58);
    expect(flat.flex).toBeUndefined();
  });
});

describe("touch debugger naming", () => {
  it("names the most specific app component, skipping host views", () => {
    expect(componentNameFromHierarchy([{ name: "App" }, { name: "MainMenuScreen" }, { name: "MenuRow" }, { name: "View" }])).toBe("MenuRow");
    expect(componentNameFromHierarchy([{ name: "View" }])).toBe("View");
  });
});
