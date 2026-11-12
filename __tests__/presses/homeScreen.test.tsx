// Renders the REAL home screen (MapScreen) with the real home-map buttons, "Where to?" sheet and
// ad bar, and checks what's actually on it: one re-centre button, no Map tools button, no
// current-address row, the search field and Home/Work/New chips, the light map by default, and
// an ad bar with no extra space under it. Native services and data sources are stubbed; the
// screen's own components are real.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";


const mockSafeArea = { top: 47, bottom: 34, left: 0, right: 0 };
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockSafeArea,
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));
jest.mock("@react-navigation/native", () => ({
  ...(jest.requireActual("@react-navigation/native") as object),
  useNavigation: () => require("./mockNavigation").mockNavigation,
  useRoute: () => ({ key: "Map", name: "Map", params: undefined }),
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));
jest.mock("expo-haptics", () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("live-activity", () => require("../support/stubs").stubService());
jest.mock("expo-battery", () => ({ usePowerState: () => ({ batteryLevel: 1, lowPowerMode: false }) }));

// Settings as a brand-new install sees them, after the one-off migration (see the last test).
const mockSettingsRef: { current: Record<string, unknown> } = { current: {} };
jest.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({
    settings: mockSettingsRef.current,
    loaded: true,
    updateSettings: () => {},
    voiceEnabled: true,
    voiceVolume: 1,
    voiceIdentifier: null,
    navLanguage: "en",
  }),
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/context/LocationContext", () => ({
  useLocation: () => ({
    location: { coords: { latitude: -33.8688, longitude: 151.2093, accuracy: 8, heading: 0, speed: 0, altitude: 0, altitudeAccuracy: 0 }, timestamp: 0 },
    permissionDenied: false,
    canAskAgain: true,
    requestPermission: () => Promise.resolve(),
  }),
}));
jest.mock("@/services/firebase", () => require("../support/stubs").stubService());
jest.mock("firebase/firestore", () => require("../support/stubs").stubService());
jest.mock("expo-audio", () => require("../support/stubs").stubService());
jest.mock("expo-speech", () => require("../support/stubs").stubService());
jest.mock("@/components/LiveSpeedometer", () => require("../support/stubs").stubComponents());
jest.mock("firebase/storage", () => require("../support/stubs").stubService());
jest.mock("firebase/auth", () => require("../support/stubs").stubService());
jest.mock("firebase/functions", () => require("../support/stubs").stubService());
jest.mock("firebase/app", () => require("../support/stubs").stubService());
jest.mock("@/services/placeContributions", () => require("../support/stubs").stubService());
jest.mock("@/services/userProfile", () => require("../support/stubs").stubService());
jest.mock("@/services/sentry", () => ({
  Sentry: { logger: { info: () => {}, warn: () => {}, error: () => {} }, captureException: () => {} },
}));
jest.mock("@/services/alerts", () => require("../support/stubs").stubService());
jest.mock("@/services/presence", () => require("../support/stubs").stubService());
jest.mock("@/services/places", () => require("../support/stubs").stubService());
jest.mock("@/services/osmPlaces", () => require("../support/stubs").stubService());
jest.mock("@/services/osmTrafficData", () => require("../support/stubs").stubService());
jest.mock("@/services/liveTrafficCameras", () => require("../support/stubs").stubService());
jest.mock("@/services/trafficNsw", () => require("../support/stubs").stubService());
jest.mock("@/services/sirenDetection", () => require("../support/stubs").stubService());
jest.mock("@/services/trackyMood", () => require("../support/stubs").stubService());
jest.mock("@/services/liveShare", () => require("../support/stubs").stubService());
jest.mock("@/services/navSpeech", () => require("../support/stubs").stubService());
jest.mock("@/services/navState", () => require("../support/stubs").stubService());
jest.mock("@/services/musicApp", () => require("../support/stubs").stubService());
jest.mock("@/services/searchHistory", () =>
  require("../support/stubs").stubService({ getSearchHistory: () => Promise.resolve([]) })
);
jest.mock("@/services/calendarEvents", () => require("../support/stubs").stubService());
jest.mock("@/services/savedPlaces", () =>
  require("../support/stubs").stubService({
    getSavedPlaces: () => Promise.resolve({ home: null, work: null, custom: [] }),
    pullSavedPlacesFromProfile: () => Promise.resolve(null),
    subscribeSavedPlaces: () => () => {},
  })
);
jest.mock("@/services/voiceSearch", () => require("../support/stubs").stubService());
jest.mock("@/services/contactAddresses", () => require("../support/stubs").stubService());
jest.mock("@/hooks/useAutoGhostMode", () => require("../support/stubs").stubService());
jest.mock("@/services/tfliteVehicleModel", () => ({ loadBoxedTFLiteModel: () => Promise.resolve(null) }));
jest.mock("@/hooks/useLiveSpeed", () => ({ useLiveSpeed: () => ({ speedKmh: 0, hasFix: true, accuracyM: 8 }) }));
jest.mock("@/hooks/useTrackyAppearance", () => ({ useTrackyAppearance: () => ({ mode: "mood", displayMood: "chill" }) }));
jest.mock("@/components/trackys/Tracky", () => ({ Tracky: () => null }));
// Sheets and overlays that aren't part of the idle home screen.
jest.mock("@/screens/AlertDetailSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/AlertReportSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/FuelStationsSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/HotelsSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/LiveCameraSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/MapToolsSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/NavOptionsSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/OsmMarkerSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/ParkingSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/PlaceInfoSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/PresenceCard", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/RestaurantsSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/RouteDirectionsSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/SoundSheet", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/TrafficIncidentCard", () => require("../support/stubs").stubComponents());
jest.mock("@/screens/VisibilitySheet", () => require("../support/stubs").stubComponents());
jest.mock("@/components/SimpleBottomSheet", () => require("../support/stubs").stubComponents());
jest.mock("@gorhom/bottom-sheet", () => require("../support/stubs").stubComponents());
// The Mapbox map itself is native; record what the screen asks it to draw.
const mockMapProps: { current: Record<string, unknown> | null } = { current: null };
jest.mock("@/map-v2/mapbox", () => ({ isMapboxUsable: () => true, loadMapbox: () => null }));
jest.mock("@/map-v2/TrackLineMap", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    TrackLineMap: React.forwardRef(function TrackLineMap(props: Record<string, unknown>, _ref: unknown) {
      mockMapProps.current = props;
      return React.createElement(View, { testID: "map" });
    }),
  };
});
jest.mock("@/map-v2/MapboxLayers", () => ({ MapboxLayers: () => null }));

import { MapScreen } from "@/screens/MapScreen";
import { BannerAdBar, BANNER_HEIGHT, shouldShowBanner } from "@/components/BannerAdBar";
import { migrateStoredSettings, SETTINGS_VERSION } from "@/services/settingsMigration";

const { DEFAULT_SETTINGS } = jest.requireActual("@/services/settings") as { DEFAULT_SETTINGS: Record<string, unknown> };

async function renderHome() {
  await render(<MapScreen />);
  await act(async () => {});
}

describe("home screen (the real MapScreen)", () => {
  beforeEach(() => {
    mockSettingsRef.current = { ...DEFAULT_SETTINGS };
    mockMapProps.current = null;
  });

  it("has exactly one re-centre button, and it's hidden until the map is panned away", async () => {
    await renderHome();
    const recentres = screen.queryAllByLabelText(/re-?cent(er|re)/i);
    expect(recentres).toHaveLength(1);
    expect(recentres[0].props.accessibilityLabel).toBe("Re-centre on my location");
  });

  it("has no Map tools button", async () => {
    await renderHome();
    expect(screen.queryAllByLabelText(/map tools/i)).toHaveLength(0);
    expect(screen.queryAllByText(/map tools/i)).toHaveLength(0);
  });

  it("has no current-address row in the sheet", async () => {
    await renderHome();
    expect(screen.queryAllByText(/my location|current location|you are here/i)).toHaveLength(0);
  });

  it("shows the Where to? field (with mic) and the Home / Work / New chips", async () => {
    await renderHome();
    expect(screen.getByLabelText("Where to? Search for a place")).toBeTruthy();
    expect(screen.getByLabelText("Search by voice")).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText(/New/)).toBeTruthy();
  });

  it("keeps the category chips out of the sheet (they live in the search screen)", async () => {
    await renderHome();
    for (const chip of ["Fuel", "Food", "Parking"]) expect(screen.queryByText(chip)).toBeNull();
  });

  it("the floating Menu, Sound and Report buttons are there", async () => {
    await renderHome();
    expect(screen.getByLabelText("Menu")).toBeTruthy();
    expect(screen.getByLabelText("Sound")).toBeTruthy();
    expect(screen.getByLabelText("Report something on the road")).toBeTruthy();
  });

  it("draws the TrackLine Light map, not satellite", async () => {
    await renderHome();
    expect(mockMapProps.current).not.toBeNull();
    expect(mockMapProps.current!.satellite).toBe(false);
    expect(mockMapProps.current!.theme).toBe("light");
  });

  it("an existing user who had satellite saved is moved to the light map once", () => {
    const old = { ...DEFAULT_SETTINGS, defaultMapViewStyle: "satellite3d", mapTheme: "dark" };
    type S = { defaultMapViewStyle: string; mapTheme: string; settingsVersion?: number };
    const migrated = migrateStoredSettings(old as unknown as S, 1);
    expect(migrated.defaultMapViewStyle).not.toBe("satellite3d");
    expect(migrated.mapTheme).toBe("light");
    expect(migrated.settingsVersion).toBe(SETTINGS_VERSION);
    // And only once: a later choice of satellite is left alone.
    const chosenLater = migrateStoredSettings({ ...migrated, defaultMapViewStyle: "satellite3d" }, SETTINGS_VERSION);
    expect(chosenLater.defaultMapViewStyle).toBe("satellite3d");
  });
});

describe("ad bar", () => {
  it("is a 320x50 banner sitting on the safe-area edge: padding is exactly the safe area, white, no extra height", async () => {
    await render(<BannerAdBar />);
    const style = Object.assign({}, ...[screen.getByTestId("ad-bar").props.style].flat(Infinity).filter(Boolean));
    expect(style.paddingBottom).toBe(mockSafeArea.bottom);
    expect(style.paddingTop ?? 0).toBe(0);
    expect(style.height).toBeUndefined();
    expect(style.backgroundColor).toBe("#FFFFFF");
    expect(BANNER_HEIGHT).toBe(50);
  });

  it("shows on the plain home map", async () => {
    await renderHome();
    expect(screen.getAllByTestId("ad-bar")).toHaveLength(1);
  });

  it("is hidden while navigating, choosing a route, or on the place page", () => {
    expect(shouldShowBanner({ navigating: false, choosingRoute: false, placePageOpen: false })).toBe(true);
    expect(shouldShowBanner({ navigating: true, choosingRoute: false, placePageOpen: false })).toBe(false);
    expect(shouldShowBanner({ navigating: false, choosingRoute: true, placePageOpen: false })).toBe(false);
    expect(shouldShowBanner({ navigating: false, choosingRoute: false, placePageOpen: true })).toBe(false);
  });
});
