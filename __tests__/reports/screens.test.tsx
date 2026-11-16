// Settings > Map information & overlays > Reports: every row (icon, title, grey description,
// chevron), each detail screen's real switches and "Sources:" line, and the speedometer
// sign following its setting.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { mockNavigation, resetMockNavigation } from "../presses/mockNavigation";
import { DEFAULT_SETTINGS, type AppSettings } from "@/services/settings";
import { REPORT_ITEMS, SECTION_ORDER, SECTION_TITLES, isShown, alertsWhileDriving, sourcesLine, type ReportItemId } from "@/settings/reportCatalog";

jest.mock("@react-navigation/native", () => ({
  ...(jest.requireActual("@react-navigation/native") as object),
  useNavigation: () => require("../presses/mockNavigation").mockNavigation,
  useRoute: () => ({ params: { id: require("./screens.test").currentId.value } }),
}));
const mockStore: { settings: AppSettings } = { settings: DEFAULT_SETTINGS };
const mockUpdate = jest.fn((patch: Partial<AppSettings>) => {
  mockStore.settings = { ...mockStore.settings, ...patch };
  return Promise.resolve();
});
jest.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({ settings: mockStore.settings, updateSettings: mockUpdate }),
}));
jest.mock("expo-audio", () => require("../support/stubs").stubService());
jest.mock("expo-haptics", () => ({ notificationAsync: () => Promise.resolve(), NotificationFeedbackType: { Warning: "w" } }));

export const currentId: { value: ReportItemId } = { value: "railwayCrossing" };

import { ReportItemSettingsScreen, ReportsSettingsScreen } from "@/screens/ReportsSettingsScreen";
import { LiveSpeedometer } from "@/components/LiveSpeedometer";

beforeEach(() => {
  resetMockNavigation();
  mockUpdate.mockClear();
  mockStore.settings = DEFAULT_SETTINGS;
});

describe("Reports list", () => {
  it("shows every section and every item with its icon, title, description and a chevron to its detail", async () => {
    await render(<ReportsSettingsScreen />);
    for (const section of SECTION_ORDER) expect(screen.getByText(SECTION_TITLES[section])).toBeTruthy();
    for (const item of REPORT_ITEMS) {
      expect(screen.getByTestId(`report-icon-${item.id}`)).toBeTruthy();
      expect(screen.getByText(item.description)).toBeTruthy();
      await fireEvent.press(screen.getByTestId(`report-row-${item.id}`));
      expect(mockNavigation.navigate).toHaveBeenLastCalledWith("ReportItemSettings", { id: item.id });
    }
  });
});

describe("Item detail", () => {
  const live = REPORT_ITEMS;
  it.each(live.map((i) => [i.id]))("%s: its switches change the real setting", async (id) => {
    const item = REPORT_ITEMS.find((i) => i.id === id)!;
    currentId.value = item.id;
    const view = await render(<ReportItemSettingsScreen />);
    expect(screen.getByText(item.explanation)).toBeTruthy();
    expect(screen.getByTestId("data-source")).toBeTruthy();
    expect(screen.getByTestId("sources-line").props.children).toBe(sourcesLine(item.id));
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    for (const t of ["toggle-show", "toggle-alert"]) expect(screen.queryByTestId(t)?.props.disabled ?? false).toBe(false);
    if (item.show) {
      const before = isShown(mockStore.settings, item.id);
      await fireEvent(screen.getByTestId("toggle-show"), "valueChange", !before);
      expect(isShown(mockStore.settings, item.id)).toBe(!before);
    } else expect(screen.queryByTestId("toggle-show")).toBeNull();
    if (item.alert) {
      const before = alertsWhileDriving(mockStore.settings, item.id);
      await fireEvent(screen.getByTestId("toggle-alert"), "valueChange", !before);
      expect(alertsWhileDriving(mockStore.settings, item.id)).toBe(!before);
    } else expect(screen.queryByTestId("toggle-alert")).toBeNull();
    await view.rerender(<ReportItemSettingsScreen />);
    if (item.show) expect(screen.getByTestId("toggle-show").props.value).toBe(isShown(mockStore.settings, item.id));
  });

});

describe("Speedometer limit sign", () => {
  it("is drawn only when the setting allows it", async () => {
    const view = await render(<LiveSpeedometer speedKmh={50} speedLimitKmh={60} visible chimeEnabled={false} showLimit />);
    expect(screen.getByText("60")).toBeTruthy();
    await view.rerender(<LiveSpeedometer speedKmh={50} speedLimitKmh={60} visible chimeEnabled={false} showLimit={false} />);
    expect(screen.queryByText("60")).toBeNull();
    expect(screen.getByText("50")).toBeTruthy();
  });
});
