// Gap 18: EV charger availability from Google (only what the network reports), driver fuel
// prices that never override official ones, and the "Report a price" form.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockCall = jest.fn<(name: string, data: unknown) => Promise<unknown>>();
jest.mock("@/services/callable", () => ({ callFn: (n: string, d: unknown) => mockCall(n, d) }));
jest.mock("@/services/firebase", () => ({ db: {} }));

import { FIELD_MASK, evText, parseEv, type FuelPrice, type NearbyResult } from "@/places/nearbyNew";
import { parsePriceInput, reportAnswerText, stationHere, withDriverPrices } from "@/places/driverFuelPrices";
import { FuelPriceReport } from "@/components/places/FuelPriceReport";

describe("EV availability (Google evChargeOptions)", () => {
  it("asks Google for it", () => {
    expect(FIELD_MASK).toContain("places.evChargeOptions");
  });
  it("live counts when every connector group reports them", () => {
    const ev = parseEv({
      connectorCount: 6,
      connectorAggregation: [
        { type: "EV_CONNECTOR_TYPE_CCS_COMBO_2", maxChargeRateKw: 50, count: 4, availableCount: 2, outOfServiceCount: 1, availabilityLastUpdateTime: "2026-11-23T01:00:00Z" },
        { type: "EV_CONNECTOR_TYPE_TYPE_2", maxChargeRateKw: 22, count: 2, availableCount: 1, availabilityLastUpdateTime: "2026-11-23T01:05:00Z" },
      ],
    })!;
    expect(ev).toMatchObject({ connectors: 6, available: 3, outOfService: 1, maxKw: 50, types: ["CCS2", "Type 2"], updatedMs: Date.parse("2026-11-23T01:05:00Z") });
    expect(evText(ev)).toBe("3 of 6 free · up to 50 kW");
  });
  it("no live data: says so, never a guessed number; not a charger: nothing", () => {
    const ev = parseEv({ connectorCount: 2, connectorAggregation: [{ type: "EV_CONNECTOR_TYPE_TYPE_2", maxChargeRateKw: 7.4, count: 2 }] })!;
    expect(ev.available).toBeNull();
    expect(evText(ev)).toBe("2 connectors · up to 7 kW · live availability not reported");
    expect(parseEv(undefined)).toBeNull();
    expect(parseEv({ connectorCount: 0 })).toBeNull();
  });
});

const station = (id: string, d: number): NearbyResult => ({ placeId: id, name: `S${id}`, address: "", suburb: null, location: { latitude: -33.9, longitude: 151 }, distanceMeters: d, rating: null, ratingCount: null, priceLevel: null, openNow: null, photoName: null, googleFuel: {} });

describe("driver fuel prices", () => {
  it("never replace an official price; only fill gaps", () => {
    const official = new Map<string, FuelPrice>([["a", { centsPerLitre: 189.9, updatedMs: 1, source: "FuelCheck" }]]);
    const drivers = new Map<string, FuelPrice>([
      ["a", { centsPerLitre: 150, updatedMs: 2, source: "Drivers", drivers: 3 }],
      ["b", { centsPerLitre: 192.9, updatedMs: 2, source: "Drivers", drivers: 4 }],
    ]);
    const m = withDriverPrices(official, drivers);
    expect(m.get("a")!.source).toBe("FuelCheck");
    expect(m.get("b")).toMatchObject({ source: "Drivers", drivers: 4 });
  });
  it("you report at the station you're at (within 500 m)", () => {
    expect(stationHere([station("far", 900), station("near", 120)])!.placeId).toBe("near");
    expect(stationHere([station("far", 900)])).toBeNull();
  });
  it("reads the price as typed on a sign", () => {
    expect(parsePriceInput("189.9")).toBe(189.9);
    expect(parsePriceInput("189,9")).toBe(189.9);
    expect(parsePriceInput("1.899")).toBe(189.9);
    expect(parsePriceInput("18")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
  });
  it("the answer says when it'll show", () => {
    expect(reportAnswerText({ confirmed: null, reports: 1, needed: 3 }, "E10")).toBe("Thanks — it shows once 3 drivers report the same price (1 so far today).");
    expect(reportAnswerText({ confirmed: { cents: 189.9, drivers: 3, atMs: 0 }, reports: 3, needed: 3 }, "E10")).toBe("Thanks — E10 here is now 189.9¢, confirmed by 3 drivers.");
  });

  it("the form: opens, needs a sane price, sends to the server, shows its answer; errors are shown", async () => {
    const r = await render(<FuelPriceReport station={station("ChIJabc123", 80)} fuelType="E10" me={{ latitude: -33.9, longitude: 151 }} />);
    await fireEvent.press(r.getByTestId("fuel-report-open"));
    await fireEvent.changeText(r.getByTestId("fuel-report-input"), "18");
    expect(r.getByText("Cents per litre, between 80 and 400.")).toBeTruthy();
    mockCall.mockResolvedValueOnce({ confirmed: null, reports: 2, needed: 3 });
    await fireEvent.changeText(r.getByTestId("fuel-report-input"), "189.9");
    await fireEvent.press(r.getByTestId("fuel-report-send"));
    await act(async () => {});
    expect(mockCall).toHaveBeenCalledWith("reportFuelPrice", expect.objectContaining({ placeId: "ChIJabc123", fuelType: "E10", cents: 189.9 }));
    expect(r.getByTestId("fuel-report-done").props.children).toMatch(/2 so far/);
    await fireEvent.press(r.getByTestId("fuel-report-close"));
    await fireEvent.press(r.getByTestId("fuel-report-open"));
    mockCall.mockRejectedValueOnce(new Error("Report prices when you're at the station."));
    await fireEvent.changeText(r.getByTestId("fuel-report-input"), "189.9");
    await fireEvent.press(r.getByTestId("fuel-report-send"));
    await act(async () => {});
    expect(r.getByTestId("fuel-report-error").props.children).toBe("Report prices when you're at the station.");
  });
});
