// PROOF for Settings > Map information & overlays > Reports: every switch really hides/shows its
// pins, really suppresses/enables its alert and spoken line, and survives a restart.
import { describe, expect, it } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from "@/services/settings";
import {
  REPORT_ITEMS,
  REPORT_ITEM_BY_ID,
  alertsWhileDriving,
  isComingSoon,
  isShown,
  prefPatch,
  type ReportItemId,
} from "@/settings/reportCatalog";
import { OSM_FEATURE_KINDS, type OsmTrafficData } from "@/services/osmTrafficData";
import { osmFeaturePins, showsSpeedCameraPins, showsTrafficLightPins, visibleCommunityAlerts, visibleIncidents } from "@/map/reportPins";
import { collectApproachFeatures, type FeatureSources } from "@/alerts/collectFeatures";
import { nextApproachAlert } from "@/alerts/approachAlerts";
import { planPhrase, shouldSpeakPhrase } from "@/services/navSpeechPlan";
import type { AlertType } from "@/types/alert";
import type { TrafficIncident } from "@/services/trafficNswModel";

// The car at -33.8700,151.2000 heading north at 60 km/h; every feature 300 m straight ahead.
const CAR = { latitude: -33.87, longitude: 151.2 };
const AHEAD = { lat: -33.87 + 300 / 111_320, lng: 151.2 };

const COMMUNITY_TYPE: Partial<Record<ReportItemId, AlertType>> = {
  police: "police",
  crash: "crash",
  otherHazards: "hazard",
  mobilePoliceCamera: "camera",
  emergencyVehicles: "emergency_vehicle",
};
const LTN: Partial<Record<ReportItemId, Pick<TrafficIncident, "kind" | "category" | "headline">>> = {
  roadwork: { kind: "roadwork", category: "Roadwork", headline: "Roadwork" },
  badWeather: { kind: "flood", category: "Flooding", headline: "Flooding" },
  animals: { kind: "incident", category: "Animal", headline: "Animal on road" },
  blockedLane: { kind: "incident", category: "Lane closure", headline: "Left lane closed" },
  closures: { kind: "incident", category: "Road closure", headline: "Road closed" },
  carOnShoulder: { kind: "incident", category: "Breakdown", headline: "Broken down vehicle" },
  traffic: { kind: "incident", category: "Heavy Traffic", headline: "Heavy traffic" },
};

/** One real-shaped piece of data for this item, from its own source. */
function sourcesFor(id: ReportItemId): FeatureSources {
  const osm: OsmTrafficData = { trafficLights: [], speedCameras: [], features: {} };
  const src: FeatureSources = { osm, alerts: [], incidents: [] };
  if ((OSM_FEATURE_KINDS as readonly string[]).includes(id)) osm.features[id as (typeof OSM_FEATURE_KINDS)[number]] = [{ id: 1, ...AHEAD }];
  if (id === "trafficLights") osm.trafficLights.push({ id: 1, ...AHEAD });
  if (id === "speedCamera") osm.speedCameras.push({ id: 1, ...AHEAD });
  const type = COMMUNITY_TYPE[id];
  if (type) src.alerts = [{ id: "a1", type, ...AHEAD, createdBy: "someone" }];
  const ltn = LTN[id];
  if (ltn) src.incidents = [{ id: "i1", ...ltn, ...AHEAD }];
  return src;
}

/** Is a pin of this item on the map, from these sources? */
function pinsDrawn(settings: AppSettings, id: ReportItemId, src: FeatureSources): boolean {
  if (id === "trafficLights") return showsTrafficLightPins(settings) && (src.osm?.trafficLights.length ?? 0) > 0;
  if (id === "speedCamera") return showsSpeedCameraPins(settings) && (src.osm?.speedCameras.length ?? 0) > 0;
  return (
    osmFeaturePins(settings, src.osm).some((p) => p.kind === id) ||
    visibleCommunityAlerts(settings, src.alerts).length > 0 ||
    visibleIncidents(settings, src.incidents as TrafficIncident[]).length > 0
  );
}

function alertFires(settings: AppSettings, src: FeatureSources): ReportItemId | null {
  const features = collectApproachFeatures(settings, src);
  const { alert } = nextApproachAlert(features, { nowMs: 1, position: CAR, headingDeg: 0, speedKmh: 60 }, {});
  return alert?.item ?? null;
}

const withPatch = (s: AppSettings, id: ReportItemId, which: "show" | "alert", v: boolean): AppSettings => ({ ...s, ...prefPatch(s, id, which, v) });

// Items whose pins/alerts come from map data (the rest use their own paths, tested below).
const MAP_DATA_ITEMS = REPORT_ITEMS.filter((i) => !isComingSoon(i.id) && (OSM_FEATURE_KINDS as readonly string[]).concat(["trafficLights", "speedCamera"], Object.keys(COMMUNITY_TYPE), Object.keys(LTN)).includes(i.id));

describe("Show on map", () => {
  const showable = MAP_DATA_ITEMS.filter((i) => i.show);
  it.each(showable.map((i) => [i.id]))("%s: switch off hides its pins, on shows them", (id) => {
    const src = sourcesFor(id as ReportItemId);
    const on = withPatch(DEFAULT_SETTINGS, id as ReportItemId, "show", true);
    const off = withPatch(DEFAULT_SETTINGS, id as ReportItemId, "show", false);
    expect(pinsDrawn(on, id as ReportItemId, src)).toBe(true);
    expect(pinsDrawn(off, id as ReportItemId, src)).toBe(false);
  });
  it("covers every item with a Show on map switch and a map data source", () => {
    expect(showable.length).toBeGreaterThanOrEqual(20);
  });
});

describe("Alert while driving", () => {
  const alertable = MAP_DATA_ITEMS.filter((i) => i.alert);
  it.each(alertable.map((i) => [i.id]))("%s: switch on alerts and speaks, off is silent", (id) => {
    const item = id as ReportItemId;
    const src = sourcesFor(item);
    const on = withPatch(DEFAULT_SETTINGS, item, "alert", true);
    const off = withPatch(DEFAULT_SETTINGS, item, "alert", false);
    expect(alertFires(on, src)).toBe(item);
    expect(alertFires(off, src)).toBeNull();
    // ...and the spoken line exists, in every voice language, and is said in "Only alerts" mode.
    for (const language of ["en", "es", "ru", "tr", "ar"] as const) {
      expect(planPhrase({ kind: "feature", item }, { language }).fullText.length).toBeGreaterThan(5);
    }
    expect(shouldSpeakPhrase("onlyAlerts", { kind: "feature", item })).toBe(true);
    expect(shouldSpeakPhrase("off", { kind: "feature", item })).toBe(false);
  });

  it("never alerts a driver about their own report", () => {
    const src = sourcesFor("police");
    expect(alertFires(DEFAULT_SETTINGS, { ...src, ownUid: "someone" })).toBeNull();
  });

  it("very common features are off by default so alerts stay useful", () => {
    for (const id of ["trafficLights", "speedBump", "pedestrianCrossing"] as const) expect(alertsWhileDriving(DEFAULT_SETTINGS, id)).toBe(false);
    for (const id of ["speedCamera", "railwayCrossing", "police", "crash"] as const) expect(alertsWhileDriving(DEFAULT_SETTINGS, id)).toBe(true);
  });
});

describe("Coming soon in your area", () => {
  const soon = REPORT_ITEMS.filter((i) => isComingSoon(i.id));
  it.each(soon.map((i) => [i.id]))("%s has no source: never shown, never alerts, even if switched on", (id) => {
    const item = id as ReportItemId;
    let s = withPatch(DEFAULT_SETTINGS, item, "show", true);
    s = withPatch(s, item, "alert", true);
    expect(isShown(s, item)).toBe(false);
    expect(alertsWhileDriving(s, item)).toBe(false);
  });
  it("lists exactly the items with no data anywhere", () => {
    expect(soon.map((i) => i.id).sort()).toEqual(
      ["busLaneCamera", "carpoolLaneCamera", "crashHistory", "laneEnding", "mapChats", "narrowBridge", "noiseCamera", "shoulderEnding", "stopSignCamera", "trackyNeedsHelp", "transitLaneCamera"].sort()
    );
  });
});

describe("Older settings keep working", () => {
  it("speed cameras / traffic lights / school zones read and write their original keys", () => {
    expect(prefPatch(DEFAULT_SETTINGS, "speedCamera", "show", false)).toEqual({ showSpeedCameras: false });
    expect(prefPatch(DEFAULT_SETTINGS, "trafficLights", "show", false)).toEqual({ showTrafficLights: false });
    expect(prefPatch(DEFAULT_SETTINGS, "schoolZones", "show", false)).toEqual({ schoolZonesShowOnMap: false });
    expect(prefPatch(DEFAULT_SETTINGS, "schoolZones", "alert", false)).toEqual({ schoolZonesAlert: false });
    expect(isShown({ ...DEFAULT_SETTINGS, schoolZonesShowOnMap: false }, "schoolZones")).toBe(false);
    expect(alertsWhileDriving({ ...DEFAULT_SETTINGS, schoolZonesAlert: false }, "schoolZones")).toBe(false);
  });
  it("a report type turned off in the old Live alerts list stays hidden", () => {
    const s = { ...DEFAULT_SETTINGS, visibleAlertTypes: DEFAULT_SETTINGS.visibleAlertTypes.filter((t) => t !== "police") };
    expect(isShown(s, "police")).toBe(false);
    expect(isShown(withPatch(s, "police", "show", true), "police")).toBe(true);
  });
});

describe("Survives a restart", () => {
  it("every switch is saved and read back exactly", async () => {
    await AsyncStorage.clear();
    let s: AppSettings = DEFAULT_SETTINGS;
    for (const item of REPORT_ITEMS) {
      if (isComingSoon(item.id)) continue;
      if (item.show) s = withPatch(s, item.id, "show", !isShown(DEFAULT_SETTINGS, item.id));
      if (item.alert) s = withPatch(s, item.id, "alert", !alertsWhileDriving(DEFAULT_SETTINGS, item.id));
    }
    s = { ...s, showSpeedometer: false, speedLimitDisplay: "never", speedingThresholdPercent: 10, showSoundButton: false, showTrafficFlow: false };
    await saveSettings(s);
    const back = await loadSettings();
    for (const item of REPORT_ITEMS) {
      if (isComingSoon(item.id)) continue;
      if (item.show) expect([item.id, isShown(back, item.id)]).toEqual([item.id, !isShown(DEFAULT_SETTINGS, item.id)]);
      if (item.alert) expect([item.id, alertsWhileDriving(back, item.id)]).toEqual([item.id, !alertsWhileDriving(DEFAULT_SETTINGS, item.id)]);
    }
    expect(back).toMatchObject({ showSpeedometer: false, speedLimitDisplay: "never", speedingThresholdPercent: 10, showSoundButton: false, showTrafficFlow: false });
  });
});

describe("Every row is complete", () => {
  it.each(REPORT_ITEMS.map((i) => [i.id]))("%s has a title, description, explanation and its own icon", (id) => {
    const item = REPORT_ITEM_BY_ID[id as ReportItemId];
    expect(item.title.length).toBeGreaterThan(2);
    expect(item.description.length).toBeGreaterThan(5);
    expect(item.explanation.length).toBeGreaterThan(10);
    expect(item.icon.glyph).toBeTruthy();
    expect(item.show || item.alert).toBe(true);
  });
  it("no two camera items share the same icon", () => {
    const cams = REPORT_ITEMS.filter((i) => i.icon.glyph === "cctv").map((i) => `${i.icon.badge}|${i.icon.badge2}|${i.icon.colour}`);
    expect(new Set(cams).size).toBe(cams.length);
  });
});
