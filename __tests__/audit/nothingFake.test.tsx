// Nothing fake (REAL_AUDIT.md): a failed load is never shown as "nothing here", and production
// code can't pull in mocks, fixtures or made-up data (the ESLint guard).
import React from "react";
import { readFileSync } from "fs";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@react-navigation/native", () => ({
  ...(jest.requireActual("@react-navigation/native") as object),
  useNavigation: () => require("../presses/mockNavigation").mockNavigation,
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({ settings: { visibility: "visible", showTrackysOnMap: false, visibleRegions: [] } }),
}));
jest.mock("@/context/LocationContext", () => ({ useLocation: () => ({ location: null }) }));
jest.mock("@/services/presence", () => ({ subscribeNearbyPresence: () => () => {} }));
jest.mock("@/services/alerts", () => ({ subscribeVisibleAlerts: () => () => {}, getInboxLastViewedAt: () => Promise.resolve(0) }));
const mockEvents = jest.fn<() => Promise<unknown[]>>();
jest.mock("@/services/calendarEvents", () => ({
  getCalendarPermissionStatus: () => Promise.resolve("granted"),
  getUpcomingEventsWithLocation: () => mockEvents(),
  requestCalendarAccess: () => Promise.resolve(true),
}));
jest.mock("@/services/places", () => ({ searchPlaces: jest.fn(), getPlaceDetails: jest.fn() }));
jest.mock("@/services/vehicleCheck", () => ({ getVehicleCheckInfo: () => Promise.resolve({ available: false }) }));
jest.mock("@/components/trackys/Tracky", () => ({ Tracky: () => null }));
jest.mock("@/hooks/useTrackyAppearance", () => ({ useTrackyAppearance: () => ({ mode: "mood", displayMood: "chill" }) }));

import { MainMenuScreen } from "@/screens/MainMenuScreen";

const read = (f: string) => readFileSync(f, "utf8");

describe("a failed load says so (never 'nothing here')", () => {
  it("main menu: a calendar that can't be read offers Try again, not 'No upcoming events'", async () => {
    mockEvents.mockRejectedValueOnce(new Error("calendar unavailable"));
    await render(<MainMenuScreen />);
    await waitFor(() => expect(screen.getByTestId("menu-events-retry")).toBeTruthy());
    expect(screen.queryByText(/No upcoming events/)).toBeNull();
    mockEvents.mockResolvedValueOnce([]);
    await fireEvent.press(screen.getByTestId("menu-events-retry"));
    await waitFor(() => expect(screen.getByText(/No upcoming events/)).toBeTruthy());
  });

  it("voice picker, owner dashboard and vehicle report each have a real error state", () => {
    const voices = read("src/screens/VoicePickerScreen.tsx");
    expect(voices).toMatch(/\.catch\(\(\) => setVoicesError\(true\)\)/);
    expect(voices).toMatch(/testID="voices-retry"/);
    const owner = read("src/screens/OwnerDashboardScreen.tsx");
    expect(owner).not.toMatch(/\.catch\(\(\) => setHistory\(\[\]\)\)/);
    expect(owner).toMatch(/testID="history-error"/);
    expect(read("src/services/vehicleCheck.ts")).toMatch(/onError \? onError\(\) : onChange\(null\)/);
    expect(read("src/screens/VehicleCheckScreen.tsx")).toMatch(/testID="vehicle-report-load-error"/);
  });
});

describe("the no-fakes guard", () => {
  // ESLint's flat config loads with a dynamic import, which Jest's VM doesn't allow: run the real
  // CLI on stdin instead, exactly as CI and the editor do.
  const { spawnSync } = require("child_process") as typeof import("child_process");
  const lint = async (code: string, filePath = "src/services/example.ts") => {
    const out = spawnSync("node_modules/.bin/eslint", ["--stdin", "--stdin-filename", filePath, "-f", "json"], { input: code, encoding: "utf8" });
    const [res] = JSON.parse(out.stdout) as { messages: { ruleId: string | null }[] }[];
    return res.messages.filter((m) => m.ruleId === "no-restricted-imports" || m.ruleId === "no-restricted-syntax").map((m) => m.ruleId);
  };

  it("production code can't import fixtures, mocks or test support", async () => {
    expect(await lint('import data from "../../__tests__/fixtures/drive.json";\nexport default data;\n')).toContain("no-restricted-imports");
    expect(await lint('import { x } from "@/services/mockPlaces";\nexport default x;\n')).toContain("no-restricted-imports");
  }, 60_000);

  it("production code can't declare mock / fake / dummy data", async () => {
    expect(await lint("export const MOCK_PRICES = [1.89, 1.92];\n")).toContain("no-restricted-syntax");
    expect(await lint("export const fakeDrivers = [];\n")).toContain("no-restricted-syntax");
    // Ordinary names are fine (signal-processing sample counts etc).
    expect(await lint("export const SAMPLE_COUNT = 24;\n")).toEqual([]);
  }, 60_000);

  it("tests themselves may use fixtures", async () => {
    expect(await lint('import data from "./fixtures/drive.json";\nexport default data;\n', "__tests__/x.test.ts")).toEqual([]);
  }, 60_000);
});
