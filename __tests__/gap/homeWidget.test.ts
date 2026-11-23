// Gap item 2: the home-screen widget -- live drive time to Home and Work, the next planned drive,
// stamped with when; tapping a row opens the route. The App Group id must match everywhere.
import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { buildWidgetSnapshot, driveLinkTarget, widgetSnapshotNow } from "@/services/homeWidget";
import { deepLinkTarget } from "@/navigation/deepLinks";

const NOW = new Date(2026, 10, 23, 8, 12).getTime();
const home = { placeId: "h", name: "12 Smith St", address: "", location: { latitude: -33.9, longitude: 151.0 } };
const work = { placeId: "w", name: "Office", address: "", location: { latitude: -33.87, longitude: 151.2 } };
const drive = (id: string, leaveAtMs: number) => ({ id, from: { name: "Home", lat: 0, lng: 0 }, to: { name: `Dentist ${id}`, lat: 0, lng: 0 }, mode: "arrive" as const, targetMs: leaveAtMs + 1800000, leaveAtMs, durationSeconds: 1500, createdAt: 0 });

describe("widget snapshot", () => {
  it("Home and Work with live minutes, slower flagged at +10%, the next upcoming drive, and when", () => {
    const s = buildWidgetSnapshot({
      saved: { home, work },
      times: { home: { seconds: 1260, freeFlowSeconds: 900 }, work: { seconds: 600, freeFlowSeconds: 590 } },
      drives: [drive("past", NOW - 60000), drive("later", NOW + 7200000), drive("soon", NOW + 3600000)],
      nowMs: NOW,
    });
    expect(s.places).toEqual([
      { label: "Home", minutes: 21, slower: true, url: "trackline://drive/home" },
      { label: "Work", minutes: 10, slower: false, url: "trackline://drive/work" },
    ]);
    expect(s.nextDrive).toMatchObject({ to: "Dentist soon", url: "trackline://plan" });
    expect(s.updatedText).toMatch(/8:12/);
  });

  it("a failed request is '—' (null), never a guessed time; places not saved aren't listed", async () => {
    const s = await widgetSnapshotNow({ latitude: -33.9, longitude: 151 }, { home, work: null }, [], () => Promise.reject(new Error("offline")), NOW);
    expect(s.places).toEqual([{ label: "Home", minutes: null, slower: false, url: "trackline://drive/home" }]);
    expect(s.nextDrive).toBeNull();
    const noFix = await widgetSnapshotNow(null, { home, work }, [], () => Promise.resolve({ seconds: 60, freeFlowSeconds: 60 }), NOW);
    expect(noFix.places.map((p) => p.minutes)).toEqual([null, null]);
  });

  it("links: a widget row opens the drive to that saved place; 'next drive' opens Plan a drive", () => {
    expect(driveLinkTarget("trackline://drive/home")).toBe("home");
    expect(driveLinkTarget("trackline://drive/work/")).toBe("work");
    expect(driveLinkTarget("trackline://drive/gym")).toBeNull();
    expect(deepLinkTarget("trackline://plan")).toEqual({ screen: "PlanADrive" });
  });
});

describe("native wiring", () => {
  it("the widget is in the extension's bundle and reads the App Group the app writes to", () => {
    const bundle = readFileSync("targets/liveActivity/TrackLineLiveActivityBundle.swift", "utf8");
    expect(bundle).toMatch(/TrackLineLiveActivity\(\)\s*\n\s*TrackLineHomeWidget\(\)/);
    const widget = readFileSync("targets/liveActivity/TrackLineHomeWidget.swift", "utf8");
    const module = readFileSync("modules/liveActivity/ios/LiveActivityModule.swift", "utf8");
    const group = "group.com.trackline.navigate";
    expect(widget).toContain(`UserDefaults(suiteName: "${group}")`);
    expect(module).toContain(`UserDefaults(suiteName: "${group}")`);
    expect(widget).toContain('forKey: "homeWidget"');
    expect(module).toContain('forKey: "homeWidget"');
    expect(readFileSync("targets/liveActivity/expo-target.config.js", "utf8")).toContain(group);
    expect(readFileSync("app.config.js", "utf8")).toMatch(new RegExp(`application-groups": \\["${group.replace(/\./g, "\\.")}"\\]`));
    // The JSON the widget decodes has exactly the fields the app writes.
    for (const field of ["places", "nextDrive", "updatedText", "label", "minutes", "slower", "url", "to", "leaveAtText"]) expect(widget).toContain(`let ${field}`);
  });

  it("the app keeps it fresh and opens links", () => {
    expect(readFileSync("App.tsx", "utf8")).toMatch(/<HomeWidgetSync \/>/);
    const sync = readFileSync("src/components/HomeWidgetSync.tsx", "utf8");
    expect(sync).toMatch(/setWidgetSnapshot\(JSON\.stringify\(snap\)\)/);
    expect(sync).toMatch(/Linking\.addEventListener\("url"/);
  });
});

describe("App Group switch (build 209 failed signing without it registered at Apple)", () => {
  const load = (flag: string | undefined) => {
    const before = process.env.TRACKLINE_APP_GROUP;
    if (flag === undefined) delete process.env.TRACKLINE_APP_GROUP;
    else process.env.TRACKLINE_APP_GROUP = flag;
    let target: { entitlements?: Record<string, string[]> } = {};
    let app: { entitlements?: Record<string, string[]> } = {};
    jest.isolateModules(() => {
      target = require("../../targets/liveActivity/expo-target.config.js");
      const cfg = require("../../app.config.js");
      app = (typeof cfg === "function" ? cfg({ config: {} }) : cfg).expo.ios;
    });
    if (before === undefined) delete process.env.TRACKLINE_APP_GROUP;
    else process.env.TRACKLINE_APP_GROUP = before;
    return { target, app };
  };

  it("off: no App Group entitlement, so the existing profiles still sign", () => {
    const { target, app } = load(undefined);
    expect(target.entitlements).toBeUndefined();
    expect(app.entitlements).toBeUndefined();
  });

  it("on (TRACKLINE_APP_GROUP=1): the extension asks for the shared group", () => {
    const { target, app } = load("1");
    const group = { "com.apple.security.application-groups": ["group.com.trackline.navigate"] };
    expect(target.entitlements).toEqual(group);
    expect(app.entitlements).toEqual(group);
  });

  it("without the group the widget says it's not available yet, rather than looking empty", () => {
    const widget = readFileSync("targets/liveActivity/TrackLineHomeWidget.swift", "utf8");
    expect(widget).toMatch(/containerURL\(forSecurityApplicationGroupIdentifier: "group\.com\.trackline\.navigate"\) != nil/);
    expect(widget).toMatch(/else if !appGroupReady \{[\s\S]*not available yet/);
  });
});
