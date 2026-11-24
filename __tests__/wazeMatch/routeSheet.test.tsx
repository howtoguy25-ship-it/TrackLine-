// Waze-match §1-2: route preview card, clean preview map, "Via" text, list rows, fit at both
// sheet heights.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { RouteSelectionSheet, RouteSelectionTopCard, type RouteChoiceRow } from "@/components/RouteSelection";
import { travelledRoads, viaText, suburbNear } from "@/map/viaText";
import { overlaysFor } from "@/map/previewOverlays";
import { bubbleSize, boundsOf, previewEdgePadding, projectFitted } from "@/nav/previewCamera";
import { screenBubbleAnchors } from "@/map/routeChoices";
import { ACTIONS } from "@/theme/colors";

const flat = (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...(style as unknown[]).flat(3).filter(Boolean)) : (style as Record<string, unknown>));
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
function step(name: string | undefined, metres: number, from: [number, number], to: [number, number]) {
  return { targetStreetName: name, distanceMeters: metres, startLocation: at(...from), endLocation: at(...to) };
}

describe("Via text: the two main named roads + their suburbs", () => {
  // A drive through Punchbowl and Lakemba (Sydney), Google-style steps (each names its own road).
  const google = [
    step("Wattle St", 1800, [-33.925, 151.05], [-33.93, 151.056]),
    step("Short Ln", 120, [-33.93, 151.056], [-33.931, 151.057]),
    step("Punchbowl Rd", 2400, [-33.928, 151.066], [-33.921, 151.078]),
    step(undefined, 40, [-33.921, 151.078], [-33.921, 151.079]),
  ];

  it("picks the roads with the most distance, in driving order, with the suburb each is in", () => {
    const via = viaText(google, "google", (lat, lng) => (lng < 151.06 ? "Punchbowl" : "Lakemba"));
    expect(via).toBe("Via Wattle St Punchbowl; Punchbowl Rd Lakemba");
  });

  it("Mapbox steps name the road at their end, so the road travelled is the previous step's", () => {
    const mapbox = [
      step("Wattle St", 10, [-33.925, 151.05], [-33.925, 151.05]), // depart onto Wattle St
      step("Punchbowl Rd", 1800, [-33.925, 151.05], [-33.93, 151.056]), // along Wattle St, then turn
      step(undefined, 2400, [-33.928, 151.066], [-33.921, 151.078]), // along Punchbowl Rd, arrive
    ];
    expect(travelledRoads(mapbox, "mapbox")).toEqual([null, "Wattle St", "Punchbowl Rd"]);
    expect(viaText(mapbox, "mapbox", () => null)).toBe("Via Wattle St; Punchbowl Rd");
  });

  it("no named roads -> null (the row falls back to the provider's own summary)", () => {
    expect(viaText([step(undefined, 500, [0, 0], [0, 0.01])], "google")).toBeNull();
  });

  it("suburbs come from the official ABS centres; nothing outside Australia", () => {
    expect(suburbNear(-33.93, 151.055)).toBe("Punchbowl");
    expect(suburbNear(-33.921, 151.076)).toBe("Lakemba");
    expect(suburbNear(51.5, -0.12)).toBeNull();
  });
});

describe("clean preview map", () => {
  const pins = [{ id: "alert:1" }, { id: "road-sign:tl:2" }, { id: "saved:home" }];
  it("route preview: no pins, no Trackys, no POI badges", () => {
    expect(overlaysFor("routePreview", { pins, presences: [{ uid: "x" }], badges: true })).toEqual({ pins: [], presences: [], badges: false });
  });
  it("home keeps everything; the approach close-up keeps only alerts", () => {
    expect(overlaysFor("home", { pins, presences: [1], badges: true }).pins).toHaveLength(3);
    expect(overlaysFor("approach", { pins, presences: [1], badges: true })).toEqual({ pins: [{ id: "alert:1" }], presences: [], badges: true });
  });
});

describe("top card", () => {
  const props = {
    originLabel: "Your location",
    destinationLabel: "Westfield Bankstown",
    onBack: jest.fn(),
    onEditOrigin: jest.fn(),
    onEditDestination: jest.fn(),
    onSwap: jest.fn(),
    avoidLabel: "Avoid",
    avoidActive: false,
    onOpenAvoid: jest.fn(),
    travelMode: "drive" as const,
    onOpenMode: jest.fn(),
  };
  it("white card, 'Your location' to the destination, swap, and a blue 'Avoid' pill", async () => {
    const r = await render(<RouteSelectionTopCard {...props} />);
    expect(flat(r.getByTestId("route-preview-top").props.style).backgroundColor).toBe("#FFFFFF");
    expect(r.getByText("Your location")).toBeTruthy();
    expect(r.getByText("Westfield Bankstown")).toBeTruthy();
    expect(r.getByLabelText(/^Swap:/)).toBeTruthy();
    expect(flat(r.getByText("Avoid").props.style).color).toBe(ACTIONS.light.alternative.on);
    r.unmount();
  });
});

describe("route sheet", () => {
  const rows: RouteChoiceRow[] = [
    { key: "a", timeText: "12 min", distanceText: "5.5 km", title: "Via Wattle St Punchbowl; Punchbowl Rd Lakemba", subtitle: "Best route, Typical traffic" },
    { key: "b", timeText: "13 min", distanceText: "6.1 km", title: "Via Canterbury Rd Belmore", subtitle: "Alternative route" },
  ];
  const base = {
    rows,
    selectedIndex: 0,
    loading: false,
    errorText: null,
    loadingText: "Finding the best routes…",
    onLeaveLater: jest.fn(),
    onGoNow: jest.fn(),
    countdownRunning: false,
    onCountdownDone: jest.fn(),
    hasStop: false,
  };

  it("collapsed: time + distance, one-line Via, grey summary, separator, Leave later + Go now", async () => {
    const r = await render(<RouteSelectionSheet {...base} onSelect={jest.fn()} />);
    expect(r.getByText("12 min")).toBeTruthy();
    expect(r.getByText("5.5 km")).toBeTruthy();
    expect(r.getByText(rows[0].title!).props.numberOfLines).toBe(1);
    expect(r.getByText("Best route, Typical traffic")).toBeTruthy();
    expect(flat(r.getByTestId("route-footer").props.style).borderTopWidth).toBeGreaterThan(0);
    expect(r.getByTestId("route-leave-later")).toBeTruthy();
    r.unmount();
  });

  it("pulled up: every route, Via on up to 2 lines; tapping a row selects it", async () => {
    const onSelect = jest.fn();
    const r = await render(<RouteSelectionSheet {...base} onSelect={onSelect} />);
    await fireEvent.press(r.getByText("12 min")); // tap the summary to pull up
    const vias = r.getAllByTestId("route-row-via");
    expect(vias).toHaveLength(2);
    for (const v of vias) expect(v.props.numberOfLines).toBe(2);
    await fireEvent.press(r.getByText("13 min"));
    expect(onSelect).toHaveBeenCalledWith(1);
    r.unmount();
  });

  it("the map refits to both sheet heights (padding follows the sheet)", () => {
    const collapsed = previewEdgePadding(180, 260);
    const expanded = previewEdgePadding(180, 520);
    expect(expanded.bottom - collapsed.bottom).toBe(260);
    expect(collapsed.top).toBe(expanded.top);
  });
});

describe("time bubbles never overlap (real sizes)", () => {
  // Root cause: placement assumed every bubble is 84 x 40, but the selected one carries a second
  // line ("Best") and is ~60 tall, and "1 h 12 min" is wider than 84 -- so two could still touch.
  it("the selected bubble is taller and long times are wider", () => {
    expect(bubbleSize("12 min", true)).toEqual({ width: 84, height: 60 });
    expect(bubbleSize("1 h 12 min", false).width).toBeGreaterThan(84);
  });
  it("placed with their real sizes, no two bubble boxes overlap", () => {
    const line = (lat: number) => Array.from({ length: 30 }, (_, i) => ({ latitude: lat - i * 0.0004, longitude: 151.0 + i * 0.003 }));
    const lines = [line(-33.9), line(-33.9006), line(-33.9012)];
    const viewport = { width: 390, height: 844 };
    const padding = previewEdgePadding(216, 263);
    const fitPoints = lines.flat();
    const sizes = [bubbleSize("12 min", true), bubbleSize("1 h 13 min", false), bubbleSize("14 min", false)];
    const anchors = screenBubbleAnchors(lines, 0, fitPoints, viewport, padding, undefined, 6, sizes);
    const fit = boundsOf(fitPoints)!;
    const boxes = anchors
      .map((a, i) => (a ? { p: projectFitted([a], fit, viewport, padding)[0], z: sizes[i] } : null))
      .filter((b): b is { p: { x: number; y: number }; z: { width: number; height: number } } => !!b)
      .map(({ p, z }) => ({ x0: p.x - z.width / 2, x1: p.x + z.width / 2, y0: p.y - z.height, y1: p.y }));
    expect(anchors[0]).not.toBeNull(); // the selected route always gets its bubble
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);
      }
  });
});
