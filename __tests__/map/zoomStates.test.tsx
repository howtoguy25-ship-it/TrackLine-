// Map polish §2: three zoom states for every report -- full pin (z >= 15), 60% icon + count badges
// for overlaps (z 12-15), coloured dot (z < 12, max 60, most important first).
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { dotColour, layoutPins, midPinIcon, pinState, MAX_DOTS, MID_SCALE } from "@/map/zoomStates";
import { iconView } from "@/map-v2/layers/MapIcons";
import { MAP_DOT } from "@/theme/colors";

const centre = { latitude: -33.87, longitude: 151.2 };
const view = (zoom: number) => ({ zoom, latitudeDelta: 360 / 2 ** zoom, screenHeight: 800, centre });
const pt = (id: string, dLat: number, type = "hazard", item: string | null = null) => ({ id, lat: centre.latitude + dLat, lng: centre.longitude, type, item });

describe("zoom states", () => {
  it("close from 15, mid 12-15, far below 12", () => {
    expect([pinState(17), pinState(15), pinState(14.9), pinState(12), pinState(11.9)]).toEqual(["close", "close", "mid", "mid", "far"]);
  });

  it("close: every report as its full pin", () => {
    const l = layoutPins([pt("a", 0), pt("b", 0.00001)], view(16));
    expect(l.singles.map((s) => [s.point.id, s.scale])).toEqual([["a", 1], ["b", 1]]);
    expect(l.clusters).toEqual([]);
  });

  it("mid: 60% icons, and ones that would overlap on screen become one count badge", () => {
    const l = layoutPins([pt("a", 0), pt("b", 0.00005), pt("c", 0.00007), pt("far", 0.05)], view(13));
    expect(l.clusters).toHaveLength(1);
    expect(l.clusters[0].count).toBe(3);
    expect(l.clusters[0].ids.sort()).toEqual(["a", "b", "c"]);
    expect(l.singles.map((s) => [s.point.id, s.scale])).toEqual([["far", MID_SCALE]]);
    expect(midPinIcon("alert:crash")).toBe("alert-mid:crash");
  });

  it("far: dots coloured by meaning, at most 60, crashes / closures / police first", () => {
    expect([dotColour("police"), dotColour("crash"), dotColour("hazard", "closures"), dotColour("hazard"), dotColour("hazard", "roadwork"), dotColour("camera")]).toEqual(["police", "red", "red", "amber", "amber", "camera"]);
    const many = [...Array.from({ length: 70 }, (_, i) => pt(`h${i}`, i * 0.001)), pt("crash", 0.5, "crash"), pt("cop", 0.6, "police")];
    const l = layoutPins(many, view(10));
    expect(l.dots).toHaveLength(MAX_DOTS);
    expect(l.dots.slice(0, 2).map((d) => d.point.id)).toEqual(["crash", "cop"]);
    expect(l.singles).toEqual([]);
  });

  it("the drawings: a pointer-less badge at mid zoom, a ringed dot far out", async () => {
    await render(<>{iconView("dot:police")}</>);
    expect(screen.getByTestId("map-dot-police")).toHaveStyle({ backgroundColor: MAP_DOT.police, width: 10 });
    expect(iconView("alert-mid:crash")).not.toBeNull();
  });
});
