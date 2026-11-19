// Search: tapping "Where to?" opens the search screen, typing shows results, and tapping a
// result opens that place (the place page); the category chips run their searches.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({ settings: { distanceUnit: "km" }, navLanguage: "en" }),
}));
const mockPlace = {
  placeId: "ChIJ-westfield",
  name: "Westfield Parramatta",
  address: "159-175 Church St, Parramatta NSW",
  location: { latitude: -33.817, longitude: 151.004 },
};
jest.mock("@/services/places", () => {
  class PlacesApiError extends Error {
    status = "ERROR";
  }
  return {
    PlacesApiError,
    searchPlaces: jest.fn(() =>
      Promise.resolve([
        { placeId: "ChIJ-westfield", primaryText: "Westfield Parramatta", secondaryText: "Church St, Parramatta", types: [], distanceMeters: 1600 },
      ])
    ),
    getPlaceDetails: jest.fn(() => Promise.resolve(mockPlace)),
  };
});
jest.mock("@/services/searchHistory", () => ({
  getSearchHistory: () => Promise.resolve([]),
  addSearchHistoryEntry: jest.fn(() => Promise.resolve([])),
  removeSearchHistoryEntry: jest.fn(() => Promise.resolve([])),
}));
jest.mock("@/services/calendarEvents", () => ({
  getCalendarPermissionStatus: () => Promise.resolve("denied"),
  requestCalendarAccess: () => Promise.resolve(false),
  getUpcomingEventsWithLocation: () => Promise.resolve([]),
}));
const mockSaved = { home: null, work: null, custom: [] };
jest.mock("@/services/savedPlaces", () => ({
  getSavedPlaces: () => Promise.resolve(mockSaved),
  setHomeOrWork: jest.fn(),
  removeHomeOrWork: jest.fn(),
  addCustomPlace: jest.fn(),
  removeCustomPlace: jest.fn(),
  pushSavedPlacesToProfile: jest.fn(),
  pullSavedPlacesFromProfile: jest.fn(() => Promise.resolve(null)),
  subscribeSavedPlaces: () => () => {},
}));
jest.mock("@/services/voiceSearch", () => ({ startVoiceSearch: jest.fn(), VOICE_SEARCH_MESSAGES: {} }));
jest.mock("@/services/contactAddresses", () => ({
  getContactsPermissionStatus: () => Promise.resolve("denied"),
  requestContactsAccess: () => Promise.resolve(false),
  getContactsWithAddresses: () => Promise.resolve([]),
}));
jest.mock("@/components/trackys/Tracky", () => ({ Tracky: () => null }));

import { WhereToSheet } from "@/screens/WhereToSheet";
import { getPlaceDetails, searchPlaces } from "@/services/places";

function handlers() {
  return {
    onDestinationSelected: jest.fn(),
    onFindRestaurants: jest.fn(),
    onFindHotels: jest.fn(),
    onFindPetrol: jest.fn(),
    onFindParking: jest.fn(),
    onPlaceChosen: jest.fn(),
  };
}

describe("Search", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  it("the search field isn't mounted until the search is opened (nothing to steal focus)", async () => {
    await render(<WhereToSheet {...handlers()} />);
    expect(screen.queryByPlaceholderText("Where to?")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Where to? Search for a place"));
    expect(screen.getByPlaceholderText("Where to?")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Back"));
    expect(screen.queryByPlaceholderText("Where to?")).toBeNull();
  });

  it("tapping a search result opens that place", async () => {
    const h = handlers();
    await render(<WhereToSheet {...h} />);
    await fireEvent.press(screen.getByLabelText("Where to? Search for a place"));
    await fireEvent.changeText(screen.getByPlaceholderText("Where to?"), "Westfield");
    await act(async () => {
      jest.advanceTimersByTime(400); // past the 250 ms typing pause
    });
    expect(searchPlaces).toHaveBeenCalledWith("Westfield", undefined, expect.any(String));
    await fireEvent.press(await screen.findByText("Westfield Parramatta"));
    await act(async () => {});
    expect(getPlaceDetails).toHaveBeenCalledWith("ChIJ-westfield", expect.any(String));
    expect(h.onPlaceChosen).toHaveBeenCalledWith(mockPlace);
  });

  it.each([
    ["Fuel", "onFindPetrol"],
    ["Food", "onFindRestaurants"],
    ["Parking", "onFindParking"],
    ["Hotels", "onFindHotels"],
  ])("the %s chip runs its search", async (chip, handler) => {
    const h = handlers();
    await render(<WhereToSheet {...h} />);
    await fireEvent.press(screen.getByLabelText("Where to? Search for a place"));
    await fireEvent.press(screen.getByText(chip));
    expect(h[handler as keyof typeof h]).toHaveBeenCalledTimes(1);
  });
});
