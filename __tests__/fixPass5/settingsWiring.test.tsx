// Fix pass 5 §9: every setting the driver can change from the ETA sheet / Settings is wired end
// to end -- it changes what the app does (the real function that reads it), it's saved on the
// phone (AsyncStorage) and it's pushed to the account (users/{uid}.settings) when signed in.
//
// Found and fixed in this pass:
//   * Satellite (ETA sheet, map tools): only flipped a screen state, forgotten next launch and
//     never synced -> now the setting itself (defaultMapViewStyle "satellite3d").
//   * Sound & voice (on/off, volume, voice, language): saved on the phone only, never synced ->
//     now mirrored into settings.voice, pushed, and applied on another phone at sign-in.
//   * Two changes in quick succession: the second write started from a stale copy and undid the
//     first (SettingsContext used the render's `settings`) -> one always-current copy.
import React from "react";
import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/services/firebase", () => ({ db: {} }));
const setDocCalls: unknown[][] = [];
let mockRemote: Record<string, unknown> | null = null;
jest.mock("firebase/firestore", () => ({
  doc: (...path: unknown[]) => ({ path: path.slice(1).join("/") }),
  setDoc: (...args: unknown[]) => {
    setDocCalls.push(args);
    return Promise.resolve();
  },
  getDoc: () => Promise.resolve({ exists: () => !!mockRemote, data: () => ({ settings: mockRemote }) }),
}));
let mockUser: { uid: string } | null = { uid: "u1" };
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import { DEFAULT_SETTINGS, SETTINGS_VERSION, type AppSettings } from "@/services/settings";
import { navFollowPose } from "@/nav/navCamera";
import { shouldSpeakPhrase } from "@/services/navSpeechPlan";
import { liveViewShown } from "@/nav/liveScene";
import { avoidRouteOptions } from "@/map/routeChoices";
import { vehicleMode } from "@/services/vehicle";
import { formatDistance } from "@/utils/navFormat";
import { effectiveMapTheme } from "@/map-v2/styles/mapAppearance";
import { visibleCommunityAlerts } from "@/map/reportPins";

const map = readFileSync("src/screens/MapScreen.tsx", "utf8");
const here = { latitude: -33.9, longitude: 151.1 };

type Api = ReturnType<typeof useSettings>;
function Probe({ onReady }: { onReady: (api: Api) => void }) {
  onReady(useSettings());
  return null;
}
async function mount() {
  let api: Api | null = null;
  const r = await render(
    <SettingsProvider>
      <Probe onReady={(a) => (api = a)} />
    </SettingsProvider>
  );
  await act(async () => {
    await new Promise((res) => setTimeout(res, 0));
  });
  return { r, api: () => api! };
}
const pushedSettings = () => {
  const p = [...setDocCalls].reverse().find((c) => (c[0] as { path: string }).path === "users/u1");
  return p ? (p[1] as { settings: AppSettings }).settings : null;
};
const stored = async () => JSON.parse((await AsyncStorage.getItem("@trackline/settings")) ?? "null") as AppSettings;

beforeEach(async () => {
  setDocCalls.length = 0;
  mockRemote = null;
  mockUser = { uid: "u1" };
  await AsyncStorage.clear();
});

// Each setting: the change, and the real function the app runs with it (its live behaviour),
// plus where MapScreen feeds the setting into that function.
const report = { id: "r1", type: "police", lat: -33.9, lng: 151.1, createdAt: Date.now() } as never;
const CASES: { name: string; patch: Partial<AppSettings>; live: (s: AppSettings) => unknown; wiredIn: RegExp }[] = [
  { name: "Map view (flat / 3D)", patch: { defaultMapViewStyle: "flat" }, live: (s) => navFollowPose(here, 90, 50, s.defaultMapViewStyle === "flat").pitch, wiredIn: /settings\.defaultMapViewStyle === "flat"/ },
  { name: "Satellite", patch: { defaultMapViewStyle: "satellite3d" }, live: (s) => (s.defaultMapViewStyle === "satellite3d" ? "hybrid" : "standard"), wiredIn: /setMapType\(appliedMapViewStyle === "satellite3d" \? "hybrid" : "standard"\)/ },
  { name: "Spoken directions", patch: { spokenDirections: "off" }, live: (s) => shouldSpeakPhrase(s.spokenDirections, { kind: "start" }), wiredIn: /mode: settings\.spokenDirections/ },
  { name: "Dashcam live road view", patch: { liveRoadView: true }, live: (s) => liveViewShown(s.liveRoadView, true, true), wiredIn: /liveViewShown\(settings\.liveRoadView/ },
  { name: "Dashcam auto-share detections", patch: { autoShareDetections: true }, live: (s) => s.autoShareDetections, wiredIn: /useLatest\(settings\.autoShareDetections\)/ },
  { name: "Avoid", patch: { routeAvoid: { ...DEFAULT_SETTINGS.routeAvoid, tolls: true } }, live: (s) => avoidRouteOptions(s.routeAvoid), wiredIn: /avoidRouteOptions\(settings\.routeAvoid\)/ },
  { name: "Vehicle type", patch: { vehicleType: "motorcycle" }, live: (s) => vehicleMode(s.vehicleType), wiredIn: /vehicleMode\(settings\.vehicleType\)/ },
  { name: "Alerts on the map", patch: { alertsEnabled: false }, live: (s) => s.alertsEnabled, wiredIn: /const alertsOn = !!user && settings\.alertsEnabled/ },
  { name: "Alert types shown", patch: { visibleAlertTypes: [] }, live: (s) => visibleCommunityAlerts(s as never, [report]).length, wiredIn: /visibleCommunityAlerts\(settings, nearbyAlerts/ },
  { name: "Units", patch: { distanceUnit: "miles" }, live: (s) => formatDistance(1609, s.distanceUnit), wiredIn: /distanceUnit=\{settings\.distanceUnit\}/ },
  { name: "Dark mode", patch: { mapDarkMode: "on" }, live: (s) => effectiveMapTheme("light", s.mapDarkMode, { systemDark: false, night: false }), wiredIn: /useMapScheme\(\)/ },
];

describe("every setting: live behaviour, saved on the phone, synced to the account", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      // Live behaviour: the function the app runs gives a different answer with the new value.
      expect(JSON.stringify(c.live({ ...DEFAULT_SETTINGS, ...c.patch }))).not.toBe(JSON.stringify(c.live(DEFAULT_SETTINGS)));
      expect(map).toMatch(c.wiredIn);
      const { r, api } = await mount();
      await act(async () => {
        await api().updateSettings(c.patch);
      });
      expect(api().settings).toMatchObject(c.patch); // the running app sees it at once
      expect(await stored()).toMatchObject(c.patch); // persists
      expect(pushedSettings()).toMatchObject(c.patch); // syncs
      await r.unmount();
    });
  }
});

describe("the two that weren't wired (fixed here)", () => {
  it("Satellite rows in the sheets change the saved setting, not just the screen", () => {
    expect(map.match(/onToggleSatellite=\{toggleSatelliteSetting\}/g)?.length).toBe(2);
    expect(map).not.toMatch(/onToggleSatellite=\{\(\) => setMapType/);
    expect(map).toMatch(/updateSettings\(\{ defaultMapViewStyle: style \}\)/);
  });

  it("Sound & voice: on/off, volume and voice sync to the account", async () => {
    const { r, api } = await mount();
    await act(async () => {
      await api().toggleVoiceEnabled();
    });
    expect(pushedSettings()?.voice).toMatchObject({ enabled: false });
    await act(async () => {
      await api().setVoiceVolume(0.4);
    });
    expect(pushedSettings()?.voice).toMatchObject({ enabled: false, volume: 0.4 });
    await act(async () => {
      await api().setVoiceIdentifier("com.apple.voice.Karen", "en");
    });
    expect(pushedSettings()?.voice).toMatchObject({ enabled: false, volume: 0.4, identifier: "com.apple.voice.Karen", language: "en" });
    expect((await stored()).voice).toMatchObject({ enabled: false, volume: 0.4 });
    await r.unmount();
  });

  it("...and a phone signing in picks them up", async () => {
    mockRemote = { settingsVersion: SETTINGS_VERSION, voice: { enabled: false, volume: 0.3, identifier: "v-1", language: "en" } };
    const { r, api } = await mount();
    await act(async () => {
      await new Promise((res) => setTimeout(res, 0));
    });
    expect(api().voiceEnabled).toBe(false);
    expect(api().voiceVolume).toBe(0.3);
    expect(api().voiceIdentifier).toBe("v-1");
    await r.unmount();
  });

  it("guest: saved on this phone, nothing sent anywhere", async () => {
    mockUser = null;
    const { r, api } = await mount();
    await act(async () => {
      await api().updateSettings({ distanceUnit: "miles" });
      await api().toggleVoiceEnabled();
    });
    expect((await stored()).distanceUnit).toBe("miles");
    expect(setDocCalls).toHaveLength(0);
    await r.unmount();
  });
});

describe("back-to-back changes (bug found by this audit)", () => {
  it("two changes in a row both survive: each write starts from the one before it", async () => {
    const { r, api } = await mount();
    await act(async () => {
      await api().updateSettings({ distanceUnit: "miles" });
      await api().updateSettings({ mapDarkMode: "on" });
      await api().toggleVoiceEnabled();
    });
    expect(await stored()).toMatchObject({ distanceUnit: "miles", mapDarkMode: "on", voice: { enabled: false } });
    expect(pushedSettings()).toMatchObject({ distanceUnit: "miles", mapDarkMode: "on", voice: { enabled: false } });
    await r.unmount();
  });
});
