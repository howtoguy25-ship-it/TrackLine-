// Gap item 10: Settings > Offline maps -- download the area around you with real progress, see
// what's saved (size, ready or %), delete it, cancel a download; loading, empty, error + retry and
// "not available" states. Run against a stand-in for the phone's Mapbox offline store.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ setOptions: () => {}, navigate: () => {}, goBack: () => {} }) }));
jest.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ settings: { appearance: "light" }, updateSettings: () => Promise.resolve() }) }));
const mockLoc = { location: { coords: { latitude: -33.87, longitude: 151.2 } } as unknown, permissionGranted: true, requestPermission: jest.fn() };
jest.mock("@/context/LocationContext", () => ({ useLocation: () => mockLoc }));

type Listener = (pack: unknown, s: { percentage: number; completedResourceSize: number; state: number }) => void;
type Pack = { name: string; metadata: { label?: string; createdAt?: number } | null; status: () => Promise<{ percentage: number; completedResourceSize: number; state: number }> };
const mockStore = {
  packs: [] as Pack[],
  failList: false,
  hold: null as Promise<void> | null,
  progress: null as Listener | null,
  fail: null as ((pack: unknown, err: { message?: string }) => void) | null,
  created: [] as { name: string; bounds: number[][]; minZoom: number; maxZoom: number; metadata: Record<string, unknown> }[],
  deleted: [] as string[],
};
const mockOm = {
  getPacks: async () => {
    if (mockStore.hold) await mockStore.hold;
    if (mockStore.failList) throw new Error("store locked");
    return mockStore.packs;
  },
  createPack: async (opts: (typeof mockStore.created)[number], progress: Listener, err: typeof mockStore.fail) => {
    mockStore.created.push(opts);
    mockStore.progress = progress;
    mockStore.fail = err;
    mockStore.packs.push({ name: opts.name, metadata: opts.metadata as Pack["metadata"], status: async () => ({ percentage: 100, completedResourceSize: 42e6, state: 2 }) });
  },
  deletePack: async (name: string) => {
    mockStore.deleted.push(name);
    mockStore.packs = mockStore.packs.filter((p) => p.name !== name);
  },
};
let mockMapbox: object | null = { offlineManager: mockOm };
jest.mock("@/map-v2/mapbox", () => ({ loadMapbox: () => mockMapbox }));

import { OfflineMapsScreen } from "@/screens/OfflineMapsScreen";
import { areaBounds, formatBytes } from "@/map-v2/offlineArea";

beforeEach(() => {
  mockStore.packs = [
    { name: "trackline-route-1700000000000", metadata: null, status: async () => ({ percentage: 100, completedResourceSize: 12e6, state: 2 }) },
    { name: "someone-elses-pack", metadata: null, status: async () => ({ percentage: 100, completedResourceSize: 1, state: 2 }) },
  ];
  mockStore.failList = false;
  mockStore.hold = null;
  mockStore.created = [];
  mockStore.deleted = [];
  mockMapbox = { offlineManager: mockOm };
  mockLoc.permissionGranted = true;
  mockLoc.location = { coords: { latitude: -33.87, longitude: 151.2 } };
});

describe("Offline maps", () => {
  it("bounds are the chosen distance each way; sizes read in MB", () => {
    const [[e, n], [w, s]] = areaBounds({ latitude: -33.87, longitude: 151.2 }, 25);
    expect((n - s) * 111.32).toBeCloseTo(50, 1);
    expect(e).toBeGreaterThan(151.2);
    expect(w).toBeLessThan(151.2);
    expect(formatBytes(42e6)).toBe("42 MB");
  });

  it("lists TrackLine's saved maps only (a recent drive), with size and Ready", async () => {
    let answer = () => {};
    mockStore.hold = new Promise<void>((r) => (answer = r));
    await render(<OfflineMapsScreen />);
    expect(screen.getByTestId("offline-list-loading")).toBeTruthy();
    await act(async () => answer());
    await waitFor(() => expect(screen.getByTestId("offline-area-trackline-route-1700000000000")).toBeTruthy());
    expect(screen.getByText(/Ready · 12 MB/)).toBeTruthy();
    expect(screen.queryByTestId("offline-area-someone-elses-pack")).toBeNull();
  });

  it("Download: the radius chosen is what's downloaded; progress shows; when done it's listed", async () => {
    await render(<OfflineMapsScreen />);
    await waitFor(() => screen.getByTestId("offline-download"));
    await fireEvent.press(screen.getByText("50 km"));
    await fireEvent.press(screen.getByTestId("offline-download"));
    expect(mockStore.created).toHaveLength(1);
    const [[, n], [, s]] = mockStore.created[0].bounds;
    expect((n - s) * 111.32).toBeCloseTo(100, 1);
    expect(mockStore.created[0]).toMatchObject({ minZoom: 10, maxZoom: 15, metadata: { label: "50 km around you" } });
    expect(screen.getByTestId("offline-progress")).toBeTruthy();
    await act(() => mockStore.progress!(null, { percentage: 37.4, completedResourceSize: 15e6, state: 1 }));
    expect(screen.getByText("Downloading… 37%")).toBeTruthy();
    expect(screen.getByText("15 MB so far")).toBeTruthy();
    await act(() => mockStore.progress!(null, { percentage: 100, completedResourceSize: 42e6, state: 2 }));
    await waitFor(() => expect(screen.getByText("50 km around you")).toBeTruthy());
    expect(screen.getByTestId("offline-download")).toBeTruthy();
  });

  it("a failed download says why; Cancel deletes the pack", async () => {
    await render(<OfflineMapsScreen />);
    await waitFor(() => screen.getByTestId("offline-download"));
    await fireEvent.press(screen.getByTestId("offline-download"));
    await act(() => mockStore.fail!(null, { message: "Not authorized" }));
    expect(screen.getByText("Download failed: Not authorized")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("offline-download"));
    await fireEvent.press(screen.getByTestId("offline-cancel"));
    expect(mockStore.deleted).toEqual([mockStore.created[1].name]);
  });

  it("Delete removes a saved map", async () => {
    await render(<OfflineMapsScreen />);
    await waitFor(() => screen.getByTestId("offline-delete-trackline-route-1700000000000"));
    await fireEvent.press(screen.getByTestId("offline-delete-trackline-route-1700000000000"));
    expect(mockStore.deleted).toEqual(["trackline-route-1700000000000"]);
    await waitFor(() => expect(screen.getByTestId("offline-empty")).toBeTruthy());
  });

  it("the store can't be read: the reason, and Try again works", async () => {
    mockStore.failList = true;
    await render(<OfflineMapsScreen />);
    await waitFor(() => expect(screen.getByText("Couldn't read saved maps: store locked")).toBeTruthy());
    mockStore.failList = false;
    await fireEvent.press(screen.getByTestId("offline-list-retry"));
    await waitFor(() => expect(screen.getByTestId("offline-area-trackline-route-1700000000000")).toBeTruthy());
  });

  it("no location permission: asks for it instead of a dead button", async () => {
    mockLoc.permissionGranted = false;
    await render(<OfflineMapsScreen />);
    await waitFor(() => screen.getByTestId("offline-need-location"));
    await fireEvent.press(screen.getByTestId("offline-need-location"));
    expect(mockLoc.requestPermission).toHaveBeenCalled();
    expect(screen.queryByTestId("offline-download")).toBeNull();
  });

  it("no Mapbox in this version: says it's not available yet, and why", async () => {
    mockMapbox = null;
    await render(<OfflineMapsScreen />);
    expect(screen.getByText(/Not available yet: offline maps need the Mapbox map/)).toBeTruthy();
    expect(screen.queryByTestId("offline-download")).toBeNull();
  });
});
