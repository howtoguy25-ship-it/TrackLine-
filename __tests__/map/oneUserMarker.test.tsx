// Permanent fix §1 regression: exactly one thing draws the driver (UserArrow's SymbolLayer), in
// every screen state; no native puck / blue dot props anywhere; the arrow shows with and without a
// heading (same shape); the driver's own Tracky is never drawn.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react-native";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const mockLayers: { type: string; id?: string; style?: Record<string, unknown> }[] = [];
jest.mock("@/map-v2/mapbox", () => {
  const React = require("react");
  const make = (type: string) => {
    const C = (p: { id?: string; style?: Record<string, unknown>; children?: unknown }) => {
      mockLayers.push({ type, id: p.id, style: p.style });
      return React.createElement(React.Fragment, null, p.children);
    };
    C.displayName = type;
    return C;
  };
  return { loadMapbox: () => ({ Images: make("Images"), ShapeSource: make("ShapeSource"), SymbolLayer: make("SymbolLayer"), CircleLayer: make("CircleLayer") }) };
});

import { UserArrow, USER_ARROW_ICON, arrowIconExpression } from "@/map-v2/layers/UserArrow";
import { presencesToShow, ON_MY_ARROW_M } from "@/map/presenceFilter";

function srcFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? srcFiles(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("one location marker", () => {
  it("nowhere in the app draws the user except UserArrow (no puck, no UserLocation, no native dot)", () => {
    const offenders = srcFiles("src").filter((f) => /<LocationPuck|<UserLocation|CustomLocationProvider|showsUserLocation|puckBearing|followUserLocation/.test(code(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
    const layers = code(readFileSync("src/map-v2/MapboxLayers.tsx", "utf8"));
    expect(layers.match(/<UserArrow\b/g)).toHaveLength(1);
    // The one MapboxLayers is used by home, preview and navigation alike (no per-state renderer).
    const screens = srcFiles("src").filter((f) => /<MapboxLayers\b/.test(code(readFileSync(f, "utf8"))));
    expect(screens).toEqual([join("src", "screens", "MapScreen.tsx")]);
  });

  it("the lint guard refuses a second renderer", () => {
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const out = spawnSync("node_modules/.bin/eslint", ["--stdin", "--stdin-filename", "src/map-v2/layers/Bad.tsx", "-f", "json"], {
      input: "export const A = (M: { LocationPuck: () => null }) => <M.LocationPuck puckBearingEnabled />;\n",
      encoding: "utf8",
    });
    const messages = (JSON.parse(out.stdout)[0].messages as { message: string }[]).map((m) => m.message).join("\n");
    expect(messages).toMatch(/Only UserArrow draws the driver/);
    expect(messages).toMatch(/No native user dot/);
  }, 60_000);

  it("draws exactly one arrow layer, our bundled arrow, turned to the heading -- with or without a heading", async () => {
    mockLayers.length = 0;
    const at = { latitude: -33.9, longitude: 151 };
    const r = await render(<UserArrow coordinate={at} heading={null} accuracyMeters={10} markerIcon={null} fixTimeMs={1} />);
    await act(async () => {});
    const arrows = () => mockLayers.filter((l) => l.type === "SymbolLayer" && l.id === "me-arrow");
    expect(arrows().length).toBeGreaterThan(0);
    expect(new Set(arrows().map((l) => l.style?.iconImage))).toEqual(new Set([USER_ARROW_ICON]));
    expect(arrows()[0].style?.iconRotate).toEqual(["get", "heading"]);
    mockLayers.length = 0;
    await r.rerender(<UserArrow coordinate={at} heading={90} accuracyMeters={10} markerIcon={null} fixTimeMs={2} />);
    await act(async () => {});
    expect(new Set(arrows().map((l) => l.style?.iconImage))).toEqual(new Set([USER_ARROW_ICON]));
    expect(mockLayers.filter((l) => l.type === "SymbolLayer" && l.id !== "me-arrow")).toEqual([]);
  });

  it("a chosen vehicle falls back to our arrow until its image is ready (never Mapbox's dot)", () => {
    expect(arrowIconExpression("car-arrow:ute")).toEqual(["coalesce", ["image", "car-arrow:ute"], ["image", USER_ARROW_ICON]]);
    expect(arrowIconExpression(null)).toBe(USER_ARROW_ICON);
  });
});

describe("own Tracky never drawn", () => {
  const here = { latitude: -33.9, longitude: 151 };
  const near = (m: number) => -33.9 + m / 111_195;
  const list = [
    { uid: "me", lat: near(200), lng: 151 },
    { uid: "old-guest-me", lat: near(300), lng: 151 },
    { uid: "unknown-on-my-arrow", lat: near(5), lng: 151 },
    { uid: "neighbour", lat: near(400), lng: 151 },
  ];
  it("current uid, earlier uids on this phone, and anything sitting on the arrow are hidden", () => {
    const shown = presencesToShow(list, { ownUid: "me", ownUids: new Set(["old-guest-me"]), blocked: new Set(), here, max: 50 });
    expect(shown.map((p) => p.uid)).toEqual(["neighbour"]);
    expect(ON_MY_ARROW_M).toBe(20);
  });
  it("until we know who you are, none are drawn", () => {
    expect(presencesToShow(list, { ownUid: null, blocked: new Set(), here, max: 50 })).toEqual([]);
  });
});
