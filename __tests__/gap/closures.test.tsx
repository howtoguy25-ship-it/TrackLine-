// Gap item 14: detailed road closures -- direction, lanes and how long on the report (checked and
// kept by the server, "how long" sets the lifetime), the details in the ahead banner, one-way
// closures only for drivers going that way, the closed stretch on the route, and a full closure
// routed around (Mapbox exclude=point), never for a one-direction official closure.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { closedStretch, closureForReport, closureLine, shouldRouteAround, DEFAULT_CLOSURE, type ClosureDetails } from "@/nav/closures";
import { aheadSourcesFrom } from "@/nav/ahead/aheadSources";
import { aheadOf, projectFeed } from "@/nav/ahead/aheadFeed";
import { aheadSubtitle } from "@/nav/ahead/aheadText";
import { directionsUrl } from "@/services/mapboxDirections";
import { ClosureDetailsPicker } from "@/components/ClosureDetailsPicker";
const server = require("../../firebase/functions/reports/core.js");

const at = (km: number) => ({ latitude: -34 + km / 111.32, longitude: 151 });
const north = Array.from({ length: 41 }, (_, i) => at(i / 10)); // 4 km heading north (bearing 0)
const south = north.slice().reverse();

describe("server", () => {
  const base = { type: "hazard", item: "closures", at: { lat: -33.9, lng: 151.2 }, from: { lat: -33.9, lng: 151.2 }, region: "NSW" };
  it("keeps valid details; 'how long' sets the lifetime", () => {
    const input = server.validateInput({ ...base, closure: { direction: "both", lanes: "all", until: "1h" } });
    expect(input.closure).toEqual({ direction: "both", lanes: "all", until: "1h" });
    expect(input.customTtlMs).toBe(60 * 60_000);
    expect(server.validateInput({ ...base, closure: { direction: "mine", lanes: "some", until: "days", bearingDeg: 182.4 } }).closure).toEqual({ direction: "mine", lanes: "some", until: "days", bearingDeg: 182 });
  });
  it("drops anything not valid, and details on anything but a closure", () => {
    expect(server.validateInput({ ...base, closure: { direction: "sideways", lanes: "all", until: "1h" } }).closure).toBeNull();
    expect(server.validateInput({ ...base, closure: { direction: "mine", lanes: "all", until: "1h" } }).closure).toBeNull(); // "mine" with no bearing
    expect(server.validateInput({ ...base, item: "roadwork", closure: { direction: "both", lanes: "all", until: "1h" } }).closure).toBeNull();
  });
});

describe("the report", () => {
  it("asks which way, how much and how long", async () => {
    const onChange = jest.fn();
    await render(<ClosureDetailsPicker value={DEFAULT_CLOSURE} onChange={onChange} />);
    await fireEvent.press(screen.getByText("My direction"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_CLOSURE, direction: "mine" });
    await fireEvent.press(screen.getByText("Some lanes"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_CLOSURE, lanes: "some" });
    await fireEvent.press(screen.getByText("Today"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_CLOSURE, until: "today" });
  });
  it("'My direction' sends the way you're driving; with no heading it's sent as both ways (never guessed)", () => {
    expect(closureForReport({ direction: "mine", lanes: "all", until: "1h" }, 271.6)).toEqual({ direction: "mine", lanes: "all", until: "1h", bearingDeg: 272 });
    expect(closureForReport({ direction: "mine", lanes: "all", until: "1h" }, null)).toEqual({ direction: "both", lanes: "all", until: "1h" });
  });
});

describe("while driving", () => {
  const report = (closure: ClosureDetails) => ({ id: "c1", closure, createdAt: 0 });
  const feature = { key: "alert:c1", item: "closures" as const, lat: at(2).latitude, lng: at(2).longitude };
  it("a closure one way only applies to drivers going that way", () => {
    const oneWay = aheadSourcesFrom([feature], [report({ direction: "mine", lanes: "all", until: "today", bearingDeg: 0 })], []);
    expect(projectFeed(oneWay, north).map((a) => a.key)).toEqual(["alert:c1"]);
    expect(projectFeed(oneWay, south)).toEqual([]);
    const both = aheadSourcesFrom([feature], [report({ direction: "both", lanes: "all", until: "today" })], []);
    expect(projectFeed(both, south)).toHaveLength(1);
  });
  it("the banner says how it's closed", () => {
    const [a] = aheadOf(projectFeed(aheadSourcesFrom([feature], [report({ direction: "mine", lanes: "all", until: "today", bearingDeg: 0 })], []), north), 0);
    expect(closureLine(a.closure)).toBe("One direction · All lanes · Today");
    expect(aheadSubtitle(a, null, "km", 0)).toMatch(/^One direction · All lanes · Today/);
  });
  it("the closed stretch: 120 m each side of it, along the route", () => {
    const line = closedStretch(north, 2000);
    expect(line.length).toBeGreaterThan(1);
    expect((line[line.length - 1].latitude - line[0].latitude) * 111_320).toBeCloseTo(240, -1);
  });
  it("routed around: drivers' all-lane closures and official ones that aren't one-way only", () => {
    expect(shouldRouteAround({ kind: "closure", source: "community", closure: { direction: "both", lanes: "all", until: "1h" } })).toBe(true);
    expect(shouldRouteAround({ kind: "closure", source: "community", closure: { direction: "both", lanes: "some", until: "1h" } })).toBe(false);
    expect(shouldRouteAround({ kind: "closure", source: "official", officialText: "Road closed in both directions" })).toBe(true);
    expect(shouldRouteAround({ kind: "closure", source: "official", officialText: "Closed northbound" })).toBe(false);
    expect(shouldRouteAround({ kind: "crash", source: "official" })).toBe(false);
  });
  it("Mapbox is asked to keep clear of the closure, alongside the Avoid settings", () => {
    const url = new URL(directionsUrl({ origin: at(0), destination: at(4), avoid: { tolls: true }, avoidPoints: [at(2)] }, "pk.test"));
    expect(url.searchParams.get("exclude")).toBe(`toll,point(151.000000 ${at(2).latitude.toFixed(6)})`);
  });
  it("MapScreen: picker on a closure report, details sent, stretch drawn, routed around once", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/\{placingItem === "closures" \? <ClosureDetailsPicker value=\{closureDraft\} onChange=\{setClosureDraft\} \/> : null\}/);
    expect(src).toMatch(/closure: item === "closures" \? closureForReport\(closureDraft, headingTrack\.filter\.shown \?\? null\) : null/);
    expect(src).toMatch(/closedStretches=\{closedStretches\}/);
    expect(src).toMatch(/closuresTriedRef\.current\.add\(c\.key\)/);
    expect(src).toMatch(/if \(near && near\.offM < 40\) return;/);
  });
});
