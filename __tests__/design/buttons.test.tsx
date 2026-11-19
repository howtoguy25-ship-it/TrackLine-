// The Button family, rendered: every variant draws only colours from its meaning group, every
// control is at least 44x44 to touch, labels are Rubik 600 at 17-18pt, and pressing follows the
// motion rules.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import React from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";
import {
  Button,
  CHIP_HEIGHT,
  Chip,
  FloatingButton,
  MIN_TAP,
  TONE_GROUP,
  VARIANT_GROUP,
  chipColours,
  labelSize,
  type ButtonVariant,
  type FloatingTone,
} from "@/components/ui/Button";
import { PRESS_MS, PRESS_SCALE } from "@/components/ui/PressableScale";
import { APPEAR_MS, APPEAR_RISE } from "@/components/ui/Appear";
import { ICON_SIZE, ICON_STROKE } from "@/components/ui/Icon";
import { ACTIONS, PRESS_DARKEN, allowedColours, type Scheme } from "@/theme/colors";
import { shadow } from "@/theme/tokens";

const mockScheme: { current: Scheme } = { current: "light" };
jest.mock("@/components/ui/uiScheme", () => ({ useUiScheme: () => mockScheme.current, useMapScheme: () => mockScheme.current }));

const VARIANTS = Object.keys(VARIANT_GROUP) as ButtonVariant[];
const TONES = Object.keys(TONE_GROUP) as FloatingTone[];

type Json = { type: string; props: Record<string, unknown>; children: Json[] | null } | string;

/** Every colour a rendered tree paints: backgrounds, borders, text colours and icon strokes. */
function paintedColours(node: Json | Json[] | null, out = new Set<string>()): Set<string> {
  if (!node || typeof node === "string") return out;
  if (Array.isArray(node)) {
    node.forEach((n) => paintedColours(n, out));
    return out;
  }
  const style = StyleSheet.flatten(node.props.style as never) as Record<string, unknown> | undefined;
  // The press shade is black at 0-6%, not a colour of the button.
  const isShade = style?.backgroundColor === "#000000" && style?.position === "absolute";
  if (style && !isShade) {
    for (const k of ["backgroundColor", "color", "borderColor"]) {
      const v = style[k];
      if (typeof v === "string" && v !== "transparent") out.add(v);
    }
  }
  for (const k of ["stroke", "color"]) {
    const v = node.props[k];
    if (typeof v === "string" && v !== "none" && v !== "currentColor" && v !== "transparent") out.add(v);
  }
  paintedColours(node.children, out);
  return out;
}

/** The outermost style (the touchable itself). */
function rootStyle(tree: Json | Json[] | null): Record<string, unknown> {
  const root = Array.isArray(tree) ? tree[0] : tree;
  if (!root || typeof root === "string") return {};
  return (StyleSheet.flatten(root.props.style as never) ?? {}) as Record<string, unknown>;
}

async function tree(el: React.ReactElement) {
  const r = await render(el);
  return r.toJSON() as Json | Json[] | null;
}

afterEach(() => {
  mockScheme.current = "light";
});

describe.each<Scheme>(["light", "dark"])("%s scheme", (scheme) => {
  beforeEach(() => {
    mockScheme.current = scheme;
  });

  it.each(VARIANTS)("Button %s paints only colours from its meaning group", async (variant) => {
    const group = VARIANT_GROUP[variant];
    const allowed = allowedColours(group);
    const colours = paintedColours(await tree(<Button variant={variant} label="Go now" icon="navigate" onPress={() => {}} />));
    expect([...colours].filter((c) => !allowed.has(c))).toEqual([]);
    // ...and actually uses its group (a ghost has no fill, so its blue text is the tell).
    expect(colours.has(ACTIONS[scheme][group].on)).toBe(true);
  });

  it.each(TONES)("FloatingButton %s paints only colours from its meaning group", async (tone) => {
    const allowed = allowedColours(TONE_GROUP[tone]);
    const colours = paintedColours(await tree(<FloatingButton tone={tone} icon="locate" accessibilityLabel="x" onPress={() => {}} />));
    expect([...colours].filter((c) => !allowed.has(c))).toEqual([]);
    expect(colours.has(ACTIONS[scheme][TONE_GROUP[tone]].fill)).toBe(true);
  });

  it.each([false, true])("Chip (selected=%s) paints only alternative / map-control colours", async (selected) => {
    const allowed = new Set([...allowedColours("alternative"), ...allowedColours("mapControl")]);
    for (const onMap of [false, true]) {
      const colours = paintedColours(await tree(<Chip label="Petrol" icon="gas-station" selected={selected} onMap={onMap} onPress={() => {}} />));
      expect([...colours].filter((c) => !allowed.has(c))).toEqual([]);
      expect(colours.has(chipColours(selected, scheme, onMap).background)).toBe(true);
    }
  });
});

describe("tap targets", () => {
  it.each(VARIANTS)("Button %s is at least 44pt tall (with a label) and 44x44 (icon only)", async (variant) => {
    for (const size of ["medium", "large"] as const) {
      const s = rootStyle(await tree(<Button variant={variant} size={size} label="Done" onPress={() => {}} />));
      expect(Number(s.minHeight)).toBeGreaterThanOrEqual(MIN_TAP);
    }
    const icon = rootStyle(await tree(<Button variant={variant} icon="close" accessibilityLabel="Close" onPress={() => {}} />));
    expect(Number(icon.width)).toBeGreaterThanOrEqual(MIN_TAP);
    expect(Number(icon.height)).toBeGreaterThanOrEqual(MIN_TAP);
  });

  it("a FloatingButton can't be made smaller than 44x44, and is 56 by default", async () => {
    expect(rootStyle(await tree(<FloatingButton icon="menu" accessibilityLabel="Menu" />))).toMatchObject({ width: 56, height: 56 });
    const tiny = rootStyle(await tree(<FloatingButton icon="menu" size={30} accessibilityLabel="Menu" />));
    expect(Number(tiny.width)).toBeGreaterThanOrEqual(MIN_TAP);
    expect(Number(tiny.height)).toBeGreaterThanOrEqual(MIN_TAP);
  });

  it("a Chip's touch area reaches 44pt with its slop", async () => {
    const r = await render(<Chip label="Petrol" onPress={() => {}} />);
    const root = r.toJSON() as { props: { hitSlop?: { top: number; bottom: number } } };
    const slop = root.props.hitSlop ?? { top: 0, bottom: 0 };
    expect(CHIP_HEIGHT + slop.top + slop.bottom).toBeGreaterThanOrEqual(MIN_TAP);
    expect(rootStyle(r.toJSON() as Json).borderRadius).toBe(18);
  });
});

describe("shape, type and motion", () => {
  it("primaries are pills, the Menu button has radius 16, chips 18", async () => {
    expect(rootStyle(await tree(<Button label="Go now" onPress={() => {}} />)).borderRadius).toBe(999);
    expect(rootStyle(await tree(<FloatingButton shape="menu" icon="menu" accessibilityLabel="Menu" />)).borderRadius).toBe(16);
  });

  it("floating buttons cast the one shadow, and white map buttons have the hairline", async () => {
    const s = rootStyle(await tree(<FloatingButton tone="map" icon="menu" accessibilityLabel="Menu" />));
    expect(s.boxShadow).toBe("0px 6px 16px rgba(16,24,40,0.12), 0px 1px 3px rgba(16,24,40,0.08)");
    expect(s.borderColor).toBe("rgba(16,24,40,0.06)");
    for (const tier of Object.values(shadow)) expect(tier).toEqual({ boxShadow: s.boxShadow });
  });

  it("labels are 600 weight; 18pt where the fill is lower-contrast, 17-18 elsewhere", () => {
    expect(labelSize("primary", "medium")).toBe(18);
    expect(labelSize("destructiveConfirm", "medium")).toBe(18);
    for (const v of VARIANTS) for (const size of ["medium", "large"] as const) {
      expect(labelSize(v, size)).toBeGreaterThanOrEqual(17);
      expect(labelSize(v, size)).toBeLessThanOrEqual(18);
    }
  });

  it("press is 96% and 6% darker over 120ms; things appear over 180ms with an 8pt rise", () => {
    expect(PRESS_SCALE).toBe(0.96);
    expect(PRESS_DARKEN).toBe(0.06);
    expect(PRESS_MS).toBe(120);
    expect(APPEAR_MS).toBe(180);
    expect(APPEAR_RISE).toBe(8);
  });

  it("icons are one line set at a 1.75 stroke and 24pt", () => {
    expect(ICON_STROKE).toBe(1.75);
    expect(ICON_SIZE).toBe(24);
  });
});
