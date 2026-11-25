// The Settings home: every group opens Settings on that group; search finds a setting and jumps
// to it (the row is highlighted); each group says how it's set now.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { mockNavigation, resetMockNavigation } from "./mockNavigation";
import { CATEGORY_ORDER, SETTINGS_CATEGORY_LABELS } from "@/screens/settingsCategories";

jest.mock("@react-navigation/native", () => ({
  ...(jest.requireActual("@react-navigation/native") as object),
  useNavigation: () => require("./mockNavigation").mockNavigation,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mockSettings = { ...require("@/services/settings").DEFAULT_SETTINGS, visibility: "ghost" };
jest.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ settings: mockSettings, updateSettings: () => Promise.resolve() }) }));
const mockAuth = { user: { uid: "u1", isAnonymous: false, email: "driver@example.com" } };
jest.mock("@/context/AuthContext", () => ({ useAuth: () => mockAuth }));

import { SettingsCategoriesScreen } from "@/screens/SettingsCategoriesScreen";

describe("Settings home", () => {
  beforeEach(resetMockNavigation);

  it.each(CATEGORY_ORDER.map((c) => [SETTINGS_CATEGORY_LABELS[c], c]))("%s opens its settings", async (_label, category) => {
    await render(<SettingsCategoriesScreen />);
    await fireEvent.press(screen.getByTestId(`settings-group-${category}`));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("Settings", { category });
  });

  it("each group shows how it's set now", async () => {
    await render(<SettingsCategoriesScreen />);
    expect(screen.getByText("Ghost mode on")).toBeTruthy();
    expect(screen.getByText("driver@example.com")).toBeTruthy();
    expect(screen.getByText("TrackLine Light · 3D")).toBeTruthy();
  });

  it("search finds a setting by a word people use for it, and jumps to its row", async () => {
    await render(<SettingsCategoriesScreen />);
    await fireEvent.changeText(screen.getByTestId("settings-search"), "mph");
    await fireEvent.press(screen.getByTestId("search-result-Kilometres"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("Settings", { category: "navigationVoice", highlight: "Kilometres" });
  });

  it("no match says so instead of an empty page", async () => {
    await render(<SettingsCategoriesScreen />);
    await fireEvent.changeText(screen.getByTestId("settings-search"), "zzzz");
    expect(screen.getByText("No settings match")).toBeTruthy();
  });
});
