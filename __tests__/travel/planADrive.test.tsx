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
const mockAuth: { user: { uid: string } | null; loading: boolean } = { user: { uid: "u1" }, loading: false };
const mockEnsureSignedIn = jest.fn<() => Promise<unknown>>(() => Promise.resolve({ uid: "guest" }));
jest.mock("@/services/firebase", () => ({ ensureSignedIn: () => mockEnsureSignedIn() }));
jest.mock("@/services/sentry", () => ({ Sentry: { logger: { info: () => {}, warn: () => {}, error: (...a: unknown[]) => mockLogError(...a) } } }));
const mockLogError = jest.fn((..._a: unknown[]) => {});
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
  loadError: null as null | { code: string; message: string },
};
jest.mock("@/services/plannedDrivesStore", () => ({
  watchPlannedDrives: (_uid: string, onDrives: (d: PlannedDrive[]) => void, onError: (e: Error) => void) => {
    if (mockStore.loadError) onError(Object.assign(new Error(mockStore.loadError.message), { code: mockStore.loadError.code }));
    else onDrives(mockStore.drives);
    return () => {};
  },
  savePlannedDrive: (_uid: string, d: unknown) => {
    mockStore.saved.push(d);
    return Promise.resolve("new");
  },
  deletePlannedDrive: jest.fn(() => Promise.resolve()),
  getLeaveReminders: () => Promise.resolve(true),
  setLeaveReminders: jest.fn(() => Promise.resolve()),
  ...(() => {
    const real = jest.requireActual("@/services/plannedDrivesStore") as Record<string, unknown>;
    return { plannedDrivesErrorText: real.plannedDrivesErrorText, firebaseErrorCode: real.firebaseErrorCode };
  })(),
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
    mockAuth.loading = false;
    mockStore.loadError = null;
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

  it("not signed in: waits for auth, then signs in as a guest (no sign-in dead end)", async () => {
    mockAuth.user = null;
    mockAuth.loading = true;
    const r = await render(<PlanADriveScreen />);
    expect(screen.getByTestId("plan-loading")).toBeTruthy();
    expect(mockEnsureSignedIn).not.toHaveBeenCalled(); // auth hasn't settled yet
    mockAuth.loading = false;
    r.rerender(<PlanADriveScreen />);
    await waitFor(() => expect(mockEnsureSignedIn).toHaveBeenCalled());
    expect(screen.getByTestId("plan-loading")).toBeTruthy();
    mockAuth.loading = false;
  });

  it("guest sign-in failing offers Try again and Sign in", async () => {
    mockAuth.user = null;
    mockEnsureSignedIn.mockRejectedValueOnce(Object.assign(new Error("network"), { code: "auth/network-request-failed" }));
    await render(<PlanADriveScreen />);
    await waitFor(() => expect(screen.getByTestId("plan-retry")).toBeTruthy());
    expect(screen.getByTestId("plan-sign-in")).toBeTruthy();
  });

  it("a permission error never shows Firebase's text: a plain retry, and the real code is logged", async () => {
    mockStore.loadError = { code: "permission-denied", message: "Missing or insufficient permissions." };
    await render(<PlanADriveScreen />);
    await waitFor(() => expect(screen.getByText("Couldn't load your drives — tap to retry.")).toBeTruthy());
    expect(screen.queryByText(/insufficient permissions/i)).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith("plan a drive: load failed", { code: "permission-denied" });
    mockStore.loadError = null;
    await fireEvent.press(screen.getByTestId("plan-retry"));
    await waitFor(() => expect(screen.queryByText("Couldn't load your drives — tap to retry.")).toBeNull());
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

describe("fix pass 4: the Plan a drive look", () => {
  const t = require("@/travel/plannedDrives") as typeof import("@/travel/plannedDrives");
  const Q = 15 * 60_000;

  it("short day pills, and the list window: next quarter hour today, 8 am other days, an hour before a planned time", () => {
    expect(t.dayPillLabel(dayStart(NOW), NOW)).toBe("Today");
    expect(t.dayPillLabel(dayChoices(NOW)[1].dayStartMs, NOW)).toBe("Tomorrow");
    expect(t.dayPillLabel(dayChoices(NOW)[3].dayStartMs, NOW)).toMatch(/^\w{2,4}\.? \d{1,2}$/);
    expect(t.defaultWindowStart(dayStart(NOW), NOW)).toBe(new Date(2026, 10, 17, 7, 45).getTime());
    const tomorrow = dayChoices(NOW)[1].dayStartMs;
    expect(new Date(t.defaultWindowStart(tomorrow, NOW)).getHours()).toBe(8);
    const planned = new Date(2026, 10, 18, 9, 10).getTime();
    expect(t.defaultWindowStart(tomorrow, NOW, planned)).toBe(new Date(2026, 10, 18, 8, 15).getTime());
  });

  it("quarter-hour times from the window start, never past or past midnight; Jump to time lands on a quarter hour", () => {
    const slots = t.windowSlots(new Date(2026, 10, 17, 7, 31).getTime(), NOW, 8);
    expect(slots).toHaveLength(8);
    expect(slots[0]).toBe(new Date(2026, 10, 17, 7, 45).getTime());
    for (let i = 1; i < slots.length; i++) expect(slots[i] - slots[i - 1]).toBe(Q);
    expect(t.windowSlots(new Date(2026, 10, 17, 23, 30).getTime(), NOW, 8)).toHaveLength(2);
    expect(t.jumpTo(dayStart(NOW), new Date(2000, 0, 1, 17, 52))).toBe(new Date(2026, 10, 17, 17, 45).getTime());
  });

  it("traffic bars are relative to the times shown: quickest shortest and 'best', slowest full and 'heavy'", () => {
    const bars = t.trafficBars({ 1: 1200, 2: 1250, 3: 1400, 4: 1800 });
    expect(bars[1]).toEqual({ fraction: 0.25, level: "best" });
    expect(bars[2].level).toBe("light");
    expect(bars[3].level).toBe("moderate");
    expect(bars[4]).toEqual({ fraction: 1, level: "heavy" });
    expect(t.trafficBars({})).toEqual({});
  });

  it("From and Arrive by / Leave at are segmented controls; no hour chips; 64pt rows with a bar, Best time and a selected outline", async () => {
    mockParams.current = { initialDestination: { placeId: "p9", name: "Office", address: "", location: { latitude: -33.87, longitude: 151.21 } } };
    let n = 0;
    mockDirections.mockImplementation(() => Promise.resolve({ durationSeconds: 1200 + (n++ % 4) * 120 }));
    await render(<PlanADriveScreen />);
    expect(screen.getByTestId("plan-from-here").props.accessibilityRole).toBe("tab");
    expect(screen.getByTestId("plan-mode-arrive").props.accessibilityRole).toBe("tab");
    expect(screen.getByTestId("plan-days")).toBeTruthy();
    // The old hour-chip row is gone: no chip reads like a bare hour ("8:00 am").
    expect(screen.queryAllByRole("button", { name: /^\d{1,2}:00\s?(am|pm)$/i })).toHaveLength(0);
    // Tomorrow, not today: today's times stop at midnight, so from ~23:30 (CI runs on UTC) today
    // has a single time left and this check failed late at night (CI run 45512029173).
    await fireEvent.press(screen.getByTestId("plan-day-Tomorrow"));
    await fireEvent.press(screen.getByTestId("plan-mode-leave"));
    await waitFor(() => expect(screen.getByTestId("plan-best")).toBeTruthy());
    expect(screen.getAllByTestId(/^plan-bar-/).length).toBeGreaterThan(1);
    const row = screen.getAllByTestId(/^plan-slot-/)[0];
    const flat = (el: { props: Record<string, any> }) => Object.assign({}, ...[typeof el.props.style === "function" ? el.props.style({ pressed: false }) : el.props.style].flat(5).filter(Boolean));
    expect(flat(row).minHeight).toBe(64);
    await fireEvent.press(row);
    const selected = screen.getAllByTestId(/^plan-slot-/)[0];
    expect(flat(selected)).toMatchObject({ borderWidth: 2 });
    expect(selected.props.accessibilityState).toMatchObject({ selected: true });
  });

  it("Jump to time opens the phone's time picker; Done moves the list there", async () => {
    mockParams.current = { initialDestination: { placeId: "p10", name: "Office", address: "", location: { latitude: -33.87, longitude: 151.21 } } };
    mockDirections.mockResolvedValue({ durationSeconds: 1500 });
    await render(<PlanADriveScreen />);
    // Tomorrow, so 10 pm is always in the future whatever the real clock says.
    await fireEvent.press(screen.getByTestId("plan-day-Tomorrow"));
    await fireEvent.press(screen.getByTestId("plan-jump"));
    const picker = screen.getByTestId("native-time-picker");
    expect(picker.props).toMatchObject({ mode: "time", minuteInterval: 15 });
    const target = new Date();
    target.setHours(22, 0, 0, 0);
    await act(async () => picker.props.onChange({ type: "set" }, target));
    await fireEvent.press(screen.getByTestId("plan-jump-done"));
    const first = screen.getAllByTestId(/^plan-slot-/)[0].props.testID as string;
    expect(new Date(Number(first.replace("plan-slot-", ""))).getHours()).toBe(22);
  });
});
