// Pressing every Main menu row opens the right screen.
import React from "react";
import { Share } from "react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { mockNavigation, resetMockNavigation } from "./mockNavigation";

jest.mock("@react-navigation/native", () => ({
  ...(jest.requireActual("@react-navigation/native") as object),
  useNavigation: () => require("./mockNavigation").mockNavigation,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mockUser: { current: unknown } = { current: null };
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current }) }));
jest.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({ settings: { visibility: "visible", showTrackysOnMap: false, visibleRegions: [] } }),
}));
jest.mock("@/context/LocationContext", () => ({ useLocation: () => ({ location: null }) }));
jest.mock("@/services/presence", () => ({ subscribeNearbyPresence: () => () => {} }));
jest.mock("@/services/alerts", () => ({
  subscribeVisibleAlerts: () => () => {},
  getInboxLastViewedAt: () => Promise.resolve(0),
}));
jest.mock("@/services/calendarEvents", () => ({
  getCalendarPermissionStatus: () => Promise.resolve("denied"),
  getUpcomingEventsWithLocation: () => Promise.resolve([]),
  requestCalendarAccess: () => Promise.resolve(false),
}));
jest.mock("@/services/places", () => ({ searchPlaces: jest.fn(), getPlaceDetails: jest.fn() }));
jest.mock("@/components/trackys/Tracky", () => ({ Tracky: () => null }));
jest.mock("@/hooks/useTrackyAppearance", () => ({ useTrackyAppearance: () => ({ mode: "mood", displayMood: "chill" }) }));

import { MainMenuScreen } from "@/screens/MainMenuScreen";

describe("Main menu rows", () => {
  beforeEach(() => {
    resetMockNavigation();
    mockUser.current = null;
  });

  it.each([
    ["Plan a drive", "PlanADrive", undefined],
    ["Sign in", "SignIn", undefined],
    ["Inbox", "Inbox", undefined],
    ["Settings", "SettingsCategories", undefined],
    ["Help", "Help", undefined],
    ["Visible to other drivers. Tap to change", "Settings", { category: "privacy" }],
    ["Dashcam (AI vehicle detection)", "VehicleDetection", undefined],
    ["Map display", "Settings", { category: "mapDisplay" }],
  ])("%s opens %s", async (label, screenName, params) => {
    await render(<MainMenuScreen />);
    await fireEvent.press(await screen.findByLabelText(label));
    if (params === undefined) expect(mockNavigation.navigate).toHaveBeenCalledWith(screenName);
    else expect(mockNavigation.navigate).toHaveBeenCalledWith(screenName, params);
  });

  it("View profile opens the Tracky profile", async () => {
    await render(<MainMenuScreen />);
    await fireEvent.press(await screen.findByText("View profile"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("TrackyProfile");
  });

  it("Invite a friend opens the share sheet", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    await render(<MainMenuScreen />);
    await fireEvent.press(await screen.findByLabelText("Invite a friend"));
    expect(share).toHaveBeenCalledTimes(1);
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it("when signed in, the account row opens Account settings", async () => {
    mockUser.current = { uid: "u1", isAnonymous: false, email: "a@b.c", displayName: "Ada" };
    await render(<MainMenuScreen />);
    await fireEvent.press(await screen.findByLabelText("Signed in as a@b.c"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("Settings", { category: "account" });
  });

  it("Close goes back to the map", async () => {
    await render(<MainMenuScreen />);
    await fireEvent.press(await screen.findByLabelText("Close menu"));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });
});
