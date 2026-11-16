// Report card, app side: "Still there?" rules, the 3 s Undo bar, reporting through the server
// (and its fallback until deployed), the saved-place popup, parking spot and the Tracky bubble.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { stillThereCandidate } from "@/alerts/stillThere";
import { REPORT_POLICY, UNDO_MS, stillThereWindow } from "@/types/alertPolicy";
import type { AlertDoc } from "@/types/alert";
import { collectApproachFeatures } from "@/alerts/collectFeatures";
import { DEFAULT_SETTINGS } from "@/services/settings";
import { savedPinPlaces } from "@/map/savedPins";
import { getParkingSpot, setParkingSpot, clearParkingSpot } from "@/services/parkingSpot";

const mockCallable = jest.fn<(name: string, data: unknown) => Promise<{ data: unknown }>>();
jest.mock("@firebase/functions", () => ({ httpsCallable: (_f: unknown, name: string) => (data: unknown) => mockCallable(name, data) }));
const mockAddDoc = jest.fn(() => Promise.resolve({ id: "direct1" }));
const mockDeleteDoc = jest.fn(() => Promise.resolve());
jest.mock("firebase/firestore", () => ({
  ...require("../support/stubs").stubService(),
  addDoc: (...a: unknown[]) => (mockAddDoc as (...x: unknown[]) => unknown)(...a),
  deleteDoc: (...a: unknown[]) => (mockDeleteDoc as (...x: unknown[]) => unknown)(...a),
  collection: () => ({}),
  doc: () => ({}),
  serverTimestamp: () => 0,
  Timestamp: { fromMillis: (m: number) => ({ toMillis: () => m }) },
}));
jest.mock("@/components/trackys/Tracky", () => ({ Tracky: () => null }));

import { submitReport, undoReport, ReportRefused } from "@/services/alerts";
import { ReportUndoBar } from "@/components/ReportUndoBar";
import { SavedPlacePopup, type SavedPinPlace } from "@/components/SavedPlacePopup";
import { TrackyBubble, presenceAgeText } from "@/components/TrackyBubble";

const MIN = 60_000;
const CAR = { latitude: -33.87, longitude: 151.2 };
const ahead = (m: number) => ({ lat: -33.87 + m / 111_320, lng: 151.2 });
const alert = (over: Partial<AlertDoc> = {}): AlertDoc =>
  ({ id: "a1", type: "police", ...ahead(200), geohash: "g", createdBy: "someone", createdAt: 0, expiresAt: 999 * MIN, confirmCount: 0, denyCount: 0, hiddenBy: {}, ...over }) as AlertDoc;
const base = { nowMs: 30 * MIN, uid: "me", position: CAR, headingDeg: 0, speedKmh: 50, navBusy: false, alreadyAsked: new Set<string>() };

describe("Still there?", () => {
  it("asks once the type's window has passed, not before", () => {
    const w = stillThereWindow("police").askAfterMs;
    expect(stillThereCandidate([alert()], { ...base, nowMs: w - 1 })).toBeNull();
    expect(stillThereCandidate([alert()], { ...base, nowMs: w })?.id).toBe("a1");
  });
  it("each type has its own window", () => {
    const at = 12 * MIN; // past police (10) and emergency (5), before hazard (20) / camera (30)
    expect(stillThereCandidate([alert({ type: "emergency_vehicle" })], { ...base, nowMs: at })).not.toBeNull();
    expect(stillThereCandidate([alert({ type: "hazard" })], { ...base, nowMs: at })).toBeNull();
    expect(stillThereCandidate([alert({ type: "camera" })], { ...base, nowMs: at })).toBeNull();
  });
  it("re-asks only that long after someone last said Still here", () => {
    expect(stillThereCandidate([alert({ lastConfirmedAt: 25 * MIN })], base)).toBeNull();
    expect(stillThereCandidate([alert({ lastConfirmedAt: 15 * MIN })], base)).not.toBeNull();
  });
  it("never asks the reporter, never twice, never behind or far away, never while parked", () => {
    expect(stillThereCandidate([alert({ createdBy: "me" })], base)).toBeNull();
    expect(stillThereCandidate([alert()], { ...base, alreadyAsked: new Set(["a1"]) })).toBeNull();
    expect(stillThereCandidate([alert(ahead(-200) as Partial<AlertDoc>)], base)).toBeNull();
    expect(stillThereCandidate([alert(ahead(900) as Partial<AlertDoc>)], base)).toBeNull();
    expect(stillThereCandidate([alert()], { ...base, speedKmh: 2 })).toBeNull();
  });
  it("never covers a turn: nothing while the manoeuvre view or a turn chip is up", () => {
    expect(stillThereCandidate([alert()], { ...base, navBusy: true })).toBeNull();
  });
  it("one at a time: the nearest", () => {
    const r = stillThereCandidate([alert({ id: "far", ...ahead(280) }), alert({ id: "near", ...ahead(120) })], base);
    expect(r?.id).toBe("near");
  });
});

describe("shared rules", () => {
  it("the app and the server read the same policy file", () => {
    const server = require("../../firebase/functions/reports/policy.json");
    expect(REPORT_POLICY).toEqual(server);
    expect(UNDO_MS).toBe(3000);
    expect(REPORT_POLICY.maxUndosPerHour).toBe(2);
  });
  it("a low-trust report isn't announced until someone confirms it", () => {
    const src = { osm: null, alerts: [{ id: "x", type: "police" as const, ...ahead(200), createdBy: "o", needsConfirmation: true }], incidents: [] };
    expect(collectApproachFeatures(DEFAULT_SETTINGS, src)).toEqual([]);
    expect(collectApproachFeatures(DEFAULT_SETTINGS, { ...src, alerts: [{ ...src.alerts[0], needsConfirmation: false }] })).toHaveLength(1);
  });
});

describe("reporting through the server", () => {
  beforeEach(() => {
    mockCallable.mockReset();
    mockAddDoc.mockClear();
    mockDeleteDoc.mockClear();
  });
  const at = { latitude: -33.87, longitude: 151.2 };

  it("sends type, place, the driver's own position and region; returns the 3 s pending report", async () => {
    mockCallable.mockResolvedValueOnce({ data: { merged: false, pendingId: "p1", publishAtMs: 5000, needsConfirmation: false } });
    const r = await submitReport("police", at, at, "me", { comment: "two cars" });
    expect(mockCallable).toHaveBeenCalledWith("submitReport", expect.objectContaining({ type: "police", at: { lat: at.latitude, lng: at.longitude }, from: { lat: at.latitude, lng: at.longitude }, region: "NSW", comment: "two cars" }));
    expect(r).toEqual({ kind: "pending", pendingId: "p1", publishAtMs: 5000, needsConfirmation: false });
    mockCallable.mockResolvedValueOnce({ data: { undone: true } });
    await undoReport(r, "me");
    expect(mockCallable).toHaveBeenLastCalledWith("undoReport", { pendingId: "p1" });
  });

  it("a duplicate is merged", async () => {
    mockCallable.mockResolvedValueOnce({ data: { merged: true, alertId: "a9" } });
    expect(await submitReport("crash", at, at, "me")).toEqual({ kind: "merged", alertId: "a9" });
  });

  it("limits come back as a readable refusal", async () => {
    mockCallable.mockRejectedValueOnce(Object.assign(new Error("Up to 10 reports an hour."), { code: "functions/resource-exhausted", details: { reason: "hourly-limit" } }));
    await expect(submitReport("police", at, at, "me")).rejects.toBeInstanceOf(ReportRefused);
    mockCallable.mockRejectedValueOnce(Object.assign(new Error("You can undo 2 reports an hour."), { code: "functions/resource-exhausted", details: { reason: "undo-limit" } }));
    await expect(undoReport({ kind: "pending", pendingId: "p", publishAtMs: 0, needsConfirmation: false }, "me")).rejects.toMatchObject({ reason: "undo-limit" });
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it("before the function is deployed: writes directly, and undo deletes it", async () => {
    mockCallable.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "functions/not-found" }));
    const r = await submitReport("hazard", at, at, "me");
    expect(r).toEqual({ kind: "direct", alertId: "direct1" });
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    await undoReport(r, "me");
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
  });
});

describe("Undo bar", () => {
  it("counts down, Undo calls back, and it goes when the 3 s are up", async () => {
    jest.useFakeTimers();
    const now = Date.now();
    const onUndo = jest.fn();
    const onDone = jest.fn();
    await render(<ReportUndoBar type="police" untilMs={now + 3000} onUndo={onUndo} onDone={onDone} bottom={0} />);
    expect(screen.getByText(/Police reported · 3/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("report-undo"));
    expect(onUndo).toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(3400);
    });
    expect(onDone).toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe("Home / Work / saved place popup", () => {
  const actions = () => ({
    onSend: jest.fn(),
    onRoutes: jest.fn(),
    onPreview: jest.fn(),
    onMarkParking: jest.fn(),
    onFindCar: jest.fn(),
    onEdit: jest.fn(),
    onRemove: jest.fn(),
    onClose: jest.fn(),
  });
  const home: SavedPinPlace = { kind: "home", placeId: "h", title: "Home", address: "1 George St, Sydney", location: CAR };

  it("Send, Routes, and ••• → Preview location, Mark your parking spot, Find my car, Edit, Remove", async () => {
    const a = actions();
    await render(<SavedPlacePopup place={home} bottom={0} {...a} />);
    await fireEvent.press(screen.getByTestId("saved-send"));
    await fireEvent.press(screen.getByTestId("saved-routes"));
    expect(a.onSend).toHaveBeenCalled();
    expect(a.onRoutes).toHaveBeenCalled();
    for (const [label, fn] of [["Preview location", a.onPreview], ["Mark your parking spot", a.onMarkParking], ["Find my car", a.onFindCar], ["Edit address", a.onEdit], ["Remove", a.onRemove]] as const) {
      await fireEvent.press(screen.getByTestId("saved-more"));
      await fireEvent.press(screen.getByTestId(`saved-menu-${label}`));
      expect([label, (fn as jest.Mock).mock.calls.length]).toEqual([label, 1]);
    }
  });

  it("a saved place is renamed in place", async () => {
    const a = actions();
    await render(<SavedPlacePopup place={{ ...home, kind: "custom", title: "Gym" }} bottom={0} {...a} />);
    await fireEvent.press(screen.getByTestId("saved-more"));
    await fireEvent.press(screen.getByTestId("saved-menu-Edit name"));
    await fireEvent.changeText(screen.getByLabelText("Name"), "Pool");
    await fireEvent.press(screen.getByTestId("saved-rename-save"));
    expect(a.onEdit).toHaveBeenCalledWith("Pool");
  });

  it("no Find my car until a parking spot is marked; the P pin offers Find my car", async () => {
    const a = actions();
    const view = await render(<SavedPlacePopup place={home} bottom={0} {...a} onFindCar={null} />);
    await fireEvent.press(screen.getByTestId("saved-more"));
    expect(screen.queryByTestId("saved-menu-Find my car")).toBeNull();
    await view.rerender(<SavedPlacePopup place={{ kind: "parking", placeId: "parking", title: "Your parking spot", address: "Level 2", location: CAR }} bottom={0} {...a} />);
    expect(screen.getByLabelText("Find my car")).toBeTruthy();
  });

  it("pins: Home, Work, each saved place, and the parking spot", () => {
    const saved = {
      home: { placeId: "h", name: "x", address: "a", location: CAR },
      work: null,
      custom: [{ placeId: "c", name: "Gym", label: "My gym", address: "b", location: CAR }],
    };
    expect(savedPinPlaces(saved, null).map((p) => [p.kind, p.title])).toEqual([["home", "Home"], ["custom", "My gym"]]);
    expect(savedPinPlaces(saved, { latitude: 1, longitude: 2, label: "Level 2", savedAt: 0 }).pop()).toMatchObject({ kind: "parking", location: { latitude: 1, longitude: 2 } });
  });

  it("the parking spot survives a restart and can be cleared", async () => {
    await AsyncStorage.clear();
    await setParkingSpot({ latitude: -33.9, longitude: 151.1, label: "Work" }, 5);
    expect(await getParkingSpot()).toEqual({ latitude: -33.9, longitude: 151.1, label: "Work", savedAt: 5 });
    await clearParkingSpot();
    expect(await getParkingSpot()).toBeNull();
  });
});

describe("Tracky bubble", () => {
  const p = { uid: "u2", lat: 0, lng: 0, headingDeg: null, mood: "chill" as const, updatedAt: 0, path: [], w: 0, receivedAtLocalMs: 0 };
  it("shows the name only if they chose to show it, their mood and how fresh it is", async () => {
    await render(<TrackyBubble presence={p} nowMs={3 * MIN} top={0} onWave={() => Promise.resolve("")} onMore={() => {}} onClose={() => {}} />);
    expect(screen.getByText("A Tracky")).toBeTruthy();
    expect(screen.getByText("Chill · 3 min ago")).toBeTruthy();
    expect(presenceAgeText(0, 30_000)).toBe("just now");
  });
  it("Wave says how it went; More opens the full card", async () => {
    const onMore = jest.fn();
    await render(<TrackyBubble presence={{ ...p, displayName: "Sam" }} nowMs={0} top={0} onWave={() => Promise.resolve("Waved!")} onMore={onMore} onClose={() => {}} />);
    expect(screen.getByText("Sam")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("tracky-wave"));
    expect(await screen.findByText("Waved!")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("tracky-more"));
    expect(onMore).toHaveBeenCalled();
  });
});
