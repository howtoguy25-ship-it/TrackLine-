// Settings > About > Diagnostics and the map's error card: what the owner sees on the phone when
// the map or routing isn't working -- the real reason, never a key.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react-native";

const PLACEHOLDER = "***** (This is a sensitive env variable. To access it, run command with --include-sensitive flag. Learn more.)";
const mockEnv = { mapboxPublicToken: PLACEHOLDER, googleDirectionsApiKey: "AIzaG", googlePlacesApiKey: "AIzaP", firebase: { projectId: "p" } };
jest.mock("@/config/env", () => ({ get env() { return mockEnv; } }));
jest.mock("@/services/firebase", () => ({ auth: { currentUser: null }, db: {} }));
const mockGetDoc = jest.fn(() => Promise.resolve({ exists: () => true }));
jest.mock("firebase/firestore", () => ({ doc: () => ({}), getDocFromServer: () => mockGetDoc() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ setOptions: () => {}, navigate: () => {}, goBack: () => {} }) }));
jest.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ settings: { appearance: "light" }, updateSettings: () => Promise.resolve() }) }));
jest.mock("@/config/getBuildStamp", () => ({ getBuildStamp: () => "1.3.0 (203) · c0ffee1" }));
let mockLinked = true;
let mockLoaded: object | null = null;
jest.mock("@/map-v2/mapbox", () => ({
  isMapboxNativeLinked: () => mockLinked,
  loadMapbox: () => mockLoaded,
  mapboxUnavailableReason: () => {
    const { mapboxTokenState, TOKEN_STATE_TEXT } = require("@/config/mapboxToken");
    const s = mapboxTokenState(mockEnv.mapboxPublicToken);
    return s !== "ok" ? TOKEN_STATE_TEXT[s] : mockLinked ? null : "Map engine isn't included in this build";
  },
}));

import { DiagnosticsScreen, directionsLine } from "@/screens/DiagnosticsScreen";
import { TrackLineMap, mapLoadErrorText } from "@/map-v2/TrackLineMap";
import { recordDirections, recordMapStyle, resetDiagnostics, getDiagnostics } from "@/diagnostics/diagnostics";

const row = (label: string) => screen.getByTestId(`diag-${label}`);

beforeEach(() => {
  resetDiagnostics();
  mockEnv.mapboxPublicToken = PLACEHOLDER;
  mockLinked = true;
});

describe("Diagnostics", () => {
  it("build 202's state: token is placeholder text, Mapbox 401, Google + Firebase fine", async () => {
    recordMapStyle(false, "Map service key missing (the build has placeholder text instead of the key)");
    recordDirections("bike", { provider: "mapbox", status: 401, ok: false, message: "Map service rejected the key" });
    recordDirections("drive", { provider: "google", status: 200, ok: true, message: "3 routes" });
    await render(<DiagnosticsScreen />);
    await waitFor(() => screen.getByText("Yes (not signed in)"));
    // Both the token row and the style row say so.
    expect(screen.getAllByText("No — Map service key missing (the build has placeholder text instead of the key)")).toHaveLength(2);
    expect(screen.getByText("Failed · Mapbox · HTTP 401 · Map service rejected the key")).toBeTruthy();
    expect(screen.getByText("OK · Google · HTTP 200 · 3 routes")).toBeTruthy();
    expect(screen.getAllByText("Not asked yet this session").length).toBeGreaterThan(0);
    expect(screen.getByText("1.3.0 (203) · c0ffee1")).toBeTruthy();
    // The placeholder text and keys are never printed.
    expect(screen.queryByText(/include-sensitive/)).toBeNull();
    expect(screen.queryByText(/AIza/)).toBeNull();
  });

  it("a working build: token shown only as its last 4 characters; style loaded", async () => {
    mockEnv.mapboxPublicToken = "pk.eyJ1IjoidHJhY2tsaW5lIn0.AbCdEfGh1234";
    recordMapStyle(true);
    await render(<DiagnosticsScreen />);
    await waitFor(() => screen.getByText("Yes (not signed in)"));
    expect(screen.getByText("Yes (…1234)")).toBeTruthy();
    expect(screen.queryByText(/eyJ1/)).toBeNull();
    expect(row("Mapbox style loaded")).toBeTruthy();
    expect(screen.getAllByText("Yes").length).toBeGreaterThanOrEqual(2);
  });

  it("Firebase down -> says why", async () => {
    mockGetDoc.mockImplementationOnce(() => Promise.reject(new Error("Failed to get document because the client is offline.")));
    await render(<DiagnosticsScreen />);
    await waitFor(() => screen.getByText("No — Failed to get document because the client is offline."));
  });

  it("directions line wording", () => {
    expect(directionsLine(undefined)).toBe("Not asked yet this session");
    expect(directionsLine({ provider: "mapbox", status: null, ok: false, message: "No internet", atMs: 0 })).toBe("Failed · Mapbox · no answer · No internet");
  });
});

describe("Map error card instead of a blank grey map", () => {
  const props = {
    driver: null,
    theme: "day",
    labelLanguage: "local",
    roadThickness: "normal",
    satellite: false,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    initialCenter: { latitude: -33.86, longitude: 151.2 },
    initialZoom: 15,
  } as unknown as React.ComponentProps<typeof TrackLineMap>;

  it("placeholder token: the card says the key is missing, and Diagnostics records it", async () => {
    mockLoaded = null;
    await render(<TrackLineMap {...props} />);
    expect(screen.getByTestId("map-error-banner")).toBeTruthy();
    expect(screen.getByText("Map service key missing (the build has placeholder text instead of the key)")).toBeTruthy();
    expect(getDiagnostics().mapStyle).toMatchObject({ loaded: false });
  });

  it("which loading errors become a card, and in what words", () => {
    expect(mapLoadErrorText({ type: "style", error: "HTTP status code 401" })).toBe("Map service rejected the key");
    expect(mapLoadErrorText({ type: "tile", error: "Unauthorized" })).toBe("Map service rejected the key");
    expect(mapLoadErrorText({ type: "source", error: "403 Forbidden" })).toBe("Map service rejected the key (it isn't allowed for this app)");
    expect(mapLoadErrorText({ type: "style", error: "The Internet connection appears to be offline." })).toBe("No internet -- the map can't load");
    expect(mapLoadErrorText({ type: "tile", error: "timeout" })).toBeNull();
    expect(mapLoadErrorText({ type: "sprite", error: "bad" })).toBe("Map couldn't load (sprite)");
  });
});
