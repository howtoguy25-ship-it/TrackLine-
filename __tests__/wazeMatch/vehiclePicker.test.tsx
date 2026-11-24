// Waze-match §3: "What's your ride?" -- shown once, Skip keeps car, the choice persists and syncs
// to the account when signed in, and changing vehicle re-requests routes with the right profile.
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/services/firebase", () => ({ db: {} }));
const setDocCalls: unknown[][] = [];
jest.mock("firebase/firestore", () => ({
  doc: (...path: unknown[]) => ({ path: path.slice(1).join("/") }),
  setDoc: (...args: unknown[]) => {
    setDocCalls.push(args);
    return Promise.resolve();
  },
  getDoc: () => Promise.resolve({ exists: () => false, data: () => ({}) }),
}));
let mockUser: { uid: string } | null = null;
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

import { VehiclePickerScreen, VEHICLE_PICKER_LINE, VEHICLE_PICKER_TITLE } from "@/components/VehiclePicker";
import { TravelModeSheet } from "@/components/RouteSelection";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import { DEFAULT_SETTINGS } from "@/services/settings";
import { CHOICE_LISTS } from "@/settings/choiceLists";
import {
  MOTORCYCLE_BETA_NOTE,
  TAXI_NOTE,
  VEHICLE_OPTIONS,
  markerAfterVehicleChange,
  shouldShowVehiclePicker,
  twoWheelerSupported,
  vehicleForMode,
  vehicleMode,
  vehiclePatch,
  vehicleRouteNote,
} from "@/services/vehicle";
import { MOTORBIKE_FALLBACK_NOTE, fetchRoutesForMode } from "@/travel/modeRouting";
import AsyncStorage from "@react-native-async-storage/async-storage";
import carJson from "../fixtures/travel/bankstown-parramatta.json";

const ok = (body: unknown, good = true) => Promise.resolve({ ok: good, status: good ? 200 : 400, json: () => Promise.resolve(body), text: () => Promise.resolve("") } as Response);
const quay = { latitude: -33.861, longitude: 151.2108 };
const opera = { latitude: -33.8568, longitude: 151.2153 };
const PK = "pk.eyJ1IjoidGVzdCJ9.abcDEF123";

describe("shown once, after the location question", () => {
  it("first run (guest or signed in): shows once location is answered, never before settings load", () => {
    expect(shouldShowVehiclePicker({ settingsLoaded: false, chosen: false, locationAnswered: true })).toBe(false);
    expect(shouldShowVehiclePicker({ settingsLoaded: true, chosen: false, locationAnswered: false })).toBe(false);
    expect(shouldShowVehiclePicker({ settingsLoaded: true, chosen: false, locationAnswered: true })).toBe(true);
  });
  it("after Done or Skip it never shows again (the choice is saved with the settings)", () => {
    const after = { ...DEFAULT_SETTINGS, ...vehiclePatch(DEFAULT_SETTINGS, "car") };
    expect(after.vehicleChosen).toBe(true);
    expect(shouldShowVehiclePicker({ settingsLoaded: true, chosen: after.vehicleChosen, locationAnswered: true })).toBe(false);
  });
  it("a signed-in account that already chose on another phone doesn't see it (synced setting)", () => {
    const pulled = { ...DEFAULT_SETTINGS, ...{ vehicleType: "motorcycle" as const, vehicleChosen: true } };
    expect(shouldShowVehiclePicker({ settingsLoaded: true, chosen: pulled.vehicleChosen, locationAnswered: true })).toBe(false);
  });
});

describe("the screen", () => {
  it("our title and line; Private car · Motorcycle · Taxi; Private car ticked", async () => {
    const r = await render(<VehiclePickerScreen onDone={jest.fn()} />);
    expect(r.getByText(VEHICLE_PICKER_TITLE)).toBeTruthy();
    expect(r.getByText(VEHICLE_PICKER_LINE)).toBeTruthy();
    expect(VEHICLE_OPTIONS.map((o) => o.label)).toEqual(["Private car", "Motorcycle", "Taxi"]);
    expect(r.getByTestId("vehicle-car").props.accessibilityState.selected).toBe(true);
    expect(r.getByTestId("vehicle-motorcycle").props.accessibilityState.selected).toBe(false);
    r.unmount();
  });
  it("Done saves the picked vehicle", async () => {
    const onDone = jest.fn();
    const r = await render(<VehiclePickerScreen onDone={onDone} />);
    await fireEvent.press(r.getByTestId("vehicle-motorcycle"));
    await fireEvent.press(r.getByTestId("vehicle-done"));
    expect(onDone).toHaveBeenCalledWith("motorcycle");
    r.unmount();
  });
  it("Skip keeps Private car, even after tapping another row", async () => {
    const onDone = jest.fn();
    const r = await render(<VehiclePickerScreen onDone={onDone} />);
    await fireEvent.press(r.getByTestId("vehicle-taxi"));
    await fireEvent.press(r.getByTestId("vehicle-skip"));
    expect(onDone).toHaveBeenCalledWith("car");
    r.unmount();
  });
});

describe("persists and syncs", () => {
  beforeEach(() => {
    setDocCalls.length = 0;
  });
  function Probe({ onReady }: { onReady: (api: ReturnType<typeof useSettings>) => void }) {
    const api = useSettings();
    onReady(api);
    return null;
  }
  async function choose(vehicle: "motorcycle") {
    let api: ReturnType<typeof useSettings> | null = null;
    const r = await render(
      <SettingsProvider>
        <Probe onReady={(a) => (api = a)} />
      </SettingsProvider>
    );
    await act(async () => {
      await new Promise((res) => setTimeout(res, 0));
    });
    await act(async () => {
      await api!.updateSettings(vehiclePatch(api!.settings, vehicle));
    });
    const stored = JSON.parse((await AsyncStorage.getItem("@trackline/settings")) ?? "null");
    r.unmount();
    return { stored, final: api!.settings };
  }
  it("guest: saved on this phone, nothing sent to an account", async () => {
    mockUser = null;
    const { final, stored } = await choose("motorcycle");
    expect(stored).toMatchObject({ vehicleType: "motorcycle", vehicleChosen: true }); // remembered on this device
    expect(final.vehicleType).toBe("motorcycle");
    expect(final.vehicleChosen).toBe(true);
    expect(final.mapMarkerStyle).toBe("motorbike"); // the vehicle sets the default icon
    expect(setDocCalls).toHaveLength(0);
  });
  it("signed in: the same change is pushed to users/{uid}.settings", async () => {
    mockUser = { uid: "u1" };
    await choose("motorcycle");
    const push = setDocCalls.find((c) => (c[0] as { path: string }).path === "users/u1");
    expect(push).toBeTruthy();
    expect((push![1] as { settings: { vehicleType: string; vehicleChosen: boolean } }).settings).toMatchObject({ vehicleType: "motorcycle", vehicleChosen: true });
    mockUser = null;
  });
});

describe("Settings > Driving preferences > Vehicle type", () => {
  it("exactly one ticked; picking one is the same change as the picker", () => {
    const l = CHOICE_LISTS.vehicleType;
    expect(l.title).toBe("Vehicle type");
    expect(l.options(DEFAULT_SETTINGS).map((o) => o.key)).toEqual(["car", "motorcycle", "taxi"]);
    expect(l.selected(DEFAULT_SETTINGS)).toBe("car");
    expect(l.patch("taxi", DEFAULT_SETTINGS)).toEqual(vehiclePatch(DEFAULT_SETTINGS, "taxi"));
    expect(l.patch("rocket", DEFAULT_SETTINGS)).toEqual({});
  });
  it("your own icon choice is kept; an untouched icon follows the vehicle", () => {
    expect(markerAfterVehicleChange("default", "car", "taxi")).toBe("taxi");
    expect(markerAfterVehicleChange("taxi", "taxi", "car")).toBe("default");
    expect(markerAfterVehicleChange("sportsCar", "car", "motorcycle")).toBe("sportsCar");
  });
});

describe("changing vehicle re-requests routes with the right profile", () => {
  it("vehicle -> mode, and a driving mode -> vehicle", () => {
    expect(vehicleMode("car")).toBe("drive");
    expect(vehicleMode("taxi")).toBe("drive");
    expect(vehicleMode("motorcycle")).toBe("motorbike");
    expect(vehicleForMode("motorbike", "car")).toBe("motorcycle");
    expect(vehicleForMode("drive", "motorcycle")).toBe("car");
    expect(vehicleForMode("drive", "taxi")).toBe("taxi");
    expect(vehicleForMode("walk", "taxi")).toBeNull();
  });

  it("motorcycle where Google has TWO_WHEELER (Thailand): a two-wheeler request, with Google's beta note", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      if (url.includes("routes.googleapis.com")) bodies.push(JSON.parse(String(init?.body)));
      return ok({ routes: [{ distanceMeters: 1200, duration: "300s", polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" }, legs: [{ steps: [] }] }] });
    }) as unknown as typeof fetch;
    const r = await fetchRoutesForMode("motorbike", { origin: quay, destination: opera, region: "TH" }, { mapboxToken: PK, googleKey: "k", transit: async () => [], fetchImpl });
    expect((bodies[0] as { travelMode: string }).travelMode).toBe("TWO_WHEELER");
    expect(r.note).toBe(MOTORCYCLE_BETA_NOTE);
  });

  it("motorcycle in Australia: no (billed) two-wheeler request; car routes, labelled", async () => {
    expect(twoWheelerSupported("AU")).toBe(false);
    const urls: string[] = [];
    const fetchImpl = ((url: string) => {
      urls.push(url);
      return ok(carJson);
    }) as unknown as typeof fetch;
    const r = await fetchRoutesForMode("motorbike", { origin: quay, destination: opera, region: "AU" }, { mapboxToken: PK, googleKey: "k", transit: async () => [], fetchImpl });
    expect(urls.some((u) => u.includes("routes.googleapis.com"))).toBe(false);
    expect(r.note).toBe(MOTORBIKE_FALLBACK_NOTE);
    expect(r.routes.length).toBeGreaterThan(0);
  });

  it("taxi: car routes, and says the bus/taxi lanes aren't in the data", () => {
    expect(vehicleRouteNote("taxi", "drive")).toBe(TAXI_NOTE);
    expect(vehicleRouteNote("car", "drive")).toBeNull();
  });

  it("the Getting there sheet switches vehicle (MapScreen then re-requests routes in that mode)", async () => {
    const onSelectVehicle = jest.fn();
    const r = await render(
      <TravelModeSheet visible mode="drive" summaries={{}} ferryAvailable={false} onSelect={jest.fn()} onClose={jest.fn()} vehicle="car" onSelectVehicle={onSelectVehicle} />
    );
    await fireEvent.press(r.getByTestId("vehicle-taxi"));
    expect(onSelectVehicle).toHaveBeenCalledWith("taxi");
    r.unmount();
  });
});
