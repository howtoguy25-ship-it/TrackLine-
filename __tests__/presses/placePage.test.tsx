// The place page's buttons: Save, Share, More (and its items), See more parking, View routes.
import React from "react";
import { Alert, Share } from "react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-haptics", () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock("expo-image-picker", () => ({}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1", isAnonymous: false } }) }));
jest.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ settings: { distanceUnit: "km" } }) }));
jest.mock("@/services/places", () => ({ getPlaceInfo: () => Promise.resolve(null) }));
jest.mock("@/services/osmPlaces", () => ({
  getOsmPlaceInfo: () => Promise.resolve(null),
  isOsmPlaceId: () => false,
  // One car park 300 m away -> the "Nearby parking" card with "See more parking".
  searchNearbyOsmPlaces: () => Promise.resolve([{ name: "Wilson Parking", distanceMeters: 300 }]),
}));
const mockSaved = { home: null, work: null, custom: [] as { placeId: string }[] };
jest.mock("@/services/savedPlaces", () => ({
  getSavedPlaces: () => Promise.resolve(mockSaved),
  subscribeSavedPlaces: () => () => {},
  addCustomPlace: jest.fn(() => Promise.resolve(mockSaved)),
  removeCustomPlace: jest.fn(() => Promise.resolve(mockSaved)),
  setHomeOrWork: jest.fn(() => Promise.resolve(mockSaved)),
  pushSavedPlacesToProfile: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/services/placeContributions", () => ({
  getApprovedPlacePhotos: () => Promise.resolve([]),
  reportPlace: jest.fn(() => Promise.resolve()),
  submitPlacePhoto: jest.fn(),
}));

import { PlacePage } from "@/screens/PlacePage";
import { SurfaceScheme } from "@/components/ui/surfaceScheme";
import { paints } from "../support/darkScan";
import * as savedPlaces from "@/services/savedPlaces";
import * as Clipboard from "expo-clipboard";

const place = {
  placeId: "ChIJ-test",
  name: "Westfield Parramatta",
  address: "159-175 Church St, Parramatta NSW",
  location: { latitude: -33.817, longitude: 151.004 },
};

async function renderPage() {
  const handlers = {
    onBack: jest.fn(),
    onClose: jest.fn(),
    onViewRoutes: jest.fn(),
    onSeeMoreParking: jest.fn(),
    onPlanDrive: jest.fn(),
  };
  await render(<PlacePage place={place} origin={{ latitude: -33.8, longitude: 151.0 }} {...handlers} />);
  // Let the parking and saved-places lookups settle.
  await act(async () => {});
  return handlers;
}

describe("Place page buttons", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("View routes hands the place to route selection", async () => {
    const h = await renderPage();
    await fireEvent.press(screen.getByLabelText("View routes"));
    expect(h.onViewRoutes).toHaveBeenCalledWith(place);
  });

  it("Save adds it to saved places", async () => {
    await renderPage();
    await fireEvent.press(screen.getByLabelText("Save"));
    expect(savedPlaces.addCustomPlace).toHaveBeenCalledWith(place);
  });

  it("Share opens the share sheet with a drive link", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    await renderPage();
    await fireEvent.press(screen.getByLabelText("Share"));
    expect(share).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(share.mock.calls[0][0])).toContain("Westfield Parramatta");
  });

  it("More opens the menu; its items do what they say", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const h = await renderPage();
    await fireEvent.press(screen.getByLabelText("More"));
    await fireEvent.press(screen.getByText("Set as Home"));
    expect(savedPlaces.setHomeOrWork).toHaveBeenCalledWith("home", place);
    expect(alert).toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("More"));
    await fireEvent.press(screen.getByText("Add to a planned drive"));
    expect(h.onPlanDrive).toHaveBeenCalledWith(place);

    await fireEvent.press(screen.getByLabelText("More"));
    await fireEvent.press(screen.getByText("Copy address"));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(place.address);
  });

  it("See more parking opens the parking list for this place", async () => {
    const h = await renderPage();
    await fireEvent.press(screen.getByText("See more parking"));
    expect(h.onSeeMoreParking).toHaveBeenCalledWith(place);
  });

  it("Back returns to the search; Close closes", async () => {
    const h = await renderPage();
    await fireEvent.press(screen.getByLabelText("Back to search"));
    expect(h.onBack).toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Close"));
    expect(h.onClose).toHaveBeenCalled();
  });
});

describe("Place page with the map in its Dark theme", () => {
  it("has no light surfaces or dark-on-light text left", async () => {
    const r = await render(
      <SurfaceScheme value="dark">
        <PlacePage
          place={place}
          origin={{ latitude: -33.8, longitude: 151.0 }}
          onBack={jest.fn()}
          onClose={jest.fn()}
          onViewRoutes={jest.fn()}
          onSeeMoreParking={jest.fn()}
          onPlanDrive={jest.fn()}
        />
      </SurfaceScheme>
    );
    await act(async () => {});
    const p = paints(r.toJSON() as never);
    expect(p.lightSurfacesLeft).toEqual([]);
    expect(p.lightTextLeft).toEqual([]);
  });
});
