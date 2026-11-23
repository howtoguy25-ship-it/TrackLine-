// Gap 17: trips measured from real fixes (noise and bad accuracy ignored), too-short trips
// dropped, stats by week / month / all, storage on the phone, and the screen's buttons.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ setOptions: () => {}, navigate: () => {}, goBack: () => {} }) }));
const mockUpdate = jest.fn((_p: unknown) => Promise.resolve());
jest.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ settings: { appearance: "light", distanceUnit: "km", tripHistory: true }, updateSettings: (p: unknown) => mockUpdate(p) }) }));

import { MIN_TRIP_M, TripRecorder, avgKmh, clearTrips, listTrips, metresBetween, periodStart, saveTrip, statsFor, type TripRecord } from "@/trips/tripLog";
import { TripHistoryScreen } from "@/screens/TripHistoryScreen";

const fix = (lat: number, t: number, speed: number | null = 50, acc: number | null = 5, limit: number | null = 50) => ({ latitude: lat, longitude: 151, timeMs: t, speedKmh: speed, accuracyM: acc, limitKmh: limit });
const DEG_PER_100M = 100 / 111_195;

describe("measuring a trip", () => {
  it("adds up the real distance between fixes; moving time, top speed, time over the limit", () => {
    const r = new TripRecorder(0, { mode: "driving", from: "Home", to: "Work" });
    for (let i = 0; i <= 10; i++) r.onFix(fix(-33.9 + i * DEG_PER_100M, i * 7200, i === 5 ? 60 : 50));
    const t = r.finish(80_000, true)!;
    expect(t.distanceM).toBeGreaterThan(990);
    expect(t.distanceM).toBeLessThan(1010);
    expect(t.movingS).toBe(72);
    expect(t.maxKmh).toBe(60);
    expect(t.overLimitS).toBeCloseTo(7, 0);
    expect(t).toMatchObject({ from: "Home", to: "Work", arrived: true, durationS: 80 });
    expect(avgKmh(t)).toBe(50);
  });
  it("ignores GPS jumps and poor-accuracy fixes", () => {
    const r = new TripRecorder(0, { mode: "driving", from: null, to: null });
    r.onFix(fix(-33.9, 0));
    r.onFix(fix(-33.9 + 3 * DEG_PER_100M, 1000)); // 300 m in 1 s = 1080 km/h: noise
    r.onFix(fix(-33.9 + 50 * DEG_PER_100M, 2000, 50, 200)); // 200 m accuracy: ignored
    for (let i = 1; i <= 5; i++) r.onFix(fix(-33.9 + 3 * DEG_PER_100M + i * DEG_PER_100M, 1000 + i * 7200));
    expect(r.finish(60_000, false)!.distanceM).toBeLessThan(520);
  });
  it("a route started and cancelled in the driveway isn't a trip", () => {
    const r = new TripRecorder(0, { mode: "driving", from: null, to: null });
    r.onFix(fix(-33.9, 0));
    r.onFix(fix(-33.9 + (MIN_TRIP_M - 50) / 111_195, 20_000));
    expect(r.finish(30_000, false)).toBeNull();
  });
  it("haversine sanity", () => {
    expect(metresBetween({ latitude: -33.9, longitude: 151 }, { latitude: -33.9 + DEG_PER_100M, longitude: 151 })).toBeCloseTo(100, 0);
  });
});

const trip = (id: string, startMs: number, distanceM: number, movingS: number): TripRecord => ({ id, startMs, endMs: startMs + movingS * 1000, mode: "driving", from: null, to: "X", distanceM, durationS: movingS + 60, movingS, maxKmh: 80, overLimitS: 0, arrived: true });

describe("stats", () => {
  it("week starts Monday; month on the 1st; all counts everything", () => {
    const now = new Date(2026, 10, 25, 12).getTime(); // Wed 25 Nov 2026
    expect(new Date(periodStart("week", now)).getDate()).toBe(23);
    expect(new Date(periodStart("month", now)).getDate()).toBe(1);
    const trips = [trip("a", new Date(2026, 10, 24).getTime(), 10_000, 600), trip("b", new Date(2026, 10, 10).getTime(), 30_000, 1800), trip("c", new Date(2026, 8, 1).getTime(), 5000, 300)];
    expect(statsFor(trips, "week", now)).toMatchObject({ trips: 1, distanceM: 10_000, avgKmh: 60 });
    expect(statsFor(trips, "month", now)).toMatchObject({ trips: 2, distanceM: 40_000, longestM: 30_000 });
    expect(statsFor(trips, "all", now).trips).toBe(3);
  });
  it("stored on the phone, newest first", async () => {
    await clearTrips();
    await saveTrip(trip("1", 1000, 1000, 60));
    await saveTrip(trip("2", 2000, 1000, 60));
    expect((await listTrips()).map((t) => t.id)).toEqual(["2", "1"]);
  });
});

describe("Trip history screen", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUpdate.mockClear();
  });
  it("empty: says so; the toggle changes the setting", async () => {
    const r = await render(<TripHistoryScreen />);
    await act(async () => {});
    expect(r.getByTestId("trips-empty")).toBeTruthy();
    await fireEvent(r.getByTestId("trip-history-switch"), "valueChange", false);
    expect(mockUpdate).toHaveBeenCalledWith({ tripHistory: false });
  });
  it("lists trips with their numbers; delete asks first, then removes it", async () => {
    await saveTrip({ ...trip("t1", Date.now() - 3600_000, 12_300, 1080), to: "Bankstown" });
    const r = await render(<TripHistoryScreen />);
    await act(async () => {});
    expect(r.getByText("To Bankstown")).toBeTruthy();
    const spy = jest.spyOn(Alert, "alert");
    await fireEvent.press(r.getByTestId("trip-t1"));
    const buttons = spy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === "Delete")!.onPress!();
    });
    expect(await listTrips()).toEqual([]);
    expect(r.getByTestId("trips-empty")).toBeTruthy();
    spy.mockRestore();
  });
});
