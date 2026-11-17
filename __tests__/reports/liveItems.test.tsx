// PROOF: no "Coming soon" anywhere, and every Settings > Reports item is live today:
// reportable from the report grid, drawn as a pin, controlled by its switches, and alerting
// while driving -- plus the derived items computed from real data.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { execSync } from "child_process";
import path from "path";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { DEFAULT_SETTINGS, type AppSettings } from "@/services/settings";
import { REPORT_ITEMS, REPORT_ITEM_BY_ID, alertsWhileDriving, isShown, itemOfAlert, prefPatch, type ReportItemId } from "@/settings/reportCatalog";
import { DERIVED_ONLY, REPORT_CATEGORIES, baseTypeOf, isFixedItem } from "@/settings/reportGrid";
import { reportPinIcon, visibleCommunityAlerts, mergedReports, osmFeaturePins } from "@/map/reportPins";
import { collectApproachFeatures } from "@/alerts/collectFeatures";
import { nextApproachAlert } from "@/alerts/approachAlerts";
import { featureLine } from "@/alerts/featurePhrases";
import { planPhrase } from "@/services/navSpeechPlan";
import { laneEndingsInStep } from "@/nav/laneEndings";
import { crashHistorySpots, laneEndingFeatures, pathSpeedKmh, trackySlowdownAhead } from "@/alerts/derivedFeatures";
import { cardForReport, reportSourceLine } from "@/map/alertCard";
import type { AlertDoc } from "@/types/alert";

jest.mock("@gorhom/bottom-sheet", () => {
  const mockReact = jest.requireActual("react") as typeof import("react");
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  const Pass = ({ children }: { children?: unknown }) => mockReact.createElement(RN.View, null, children as never);
  const Sheet = mockReact.forwardRef((props: { children?: unknown }, _ref) => Pass(props));
  return { __esModule: true, default: Sheet, BottomSheetView: Pass };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import { AlertReportSheet } from "@/screens/AlertReportSheet";

const ROOT = path.join(__dirname, "../..");
const CAR = { latitude: -33.87, longitude: 151.2 };
const AHEAD = { lat: -33.87 + 300 / 111_320, lng: 151.2 };
const withPatch = (s: AppSettings, id: ReportItemId, which: "show" | "alert", v: boolean): AppSettings => ({ ...s, ...prefPatch(s, id, which, v) });

const REPORTABLE = REPORT_ITEMS.filter((i) => baseTypeOf(i.id) !== null).map((i) => i.id);
const report = (item: ReportItemId, over: Partial<AlertDoc> = {}): AlertDoc =>
  ({ id: `r-${item}`, type: baseTypeOf(item)!, item, ...AHEAD, geohash: "g", createdBy: "someone", createdAt: 0, expiresAt: 9e15, confirmCount: 1, denyCount: 0, hiddenBy: {}, ...over }) as AlertDoc;

describe("no Coming soon anywhere", () => {
  it("not in any app source file (git grep)", () => {
    let out = "";
    try {
      out = execSync('git grep -n -i "coming soon" -- src app.config.js web/public', { cwd: ROOT, encoding: "utf8" });
    } catch {
      out = ""; // git grep exits 1 when nothing matches
    }
    expect(out).toBe("");
  });
  it("not on the report grid, in any category", async () => {
    await render(<AlertReportSheet onItemSelected={() => {}} onRoadReport={() => {}} onClose={() => {}} />);
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });
});

describe("every item can be reported from the grid", () => {
  it("each reportable item is in exactly one category; the rest are derived or road-sheet items", () => {
    const inGrid = REPORT_CATEGORIES.flatMap((c) => (c.roadSheet ? [] : c.items));
    expect(new Set(inGrid).size).toBe(inGrid.length);
    expect([...inGrid].sort()).toEqual([...REPORTABLE].sort());
    const roadSheet = REPORT_CATEGORIES.filter((c) => c.roadSheet).flatMap((c) => c.items);
    const notReportable = REPORT_ITEMS.map((i) => i.id).filter((id) => !REPORTABLE.includes(id));
    expect(notReportable.sort()).toEqual([...roadSheet, ...DERIVED_ONLY].sort());
  });

  it.each(REPORTABLE.map((id) => [id]))("%s: tap its category, tap it, it's chosen for placing", async (id) => {
    const onItemSelected = jest.fn();
    await render(<AlertReportSheet onItemSelected={onItemSelected} onRoadReport={() => {}} onClose={() => {}} />);
    const cat = REPORT_CATEGORIES.find((c) => c.items.includes(id as ReportItemId) && !c.roadSheet)!;
    await fireEvent.press(screen.getByTestId(`report-category-${cat.id}`));
    if (cat.items.length > 1) await fireEvent.press(screen.getByTestId(`report-item-${id}`));
    expect(onItemSelected).toHaveBeenCalledWith(id);
  });

  it("Speed limit / school zone opens the road report sheet", async () => {
    const onRoadReport = jest.fn();
    await render(<AlertReportSheet onItemSelected={() => {}} onRoadReport={onRoadReport} onClose={() => {}} />);
    await fireEvent.press(screen.getByTestId("report-category-roadSigns"));
    expect(onRoadReport).toHaveBeenCalled();
  });
});

describe("a driver's report of every item: pin, switches, alert, voice", () => {
  it.each(REPORTABLE.map((id) => [id]))("%s", (id) => {
    const item = id as ReportItemId;
    const a = report(item);
    expect(itemOfAlert(a)).toBe(item);
    const def = REPORT_ITEM_BY_ID[item];
    // pin: drawn with its own icon, hidden when its switch is off
    if (def.show) {
      expect(visibleCommunityAlerts(withPatch(DEFAULT_SETTINGS, item, "show", true), [a])).toHaveLength(1);
      expect(visibleCommunityAlerts(withPatch(DEFAULT_SETTINGS, item, "show", false), [a])).toHaveLength(0);
    }
    expect(reportPinIcon(a)).toMatch(/^(alert|feature):/);
    // alert while driving, with its spoken line
    if (def.alert) {
      const fire = (s: AppSettings) => nextApproachAlert(collectApproachFeatures(s, { osm: null, alerts: [a], incidents: [] }), { nowMs: 1, position: CAR, headingDeg: 0, speedKmh: 60 }, {}).alert?.item ?? null;
      expect(fire(withPatch(DEFAULT_SETTINGS, item, "alert", true))).toBe(item);
      expect(fire(withPatch(DEFAULT_SETTINGS, item, "alert", false))).toBeNull();
      if (item !== "speedLimitChanges") {
        for (const language of ["en", "es", "ru", "tr", "ar"] as const) expect([item, language, !!featureLine(language, item)]).toEqual([item, language, true]);
        expect(planPhrase({ kind: "feature", item }).fullText.length).toBeGreaterThan(5);
      }
    }
  });
  it("older reports without an item still count as their type's item", () => {
    expect(itemOfAlert({ type: "camera" })).toBe("mobilePoliceCamera");
    expect(itemOfAlert({ type: "hazard", item: "nonsense" })).toBe("otherHazards");
  });
});

describe("merged sources: official > confirmed drivers > OSM", () => {
  const incident = { kind: "roadwork" as const, category: "Roadwork", headline: "Roadwork", ...AHEAD };
  const osm = { trafficLights: [], speedCameras: [], features: { speedBump: [{ id: 7, ...AHEAD }] } };
  it("a driver report Live Traffic NSW already lists is dropped", () => {
    expect(mergedReports([report("roadwork")], { incidents: [incident] })).toHaveLength(0);
    expect(mergedReports([report("animals")], { incidents: [incident] })).toHaveLength(1);
  });
  it("a confirmed report replaces the mapped OSM point; an unconfirmed one gives way to it", () => {
    expect(osmFeaturePins(DEFAULT_SETTINGS, osm, [report("speedBump")])).toHaveLength(0);
    expect(osmFeaturePins(DEFAULT_SETTINGS, osm, [])).toHaveLength(1);
    expect(mergedReports([report("speedBump", { confirmCount: 0 })], { osm })).toHaveLength(0);
    expect(mergedReports([report("speedBump", { confirmCount: 2 })], { osm })).toHaveLength(1);
  });
  it("the card says where it comes from", () => {
    expect(reportSourceLine({ confirmCount: 0, awaitingApproval: true })).toBe("Source: TrackLine drivers · waiting for confirmation");
    expect(reportSourceLine({ confirmCount: 2, awaitingApproval: true })).toBe("Source: TrackLine drivers · confirmed by 2 of 3");
    expect(reportSourceLine({ confirmCount: 3, permanent: true })).toBe("Source: TrackLine drivers · confirmed, stays on the map");
    const card = cardForReport(report("narrowBridge"), null);
    expect(card.title).toBe("Narrow bridge");
    expect(card.sourceLine).toBe("Source: TrackLine drivers · confirmed by 1");
  });
  it("fixed cameras and road features are the permanent kind; temporary reports aren't", () => {
    for (const id of ["speedCamera", "stopSignCamera", "busLaneCamera", "speedBump", "narrowBridge", "shoulderEnding", "laneEnding"] as const) expect([id, isFixedItem(id)]).toEqual([id, true]);
    for (const id of ["police", "crash", "roadwork", "mapChats", "trackyNeedsHelp", "mobilePoliceCamera"] as const) expect([id, isFixedItem(id)]).toEqual([id, false]);
  });
});

describe("derived items (no report needed)", () => {
  it("lane ending: where the route's own lane count drops", () => {
    const ix = (n: number, lng: number) => ({ location: [lng, -33.8], lanes: Array.from({ length: n }, () => ({})) });
    expect(laneEndingsInStep([ix(3, 151.1), { location: [151.11, -33.8] }, ix(3, 151.12), ix(2, 151.13), ix(2, 151.14)])).toEqual([{ latitude: -33.8, longitude: 151.13 }]);
    expect(laneEndingsInStep([ix(2, 151.1), ix(3, 151.2)])).toEqual([]);
    expect(laneEndingsInStep(undefined)).toEqual([]);
    expect(laneEndingFeatures([{ laneEndings: [{ latitude: 1, longitude: 2 }] }])).toEqual([{ key: "laneEnding:0:0", item: "laneEnding", lat: 1, lng: 2 }]);
  });
  it("sudden slowdown: two TrackLine drivers crawling just ahead on the route", () => {
    const route = { polyline: [CAR, { latitude: -33.87 + 3000 / 111_320, longitude: 151.2 }], alongM: 0 };
    const crawl = (uid: string, m: number) => ({ uid, path: [{ lat: -33.87 + m / 111_320, lng: 151.2, t: 0 }, { lat: -33.87 + (m + 5) / 111_320, lng: 151.2, t: 10_000 }] });
    const fast = (uid: string, m: number) => ({ uid, path: [{ lat: -33.87 + m / 111_320, lng: 151.2, t: 0 }, { lat: -33.87 + (m + 200) / 111_320, lng: 151.2, t: 10_000 }] });
    expect(pathSpeedKmh(crawl("a", 0).path, 10_000)).toBeCloseTo(1.8, 0);
    expect(trackySlowdownAhead([crawl("a", 600), crawl("b", 700)], route, 10_000)).not.toBeNull();
    expect(trackySlowdownAhead([crawl("a", 600)], route, 10_000)).toBeNull();
    expect(trackySlowdownAhead([crawl("a", 600), fast("b", 700)], route, 10_000)).toBeNull();
    expect(trackySlowdownAhead([crawl("a", 600), crawl("b", 700)], route, 200_000)).toBeNull(); // stale
  });
  it("crash history: two or more recorded crashes at the same place", () => {
    const spots = crashHistorySpots([
      { id: "ltn_1", lat: -33.8, lng: 151.1 },
      { id: "drv_2", lat: -33.8005, lng: 151.1 },
      { id: "ltn_3", lat: -33.9, lng: 151.2 },
    ]);
    expect(spots).toHaveLength(1);
    expect(spots[0].item).toBe("crashHistory");
    expect(alertsWhileDriving(DEFAULT_SETTINGS, "crashHistory")).toBe(true);
    expect(isShown(DEFAULT_SETTINGS, "crashHistory")).toBe(false); // alert-only item
  });
});
