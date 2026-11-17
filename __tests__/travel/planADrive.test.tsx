// Plan a drive: day / hour / 15-minute choices, arrive-by from two real predictions, drives
// grouped by day; the screen's empty state, list, slot predictions and saving.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { dayChoices, groupDrives, hourChoices, leaveTimeForArrival, timeSlots, type PlannedDrive } from "@/travel/plannedDrives";

jest.mock("@react-navigation/native", () => ({
  ...(jest.requireActual("@react-navigation/native") as object),
  useNavigation: () => require("../presses/mockNavigation").mockNavigation,
  useRoute: () => ({ params: mockParams.current }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/context/LocationContext", () => ({
  useLocation: () => ({ location: { coords: { latitude: -33.8, longitude: 151.2 } } }),
}));
const mockAuth: { user: { uid: string } | null } = { user: { uid: "u1" } };
jest.mock("@/context/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@/components/art/ArriveOnTimeArt", () => ({ ArriveOnTimeArt: () => null }));
jest.mock("@/services/plannedDriveReminders", () => ({ syncLeaveReminders: (...a: unknown[]) => mockSync(...a) }));
const mockSync = jest.fn((..._a: unknown[]) => Promise.resolve());
jest.mock("@/services/calendarEvents", () => ({
  getCalendarPermissionStatus: () => Promise.resolve("undetermined"),
  requestCalendarAccess: () => Promise.resolve(true),
  getUpcomingEventsWithLocation: () => Promise.resolve([{ id: "e1", title: "Dentist", location: "1 George St", startDate: new Date(2030, 0, 1, 9, 10) }]),
}));
jest.mock("@/services/savedPlaces", () => ({ getSavedPlaces: () => Promise.resolve({ home: null, work: null, custom: [] }) }));
jest.mock("@/services/searchHistory", () => ({ getSearchHistory: () => Promise.resolve([]) }));
jest.mock("@/services/places", () => ({ searchPlaces: jest.fn(), getPlaceDetails: jest.fn() }));
const mockDirections = jest.fn<(...a: unknown[]) => Promise<{ durationSeconds: number; durationInTrafficSeconds?: number }>>();
jest.mock("@/services/directions", () => ({ getDirections: (...a: unknown[]) => mockDirections(...a) }));
const mockStore = {
  drives: [] as PlannedDrive[],
  saved: [] as unknown[],
};
jest.mock("@/services/plannedDrivesStore", () => ({
  watchPlannedDrives: (_uid: string, onDrives: (d: PlannedDrive[]) => void) => {
    onDrives(mockStore.drives);
    return () => {};
  },
  savePlannedDrive: (_uid: string, d: unknown) => {
    mockStore.saved.push(d);
    return Promise.resolve("new");
  },
  deletePlannedDrive: jest.fn(() => Promise.resolve()),
  getLeaveReminders: () => Promise.resolve(true),
  setLeaveReminders: jest.fn(() => Promise.resolve()),
}));
const mockParams: { current: unknown } = { current: undefined };

import { PlanADriveScreen } from "@/screens/PlanADriveScreen";

const NOW = new Date(2026, 10, 17, 7, 40).getTime();
const dayStart = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();

describe("choices", () => {
  it("today, tomorrow, then named days", () => {
    const days = dayChoices(NOW);
    expect(days).toHaveLength(7);
    expect(days[0].label).toBe("Today");
    expect(days[1].label).toBe("Tomorrow");
    expect(days[2].label).not.toMatch(/Today|Tomorrow/);
  });

  it("today's hours start at the current hour; other days at 5 am", () => {
    expect(hourChoices(dayStart(NOW), NOW)[0]).toBe(7);
    expect(hourChoices(dayChoices(NOW)[1].dayStartMs, NOW)[0]).toBe(5);
  });

  it("15-minute times from the hour, never in the past", () => {
    const slots = timeSlots(dayStart(NOW), 7, NOW, 4);
    expect(slots.map((s) => new Date(s).getMinutes())).toEqual([45, 0, 15, 30]);
  });
});

describe("arrive by", () => {
  it("two real predictions: from a first guess, then from that answer", async () => {
    const arrive = NOW + 90 * 60_000;
    const asked: number[] = [];
    const r = await leaveTimeForArrival(arrive, async (t) => {
      asked.push(t);
      return asked.length === 1 ? 40 * 60 : 45 * 60;
    });
    expect(asked).toEqual([arrive - 30 * 60_000, arrive - 40 * 60_000]);
    expect(r).toEqual({ leaveAtMs: arrive - 45 * 60_000, durationSeconds: 2700 });
  });
});

const drive = (id: string, leaveAtMs: number): PlannedDrive => ({
  id,
  from: { name: "Home", lat: 0, lng: 0 },
  to: { name: `Place ${id}`, lat: 0, lng: 0 },
  mode: "leave",
  targetMs: leaveAtMs,
  leaveAtMs,
  durationSeconds: 1200,
  createdAt: 0,
});

describe("grouping", () => {
  it("soonest first under Today / Tomorrow; long-past drives drop off", () => {
    const sections = groupDrives([drive("b", NOW + 26 * 3_600_000), drive("a", NOW + 3_600_000), drive("old", NOW - 3 * 3_600_000)], NOW);
    expect(sections.map((s) => s.title)).toEqual(["Today", "Tomorrow"]);
    expect(sections[0].drives.map((d) => d.id)).toEqual(["a"]);
  });
});

describe("Plan a drive screen", () => {
  beforeEach(() => {
    mockStore.drives = [];
    mockStore.saved = [];
    mockParams.current = undefined;
    mockAuth.user = { uid: "u1" };
    mockDirections.mockReset();
    mockSync.mockClear();
  });

  it("no drives: Arrive on time, connect calendar, Plan a drive", async () => {
    await render(<PlanADriveScreen />);
    expect(screen.getByTestId("plan-empty")).toBeTruthy();
    expect(screen.getByText("Arrive on time")).toBeTruthy();
    expect(screen.getByText("Wherever you're going, TrackLine tells you when to leave based on live traffic.")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("plan-calendar")));
    expect(screen.getByText("Dentist")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("plan-new"));
    expect(screen.getByTestId("plan-search")).toBeTruthy();
  });

  it("signed out: asks to sign in rather than showing a list it can't save", async () => {
    mockAuth.user = null;
    await render(<PlanADriveScreen />);
    expect(screen.getByTestId("plan-sign-in")).toBeTruthy();
  });

  it("saved drives are listed with leave and arrive times", async () => {
    mockStore.drives = [drive("a", Date.now() + 3_600_000)];
    mockDirections.mockResolvedValue({ durationSeconds: 900 });
    await render(<PlanADriveScreen />);
    await waitFor(() => expect(screen.getByTestId("plan-live-a")).toHaveTextContent("15 mins now"));
    expect(screen.getByText("Place a")).toBeTruthy();
    expect(screen.getByText(/^Arrive about .* · from Home$/)).toBeTruthy();
    expect(screen.getByTestId("plan-reminders")).toBeTruthy();
    // The phone's own leave alerts are synced to the list.
    await waitFor(() => expect(mockSync).toHaveBeenCalledWith(mockStore.drives, true));
  });

  it("each time gets a real prediction; picking one and saving stores it", async () => {
    mockParams.current = { initialDestination: { placeId: "p1", name: "Office", address: "1 George St", location: { latitude: -33.87, longitude: 151.21 } } };
    mockDirections.mockResolvedValue({ durationSeconds: 1500, durationInTrafficSeconds: 1800 });
    await render(<PlanADriveScreen />);
    expect(screen.getByTestId("plan-to")).toHaveTextContent("Office");
    await fireEvent.press(screen.getByTestId("plan-mode-leave"));
    await waitFor(() => expect(screen.getAllByText(/30 mins · arrive/).length).toBeGreaterThan(0));
    // Every request asked Google with live/predicted traffic.
    for (const call of mockDirections.mock.calls) expect((call[2] as { useTraffic: unknown }).useTraffic).toBeTruthy();
    const firstSlot = screen.getAllByTestId(/^plan-slot-/)[0];
    await fireEvent.press(firstSlot);
    await act(async () => fireEvent.press(screen.getByTestId("plan-save")));
    expect(mockStore.saved).toHaveLength(1);
    expect(mockStore.saved[0]).toMatchObject({ mode: "leave", durationSeconds: 1800, to: { name: "Office" } });
  });

  it("a failed prediction says why and can't be picked", async () => {
    mockParams.current = { initialDestination: { placeId: "p2", name: "Office", address: "", location: { latitude: -33.87, longitude: 151.21 } } };
    mockDirections.mockRejectedValue(new Error("Network request failed"));
    await render(<PlanADriveScreen />);
    await waitFor(() => expect(screen.getAllByText(/Couldn't get a time/).length).toBeGreaterThan(0));
    expect(screen.getByTestId("plan-save").props.accessibilityState?.disabled).toBe(true);
  });
});
