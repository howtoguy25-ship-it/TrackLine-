// Gap item 13: trips with several stops -- the list (add up to 5, reorder, remove), each stop's
// distance and time, "Arriving at stop 1" once, reached stops left out of reroutes; every route
// request carries all the stops (Google Routes, the classic API, Mapbox). Also the root-cause
// fixes found on the way: the classic parser read only the first leg (a route with a stop ended
// at the stop), and Mapbox navigation routes and every reroute dropped the stop.
import React, { createRef } from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@gorhom/bottom-sheet", () => {
  const React = require("react");
  const { View, ScrollView } = require("react-native");
  const Sheet = React.forwardRef(function Sheet(p: { children: React.ReactNode }, _r: unknown) {
    return React.createElement(View, null, p.children);
  });
  return { __esModule: true, default: Sheet, BottomSheetScrollView: ScrollView, BottomSheetView: View };
});

import { addStop, markStop, moveStop, nextStopEvent, removeStop, stopPoints, stopRows, MAX_STOPS, ARRIVING_M, type TripStop } from "@/nav/multiStop";
import { directionsUrl, parseMapboxRoute } from "@/services/mapboxDirections";
import { getRouteChoices, parseRoute, waypointList } from "@/services/directions";
import { throughPointsAhead } from "@/nav/shortcuts";
import { NavOptionsSheet } from "@/screens/NavOptionsSheet";

afterEach(() => {
  jest.restoreAllMocks();
});

// A straight road north from (0, 151), 10 km.
const at = (km: number) => ({ latitude: -34 + km / 111.32, longitude: 151 });
const line = Array.from({ length: 101 }, (_, i) => at(i / 10));
const place = (id: string, km: number) => ({ placeId: id, name: id, location: at(km) });

describe("the stop list", () => {
  it("adds in order, at most 5 still to come", () => {
    let s: TripStop[] = [];
    for (let i = 0; i < 7; i++) s = addStop(s, place(`s${i}`, i + 1));
    expect(s).toHaveLength(MAX_STOPS);
    expect(s.map((x) => x.name)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
  });

  it("moves earlier / later and removes; reached stops stay first and out of the route", () => {
    let s = [place("a", 2), place("b", 4), place("c", 6)].reduce<TripStop[]>((acc, p) => addStop(acc, p), []);
    s = moveStop(s, s[2].id, -1);
    expect(s.map((x) => x.name)).toEqual(["a", "c", "b"]);
    expect(moveStop(s, s[0].id, -1).map((x) => x.name)).toEqual(["a", "c", "b"]);
    s = markStop(s, s[0].id, { reached: true });
    expect(stopPoints(s)).toEqual([at(6), at(4)]);
    s = removeStop(s, s[1].id);
    expect(s.map((x) => x.name)).toEqual(["a", "b"]);
  });

  it("each stop's distance and time from the car; 'Arriving at stop 1' once, then reached", () => {
    let s = [place("Coles", 3), place("Bunnings", 7)].reduce<TripStop[]>((acc, p) => addStop(acc, p), []);
    const rows = stopRows(s, line, 1000, 0.06);
    expect(rows.map((r) => [r.number, r.name, Math.round(r.aheadM / 100) / 10])).toEqual([
      [1, "Coles", 2],
      [2, "Bunnings", 6],
    ]);
    expect(rows[0].etaSeconds).toBe(120);
    expect(nextStopEvent(s, rows)).toBeNull();
    const near = stopRows(s, line, 3000 - ARRIVING_M + 10, 0.06);
    const ev = nextStopEvent(s, near);
    expect(ev).toEqual({ kind: "arriving", id: s[0].id, number: 1, name: "Coles" });
    s = markStop(s, s[0].id, { announced: true });
    expect(nextStopEvent(s, near)).toBeNull();
    const there = stopRows(s, line, 2990, 0.06);
    expect(nextStopEvent(s, there)).toEqual({ kind: "reached", id: s[0].id });
    s = markStop(s, s[0].id, { reached: true });
    expect(stopRows(s, line, 3000, 0.06).map((r) => [r.number, r.name])).toEqual([[1, "Bunnings"]]);
  });
});

describe("every route request carries all the stops", () => {
  it("Mapbox: stops in the coordinates, one bearing per point, one route", () => {
    const url = directionsUrl({ origin: at(0), destination: at(10), waypoints: [at(3), at(7)], heading: 0 }, "pk.test");
    const coords = decodeURIComponent(url.split("/driving-traffic/")[1].split("?")[0]).split(";");
    expect(coords).toHaveLength(4);
    expect(coords[1]).toBe(`151,${at(3).latitude}`);
    expect(new URL(url).searchParams.get("bearings")).toBe("0,45;;;");
    expect(new URL(url).searchParams.get("alternatives")).toBe("false");
  });

  it("Google Routes API: every stop as an intermediate", async () => {
    const calls: { url: string; body: string }[] = [];
    jest.spyOn(global, "fetch").mockImplementation(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return { ok: true, status: 200, json: async () => ({ routes: [] }) } as Response;
    });
    await getRouteChoices(at(0), at(10), { waypoint: [at(3), at(7)] }).catch(() => []);
    const body = JSON.parse(calls.find((c) => c.url.includes("computeRoutes"))!.body);
    expect(body.intermediates).toHaveLength(2);
    expect(body.computeAlternativeRoutes).toBe(false);
    expect(waypointList(at(3))).toEqual([at(3)]);
    expect(waypointList(null)).toEqual([]);
  });

  it("shortcut checks keep every stop, in road order", () => {
    const pts = throughPointsAhead(line, at(0), [at(3), at(7)]);
    const stopsIn = pts.filter((p) => !p.via).map((p) => p.point);
    expect(stopsIn).toEqual([at(3), at(7)]);
  });
});

describe("multi-leg routes are read whole (root-cause fixes)", () => {
  const step = (lat: number, m: number) => ({ html_instructions: "Head <b>north</b>", distance: { value: m }, duration: { value: m / 10 }, start_location: { lat, lng: 151 }, end_location: { lat: lat + 0.01, lng: 151 }, polyline: { points: "" } });
  it("classic API: every leg's steps and the whole trip's distance and time", () => {
    const r = parseRoute({
      overview_polyline: { points: "" },
      legs: [
        { distance: { value: 3000, text: "3 km" }, duration: { value: 300, text: "5 mins" }, steps: [step(-34, 3000)] },
        { distance: { value: 7000, text: "7 km" }, duration: { value: 600, text: "10 mins" }, steps: [step(-33.97, 4000), step(-33.96, 3000)] },
      ],
    });
    expect(r.steps).toHaveLength(3);
    expect(r.distanceMeters).toBe(10000);
    expect(r.durationSeconds).toBe(900);
    expect(r.legs).toEqual([
      { distanceMeters: 3000, durationSeconds: 300 },
      { distanceMeters: 7000, durationSeconds: 600 },
    ]);
  });

  it("Mapbox: every leg's steps and congestion", () => {
    const mb = (type: string, lat: number) => ({ maneuver: { type, location: [151, lat] }, distance: 1000, duration: 60, geometry: "", name: "Main St" });
    const r = parseMapboxRoute({
      distance: 4000,
      duration: 240,
      geometry: "",
      legs: [
        { distance: 2000, duration: 120, steps: [mb("depart", -34), mb("turn", -33.99), mb("arrive", -33.98)], annotation: { congestion: ["low", "heavy"] } },
        { distance: 2000, duration: 120, steps: [mb("depart", -33.98), mb("arrive", -33.97)], annotation: { congestion: ["moderate"] } },
      ],
    });
    expect(r.steps.length).toBeGreaterThanOrEqual(3);
    expect(r.legs).toEqual([
      { distanceMeters: 2000, durationSeconds: 120 },
      { distanceMeters: 2000, durationSeconds: 120 },
    ]);
  });

  it("MapScreen: reroutes (Mapbox, Google, other modes) and the Mapbox nav route pass the stops still to come", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/const rerouteStops = stopWaypointsLiveRef\.current \?\? \[\];/);
    expect(src).toMatch(/getHeadingAwareReroute\(currentLatLng, destinationLatLng, heading, \{\s*\.\.\.avoidRouteOptions\(settings\.routeAvoid\),\s*waypoint: rerouteStops,/);
    expect(src).toMatch(/mapboxReroute\(currentLatLng, destinationLatLng, heading, settings\.routeAvoid, controller\.signal, rerouteStops\)/);
    expect(src).toMatch(/getDirectionsForMode\(currentLatLng, destinationLatLng, travelMode, rerouteStops\)/);
    expect(src).toMatch(/mapboxRouteForChoice\(chosen, currentLatLng, destination\.location, settings\.routeAvoid, heading, stopWaypointsLiveRef\.current \?\? \[\]\)/);
    expect(src).toMatch(/announcePhrase\(\{ kind: "said", text: `Arriving at stop \$\{ev\.number\}, \$\{ev\.name\}` \}\)/);
  });
});

describe("trip sheet: Stops", () => {
  const base = {
    arrivalClockText: "9:42 am", etaText: "24 min", distanceText: "18 km", distanceUnit: "km" as const, destinationName: "Central", events: [],
    loadLeaveTimes: jest.fn(async () => []), onShowMoreTimes: jest.fn(), onOpenSettings: jest.fn(), onRoutes: jest.fn(), onShareDrive: jest.fn(),
    onReportAlert: jest.fn(), onAddStop: jest.fn(), onSoundVoice: jest.fn(), mapViewLabel: "3D", onMapView: jest.fn(), avoidSummary: "None",
    onAvoid: jest.fn(), onHelp: jest.fn(), onOpenDetection: jest.fn(), onOpenMapTools: jest.fn(), onEndNavigation: jest.fn(), onClose: jest.fn(),
  };
  it("each stop with distance and time; up / down / remove do what they say", async () => {
    const onMove = jest.fn();
    const onRemove = jest.fn();
    await render(
      <NavOptionsSheet
        ref={createRef() as never}
        {...base}
        stops={{
          rows: [
            { id: "a", number: 1, name: "Coles", aheadM: 2000, etaSeconds: 180, first: true, last: false },
            { id: "b", number: 2, name: "Bunnings", aheadM: 6000, etaSeconds: 480, first: false, last: true },
          ],
          onMove,
          onRemove,
        }}
      />
    );
    expect(screen.getByTestId("eta-sheet-stop-1")).toHaveTextContent(/Stop 1 · Coles2\.0 km · in 3 mins/);
    await fireEvent.press(screen.getByTestId("eta-sheet-stop-up-2"));
    expect(onMove).toHaveBeenCalledWith("b", -1);
    await fireEvent.press(screen.getByTestId("eta-sheet-stop-down-1"));
    expect(onMove).toHaveBeenCalledWith("a", 1);
    await fireEvent.press(screen.getByTestId("eta-sheet-stop-remove-2"));
    expect(onRemove).toHaveBeenCalledWith("b");
    // First can't move up, last can't move down.
    await fireEvent.press(screen.getByTestId("eta-sheet-stop-up-1"));
    expect(onMove).toHaveBeenCalledTimes(2);
  });
});
