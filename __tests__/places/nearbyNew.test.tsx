// Nearby petrol / food / hotels / parking: Google Places (New) parsing, filters and sorts, live
// petrol prices matched to stations, one-request drive times, and the results sheet itself
// (skeleton, rows, filters, fuel type, errors, empty reasons, map pins).
import React, { createRef } from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { arrangeResults, parsePlace, typesFor, updatedAgo, formatFuelPrice, type NearbyResult } from "@/places/nearbyNew";
import { pricesFor } from "@/places/fuelPrices";
import { parseMatrix } from "@/places/driveTimes";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/SimpleBottomSheet", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    SimpleBottomSheet: React.forwardRef(function S(props: { children: React.ReactNode; onChange?: (i: number) => void }, ref: unknown) {
      React.useImperativeHandle(ref, () => ({ snapToIndex: (i: number) => props.onChange?.(i), close: () => props.onChange?.(-1) }));
      return React.createElement(View, null, props.children);
    }),
  };
});
const mockSettings = { ...require("@/services/settings").DEFAULT_SETTINGS, preferredFuelType: "91" };
const mockUpdate = jest.fn((patch: object) => Object.assign(mockSettings, patch));
jest.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ settings: mockSettings, updateSettings: mockUpdate }) }));
const mockNearby = jest.fn<(...a: unknown[]) => Promise<NearbyResult[]>>();
jest.mock("@/places/nearbyNew", () => ({
  ...(jest.requireActual("@/places/nearbyNew") as object),
  searchNearbyNew: (...a: unknown[]) => mockNearby(...a),
  searchTextNew: (...a: unknown[]) => mockNearby(...a),
  photoUrl: (n: string) => `https://photo/${n}`,
}));
const mockFuelCheck = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.mock("@/places/fuelPrices", () => ({
  ...(jest.requireActual("@/places/fuelPrices") as object),
  fetchFuelCheck: (...a: unknown[]) => mockFuelCheck(...a),
}));
jest.mock("@/places/driveTimes", () => ({
  ...(jest.requireActual("@/places/driveTimes") as object),
  driveTimesTo: (_o: unknown, d: unknown[]) => Promise.resolve(d.map((_x, i) => 300 + i * 60)),
}));

import { NearbyPlacesSheet, emptyReason } from "@/components/places/NearbyPlacesSheet";

const HERE = { latitude: -33.87, longitude: 151.21 };
const result = (id: string, over: Partial<NearbyResult> = {}): NearbyResult => ({
  placeId: id,
  name: `Place ${id}`,
  address: "1 George St",
  suburb: "Sydney",
  location: { latitude: -33.871, longitude: 151.211 },
  distanceMeters: 150,
  rating: 4.5,
  ratingCount: 120,
  priceLevel: 2,
  openNow: true,
  photoName: null,
  googleFuel: {},
  ...over,
});

describe("parsing Places (New)", () => {
  it("reads name, address, suburb, rating, price level, open now and station prices; nothing guessed", () => {
    const r = parsePlace(
      {
        id: "abc",
        displayName: { text: "Ampol Foodary" },
        shortFormattedAddress: "1 Parramatta Rd, Ashfield",
        addressComponents: [{ types: ["locality"], longText: "Ashfield" }],
        location: { latitude: -33.888, longitude: 151.124 },
        rating: 4.1,
        userRatingCount: 88,
        priceLevel: "PRICE_LEVEL_INEXPENSIVE",
        currentOpeningHours: { openNow: false },
        fuelOptions: { fuelPrices: [{ type: "REGULAR_UNLEADED", price: { units: "1", nanos: 899000000 }, updateTime: "2026-11-17T01:00:00Z" }] },
      },
      HERE
    )!;
    expect(r).toMatchObject({ placeId: "abc", name: "Ampol Foodary", suburb: "Ashfield", rating: 4.1, ratingCount: 88, priceLevel: 1, openNow: false });
    expect(r.googleFuel["91"]).toEqual({ centsPerLitre: 189.9, updatedMs: Date.parse("2026-11-17T01:00:00Z"), source: "Google" });
    expect(r.distanceMeters).toBeGreaterThan(8000);
    const bare = parsePlace({ id: "x", displayName: { text: "X" }, location: { latitude: -33.87, longitude: 151.21 } }, HERE)!;
    expect([bare.rating, bare.priceLevel, bare.openNow, bare.photoName]).toEqual([null, null, null, null]);
    expect(parsePlace({ id: "no-location" }, HERE)).toBeNull();
  });

  it("EV asks for chargers, not petrol stations", () => {
    expect(typesFor("fuel", "ev")).toEqual(["electric_vehicle_charging_station"]);
    expect(typesFor("fuel", "91")).toEqual(["gas_station"]);
  });
});

describe("filters and sorts", () => {
  const list = [result("far", { distanceMeters: 900, rating: 4.8 }), result("near", { distanceMeters: 100, rating: 3.9 }), result("closed", { openNow: false, distanceMeters: 300 })];
  it("distance; open now; top rated", () => {
    expect(arrangeResults(list, { sort: "distance", openNow: false, topRated: false }).map((r) => r.placeId)).toEqual(["near", "closed", "far"]);
    expect(arrangeResults(list, { sort: "distance", openNow: true, topRated: false }).map((r) => r.placeId)).toEqual(["near", "far"]);
    expect(arrangeResults(list, { sort: "distance", openNow: false, topRated: true }).map((r) => r.placeId)).toEqual(["closed", "far"]);
  });
  it("price: cheapest first, unknown prices last", () => {
    const prices: Record<string, number | null> = { far: 179.9, near: null, closed: 185.5 };
    expect(arrangeResults(list, { sort: "price", openNow: false, topRated: false, priceOf: (r) => prices[r.placeId] }).map((r) => r.placeId)).toEqual(["far", "closed", "near"]);
  });
});

describe("prices", () => {
  it("FuelCheck price for a station within 120 m wins; else Google's own; else none", () => {
    const a = result("a", { location: { latitude: -33.8, longitude: 151.2 } });
    const b = result("b", { location: { latitude: -33.9, longitude: 151.3 }, googleFuel: { "91": { centsPerLitre: 195.9, updatedMs: null, source: "Google" } } });
    const c = result("c", { location: { latitude: -34.0, longitude: 151.4 } });
    const fc = [{ code: "1", name: "", brand: "", address: "", lat: -33.8004, lng: 151.2004, centsPerLitre: 182.9, updatedMs: 1 }];
    const m = pricesFor([a, b, c], "91", fc);
    expect(m.get("a")).toEqual({ centsPerLitre: 182.9, updatedMs: 1, source: "FuelCheck" });
    expect(m.get("b")?.source).toBe("Google");
    expect(m.has("c")).toBe(false);
  });
  it('formats "$1.89" and "updated 20 min ago"', () => {
    expect(formatFuelPrice(189.4)).toBe("$1.89");
    expect(updatedAgo(1_000_000 - 20 * 60_000, 1_000_000)).toBe("updated 20 min ago");
    expect(updatedAgo(null)).toBeNull();
  });
});

describe("drive times", () => {
  it("one matrix answer → seconds per place; unroutable places get none", () => {
    expect(parseMatrix([{ destinationIndex: 1, duration: "420s", condition: "ROUTE_EXISTS" }, { destinationIndex: 0, condition: "ROUTE_NOT_FOUND" }], 2)).toEqual([null, 420]);
  });
});

describe("empty reasons", () => {
  it("say why", () => {
    expect(emptyReason("hotels", 0, { openNow: false, topRated: false, q: "", areaLabel: "Near me" })).toBe("No hotels found (near me). Try a wider area.");
    expect(emptyReason("hotels", 4, { openNow: true, topRated: false, q: "", areaLabel: "Near me" })).toBe("None of the 4 hotels found are open now. Turn a filter off to see them.");
  });
});

describe("results sheet", () => {
  beforeEach(() => {
    mockNearby.mockReset();
    mockFuelCheck.mockReset();
    mockUpdate.mockClear();
  });

  async function open(category: "fuel" | "food" | "hotel" | "parking", extra: object = {}) {
    const ref = createRef<{ snapToIndex: (i: number) => void }>();
    const onPinsChange = jest.fn();
    const onViewDetails = jest.fn();
    await render(<NearbyPlacesSheet ref={ref as never} category={category} location={HERE} onViewDetails={onViewDetails} onPinsChange={onPinsChange} {...extra} />);
    await act(async () => ref.current?.snapToIndex(0));
    return { onPinsChange, onViewDetails };
  }

  it("petrol: skeleton, then rows with the live price, drive time, and pins with the price", async () => {
    let resolve: (r: NearbyResult[]) => void = () => {};
    mockNearby.mockReturnValue(new Promise((r) => (resolve = r)));
    mockFuelCheck.mockResolvedValue({ configured: true, stations: [{ code: "1", name: "", brand: "", address: "", lat: -33.871, lng: 151.211, centsPerLitre: 184.9, updatedMs: Date.now() - 20 * 60_000 }] });
    const { onPinsChange, onViewDetails } = await open("fuel");
    expect(screen.getByTestId("nearby-skeleton")).toBeTruthy();
    await act(async () => resolve([result("s1", { name: "Ampol Foodary" })]));
    await waitFor(() => expect(screen.getByText("$1.85")).toBeTruthy());
    expect(screen.getByText("updated 20 min ago")).toBeTruthy();
    expect(screen.getByText("5 mins")).toBeTruthy();
    expect(onPinsChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "s1", label: "$1.85" })]);
    await fireEvent.press(screen.getByTestId("nearby-row-s1"));
    expect(onViewDetails).toHaveBeenCalledWith("s1");
  });

  it("picking a fuel type saves it; area chips ask again with the bigger radius", async () => {
    mockNearby.mockResolvedValue([]);
    mockFuelCheck.mockResolvedValue({ configured: false, stations: [] });
    await open("fuel");
    await waitFor(() => expect(screen.getByTestId("nearby-empty")).toBeTruthy());
    expect(screen.getByText("Live NSW prices aren't set up yet.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("nearby-fuel-diesel"));
    expect(mockUpdate).toHaveBeenCalledWith({ preferredFuelType: "diesel" });
    await act(async () => fireEvent.press(screen.getByTestId("nearby-area-city")));
    await waitFor(() => expect(mockNearby.mock.calls.some((c) => c[2] === 40_000)).toBe(true));
  });

  it("a failed search says why and retries on tap", async () => {
    mockNearby.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValue([result("h1")]);
    await open("hotel");
    await waitFor(() => expect(screen.getByTestId("nearby-error")).toBeTruthy());
    expect(screen.getByTestId("nearby-error")).toHaveTextContent(/Tap to try again/);
    await act(async () => fireEvent.press(screen.getByTestId("nearby-error")));
    await waitFor(() => expect(screen.getByTestId("nearby-row-h1")).toBeTruthy());
  });

  it("rows are 72pt with open / closed and rating; parking offers More filters", async () => {
    mockNearby.mockResolvedValue([result("p1", { openNow: false })]);
    const onMoreFilters = jest.fn();
    await open("parking", { onMoreFilters });
    await waitFor(() => expect(screen.getByText("Closed")).toBeTruthy());
    expect(screen.getByText("★ 4.5 (120)")).toBeTruthy();
    const row = screen.getByTestId("nearby-row-p1");
    const style = Object.assign({}, ...[row.props.style].flat(3).filter(Boolean));
    expect(style.minHeight).toBe(72);
    await fireEvent.press(screen.getByTestId("nearby-more-filters"));
    expect(onMoreFilters).toHaveBeenCalled();
  });
});
