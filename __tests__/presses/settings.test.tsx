// Every Settings category row opens Settings on that category.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { mockNavigation, resetMockNavigation } from "./mockNavigation";
import { SETTINGS_CATEGORY_LABELS, type SettingsCategory } from "@/screens/settingsCategories";

jest.mock("@react-navigation/native", () => ({
  ...(jest.requireActual("@react-navigation/native") as object),
  useNavigation: () => require("./mockNavigation").mockNavigation,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { SettingsCategoriesScreen } from "@/screens/SettingsCategoriesScreen";

const categories = Object.keys(SETTINGS_CATEGORY_LABELS) as SettingsCategory[];

describe("Settings category rows", () => {
  beforeEach(resetMockNavigation);

  it.each(categories.map((c) => [SETTINGS_CATEGORY_LABELS[c], c]))("%s opens its settings", async (label, category) => {
    await render(<SettingsCategoriesScreen />);
    await fireEvent.press(screen.getByLabelText(label));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("Settings", { category });
  });

  it("Close goes back", async () => {
    await render(<SettingsCategoriesScreen />);
    await fireEvent.press(screen.getByLabelText("Close"));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });
});
