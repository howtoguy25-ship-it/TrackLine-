// Waze-match §0: no big coloured speed-bump dots on the home map. Mapped (OSM) and driver-reported
// road features both follow one rule: small grey icon at street zoom, tiny mark at mid zoom,
// nothing further out. Reports of other kinds (police, crash...) keep their badges.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { homeRoadSigns, roadFeatureReportIcon, signIcon } from "@/map/roadSignVisibility";
import { REPORT_ITEMS } from "@/settings/reportCatalog";

const roadFeatures = REPORT_ITEMS.filter((i) => i.section === "roadFeatures" && i.id !== "trafficLights").map((i) => i.id);

describe("road features are never big dots", () => {
  it.each([10, 12, 13.9])("z%s: hidden (no dot, no badge)", (z) => {
    for (const item of roadFeatures) expect([item, roadFeatureReportIcon(item, z)]).toEqual([item, "hidden"]);
  });
  it("z14-16: the tiny mark; z16+: the small grey icon -- for reported and mapped alike", () => {
    expect(roadFeatureReportIcon("speedBump", 15)).toBe("road-mark");
    expect(roadFeatureReportIcon("speedBump", 17)).toBe("road-feature:speedBump");
    expect(signIcon("speedBump", 17)).toBe("road-feature:speedBump");
    const at = { latitude: -33.9, longitude: 151, latitudeDelta: 0.01, zoom: 13 };
    expect(homeRoadSigns([{ key: "b", item: "speedBump", lat: -33.9, lng: 151 }], at, { navigating: false, shown: () => true })).toEqual([]);
  });
  it("other reports are not affected", () => {
    expect(roadFeatureReportIcon("police" as never, 17)).toBeNull();
  });
  it("MapScreen applies the rule to reported features in both the pin and the far-dot loops", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/const feature = roadFeatureReportIcon\(itemOfAlert\(alert\), mapZoom\);\s*if \(feature === "hidden"\) continue;/);
    expect(src).toMatch(/if \(roadFeatureReportIcon\(itemOfAlert\(alert\), mapZoom\)\) continue; \/\/ road features: no far dots/);
  });
});

describe("Settings > About shows the commit", () => {
  it("the build stamp and the map engine line carry the commit hash", () => {
    const { formatBuildStamp } = require("@/config/buildStamp") as typeof import("@/config/buildStamp");
    const { mapEngineLine } = require("@/config/mapEngine") as typeof import("@/config/mapEngine");
    expect(JSON.stringify(formatBuildStamp({ version: "1.3.0", buildNumber: "218", commit: "95c9bc5", date: "2026-11-24" } as never))).toMatch(/95c9bc5/);
    expect(mapEngineLine(true, "95c9bc5abcdef")).toMatch(/commit 95c9bc5/);
  });
});
