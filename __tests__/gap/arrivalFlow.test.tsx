// Gap item 12: the arrival flow -- car parks near the destination from 1 km out (real OSM car
// parks, nearest to the destination, max 3, within 600 m), in the trip sheet with Go / loading /
// error + Try again; after parking at one, "Walk 180 m to <place>" on the arrival card.
import React, { createRef } from "react";
import { describe, expect, it, jest } from "@jest/globals";
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

import { isParkingPlace, rankParking, shouldOfferParking, walkLeft, PARKING_PROMPT_M } from "@/nav/arrivalFlow";
import { NavOptionsSheet } from "@/screens/NavOptionsSheet";
import { ArrivedCard } from "@/components/ArrivedCard";

const dest = { latitude: -33.8688, longitude: 151.2093 };
const north = (m: number) => ({ latitude: dest.latitude + m / 111_320, longitude: dest.longitude });
const place = (id: string, m: number) => ({ placeId: id, name: `Car park ${id}`, vicinity: `${id} St`, location: north(m) });

describe("arrival flow rules", () => {
  it("offered from 1 km out, once, not when you're already going to a car park", () => {
    const d = { placeId: "p1", name: "Opera House" };
    expect(shouldOfferParking(PARKING_PROMPT_M + 1, d, false)).toBe(false);
    expect(shouldOfferParking(PARKING_PROMPT_M, d, false)).toBe(true);
    expect(shouldOfferParking(400, d, true)).toBe(false);
    expect(shouldOfferParking(400, { placeId: "x", name: "Wilson Car Park" }, false)).toBe(false);
    expect(isParkingPlace({ placeId: "parking", name: "Your car" })).toBe(true);
    expect(shouldOfferParking(null, d, false)).toBe(false);
  });

  it("nearest to the destination first, at most 3, none further than 600 m", () => {
    const ranked = rankParking(dest, [place("far", 900), place("b", 300), place("a", 120), place("c", 450), place("d", 590)]);
    expect(ranked.map((r) => r.placeId)).toEqual(["a", "b", "c"]);
    expect(ranked[0].toDestinationM).toBeCloseTo(120, 0);
  });

  it("the walk left after parking; none when you parked right there", () => {
    expect(walkLeft(north(180), { name: "Opera House", location: dest })).toMatchObject({ name: "Opera House", metres: 180 });
    expect(walkLeft(north(20), { name: "Opera House", location: dest })).toBeNull();
    expect(walkLeft(null, { name: "x", location: dest })).toBeNull();
  });
});

describe("trip sheet: Parking near …", () => {
  const base = {
    arrivalClockText: "9:42 am",
    etaText: "4 min",
    distanceText: "900 m",
    distanceUnit: "km" as const,
    destinationName: "Opera House",
    events: [],
    loadLeaveTimes: jest.fn(async () => []),
    onShowMoreTimes: jest.fn(),
    onOpenSettings: jest.fn(),
    onRoutes: jest.fn(),
    onShareDrive: jest.fn(),
    onReportAlert: jest.fn(),
    onAddStop: jest.fn(),
    onSoundVoice: jest.fn(),
    mapViewLabel: "3D",
    onMapView: jest.fn(),
    avoidSummary: "None",
    onAvoid: jest.fn(),
    onHelp: jest.fn(),
    onOpenDetection: jest.fn(),
    onOpenMapTools: jest.fn(),
    onEndNavigation: jest.fn(),
    onClose: jest.fn(),
  };

  it("lists the car parks with their distance to the destination; Go picks one", async () => {
    const onGo = jest.fn();
    await render(<NavOptionsSheet ref={createRef() as never} {...base} parking={{ state: "ready", near: "Opera House", offers: [{ placeId: "a", name: "Wilson Parking", toDestinationM: 180 }], onGo }} />);
    expect(screen.getByText("Parking near Opera House")).toBeTruthy();
    expect(screen.getByText("180 m from Opera House")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("eta-sheet-parking-go-a"));
    expect(onGo).toHaveBeenCalledWith("a");
  });

  it("loading, none mapped, and an error with Try again", async () => {
    const onRetry = jest.fn();
    await render(<NavOptionsSheet ref={createRef() as never} {...base} parking={{ state: "loading", near: "Opera House" }} />);
    expect(screen.getByTestId("eta-sheet-parking-loading")).toBeTruthy();
    await render(<NavOptionsSheet ref={createRef() as never} {...base} parking={{ state: "ready", near: "Opera House", offers: [], onGo: jest.fn() }} />);
    expect(screen.getByTestId("eta-sheet-parking-none")).toHaveTextContent("No car parks mapped near there");
    await render(<NavOptionsSheet ref={createRef() as never} {...base} parking={{ state: "error", near: "Opera House", message: "no answer in 10 s", onRetry }} />);
    expect(screen.getByTestId("eta-sheet-parking-error")).toHaveTextContent("Couldn't find car parks: no answer in 10 s");
    await fireEvent.press(screen.getByTestId("eta-sheet-parking-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("not offered (more than 1 km out): no section", async () => {
    await render(<NavOptionsSheet ref={createRef() as never} {...base} parking={null} />);
    expect(screen.queryByTestId("eta-sheet-parking")).toBeNull();
  });
});

describe("arrival card: the walk", () => {
  const arrival = { name: "Wilson Parking", arrivedAtMs: 1_800_000_000_000, location: north(180), address: null };
  it("'Walk 180 m to Opera House' starts the walk", async () => {
    const onPress = jest.fn();
    await render(<ArrivedCard arrival={arrival} bottom={0} onRate={jest.fn()} onPark={null} onDone={jest.fn()} walk={{ label: "Walk 180 m to Opera House", onPress }} />);
    await fireEvent.press(screen.getByTestId("arrived-walk"));
    expect(onPress).toHaveBeenCalled();
  });
  it("no walk offered: no button", async () => {
    await render(<ArrivedCard arrival={arrival} bottom={0} onRate={jest.fn()} onPark={null} onDone={jest.fn()} />);
    expect(screen.queryByTestId("arrived-walk")).toBeNull();
  });
});

describe("MapScreen wiring", () => {
  it("fetches real car parks once at 1 km, remembers where you were going, walks you there", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/withTimeout\(searchNearbyOsmPlaces\(nearLocation, "parking", undefined, PARKING_NEAR_M\), 10_000, "Car parks"\)/);
    expect(src).toMatch(/shouldOfferParking\(remainingDistanceMeters, navDestinationPlace, arrivalParking\?\.key === arrivalParkingKey\)/);
    expect(src).toMatch(/setWalkAfterParking\(\{ name: going\.name/);
    expect(src).toMatch(/goInsteadDuringNav\(\{ placeId: o\.placeId/);
    expect(src).toMatch(/walkTo\(\{ placeId: `walk-/);
    expect(src).toMatch(/parking=\{parkingSection\}/);
  });
});
