// Brand / popular-place badges ranked by real popularity (map/poiRanking.ts): Places rating
// count + business status + anonymous opted-in arrivals, a 300 m nearby boost, z13/z15, at most
// 12 a screen and never overlapping -- and the map really draws only those (render test).
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react-native";
import {
  BADGE_BOX,
  MAX_PER_SCREEN,
  NEARBY_BOOST_M,
  candidateFromFeature,
  popularityKey,
  popularityScore,
  rankBadges,
  rankedBadgeCollection,
  visibleAtZoom,
  type BadgeCandidate,
} from "@/map/poiRanking";
import { BADGE_CANDIDATE_LAYER_ID, BADGE_LAYER_IDS, RANKED_BADGE_LAYER_ID, withRankedBadges } from "@/map/poiBadges";
import { LIGHT_PALETTE, buildStyle } from "@/map-v2/styles/buildStyle";
import light from "@/map-v2/styles/trackline-light.json";
import dark from "@/map-v2/styles/trackline-dark.json";
import satellite from "@/map-v2/styles/trackline-satellite-streets.json";

const SCREEN = { width: 390, height: 844 };
const c = (key: string, over: Partial<BadgeCandidate> = {}): BadgeCandidate => ({ key, name: key, category: "cup", filterrank: 2, lat: -33.87, lng: 151.2, x: 100, y: 100, ...over });

describe("popularity score", () => {
  it("more Google ratings and more arrivals rank higher; Mapbox prominence breaks the rest", () => {
    const base = c("a");
    expect(popularityScore(base, { ratingCount: 5000 }, null)!).toBeGreaterThan(popularityScore(base, { ratingCount: 50 }, null)!);
    expect(popularityScore(base, { arrivals: 200 }, null)!).toBeGreaterThan(popularityScore(base, { arrivals: 2 }, null)!);
    expect(popularityScore({ ...base, filterrank: 0 }, undefined, null)!).toBeGreaterThan(popularityScore({ ...base, filterrank: 2 }, undefined, null)!);
  });
  it("closed places get no badge", () => {
    expect(popularityScore(c("a"), { businessStatus: "CLOSED_PERMANENTLY" }, null)).toBeNull();
    expect(popularityScore(c("a"), { businessStatus: "CLOSED_TEMPORARILY" }, null)).toBeNull();
    expect(popularityScore(c("a"), { businessStatus: "OPERATIONAL" }, null)).not.toBeNull();
  });
  it("within 300 m of the driver: boosted", () => {
    const near = popularityScore(c("a"), undefined, { latitude: -33.87 + (NEARBY_BOOST_M - 50) / 111_320, longitude: 151.2 })!;
    const far = popularityScore(c("a"), undefined, { latitude: -33.87 + (NEARBY_BOOST_M + 50) / 111_320, longitude: 151.2 })!;
    expect(near).toBeGreaterThan(far);
  });
  it("no data is never a made-up rating: unknown places rank on prominence alone", () => {
    expect(popularityScore(c("a", { filterrank: 2 }), undefined, null)).toBe(15);
  });
});

describe("ranking a screen", () => {
  it("fuel and hospitals from zoom 13, the rest from 15", () => {
    expect(visibleAtZoom("fuel", 13)).toBe(true);
    expect(visibleAtZoom("hospital", 13)).toBe(true);
    expect(visibleAtZoom("cup", 14)).toBe(false);
    expect(visibleAtZoom("cup", 15)).toBe(true);
  });
  it("popular first, then no overlaps, at most 12", () => {
    // 60 candidates on a grid, every one far enough apart, the popularity varies
    const cands = Array.from({ length: 60 }, (_, i) => c(`p${i}`, { x: 10 + (i % 3) * 140, y: 10 + Math.floor(i / 3) * 70 }));
    const pop = Object.fromEntries(cands.map((k, i) => [k.key, { ratingCount: i * 100 }]));
    const ranked = rankBadges(cands, { zoom: 16, popularity: pop, screen: SCREEN });
    expect(ranked.length).toBeLessThanOrEqual(MAX_PER_SCREEN);
    expect(ranked[0].key).not.toBe("p0");
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    for (const a of ranked) for (const b of ranked) if (a !== b) expect(Math.abs(a.x - b.x) >= BADGE_BOX.width || Math.abs(a.y - b.y) >= BADGE_BOX.height).toBe(true);
  });
  it("of two overlapping badges the more popular one wins", () => {
    const ranked = rankBadges([c("quiet", { x: 100, y: 100 }), c("busy", { x: 110, y: 105 })], { zoom: 16, popularity: { busy: { ratingCount: 9000 } }, screen: SCREEN });
    expect(ranked.map((r) => r.key)).toEqual(["busy"]);
  });
  it("off-screen, wrong-zoom and duplicate candidates are dropped; ties are stable", () => {
    const ranked = rankBadges([c("off", { x: -5 }), c("cafe"), c("cafe"), c("fuel", { category: "fuel", x: 300, y: 400 })], { zoom: 13.5, screen: SCREEN });
    expect(ranked.map((r) => r.key)).toEqual(["fuel"]);
    const a = rankBadges([c("b", { x: 0 }), c("a", { x: 300 })], { zoom: 16, screen: SCREEN }).map((r) => r.key);
    expect(a).toEqual(["a", "b"]);
  });
});

describe("from the map's own features", () => {
  it("a Mapbox poi_label feature becomes a candidate (and junk doesn't)", () => {
    const f = { geometry: { type: "Point", coordinates: [151.2, -33.87] }, properties: { name: "Corner Cafe", maki: "cafe", filterrank: 1, brand: "x" } };
    expect(candidateFromFeature(f, [10, 20])).toMatchObject({ name: "Corner Cafe", category: "cup", filterrank: 1, x: 10, y: 20, key: popularityKey("Corner Cafe", -33.87, 151.2) });
    expect(candidateFromFeature({ ...f, properties: { name: "x", maki: "zoo" } }, [0, 0])).toBeNull();
    expect(candidateFromFeature({ ...f, geometry: { type: "LineString", coordinates: [] } }, [0, 0])).toBeNull();
    const local = { ...f, properties: { ...f.properties, name_en: "Corner Cafe EN" } };
    expect(candidateFromFeature(local, [0, 0], "name_en")!.name).toBe("Corner Cafe EN");
  });
  it("every style swaps the native badge layers for one invisible candidate layer", () => {
    for (const style of [light, dark, satellite, buildStyle(LIGHT_PALETTE)] as { layers: { id: string; paint?: Record<string, unknown> }[] }[]) {
      const out = withRankedBadges(style);
      const ids = out.layers.map((l) => l.id);
      for (const id of BADGE_LAYER_IDS) expect(ids).not.toContain(id);
      expect(ids.filter((i) => i === BADGE_CANDIDATE_LAYER_ID)).toHaveLength(1);
      const cand = out.layers.find((l) => l.id === BADGE_CANDIDATE_LAYER_ID)!;
      expect(cand.paint).toMatchObject({ "circle-opacity": 0 });
    }
  });
});

// ---- the map draws only the ranked ones (render, with a stand-in Mapbox) ----------------------

const mockShapes: Record<string, { features: unknown[] }> = {};
const mockFeatures: { list: unknown[] } = { list: [] };
jest.mock("@/map-v2/mapbox", () => {
  const mockReact = jest.requireActual("react") as typeof import("react");
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  const Pass = ({ children }: { children?: unknown }) => mockReact.createElement(RN.View, null, children as never);
  const MapView = mockReact.forwardRef((props: { children?: unknown; onMapIdle?: (s: unknown) => void }, ref) => {
    mockReact.useImperativeHandle(ref, () => ({
      queryRenderedFeaturesInRect: async (_b: unknown, _f: unknown, layers: string[]) => ({ type: "FeatureCollection", features: layers.includes("poi-badge-candidates") ? mockFeatures.list : [] }),
      // a simple projection: 1 degree of lng = 40000 pt across, lat the same down
      getPointInView: async ([lng, lat]: number[]) => [(lng - 151.2) * 40000 + 200, (-33.87 - lat) * 40000 + 400],
      queryRenderedFeaturesAtPoint: async () => ({ features: [] }),
    }));
    (globalThis as { mockIdle?: (s: unknown) => void }).mockIdle = props.onMapIdle;
    return Pass(props);
  });
  const ShapeSource = (props: { id: string; shape: { features: unknown[] }; children?: unknown }) => {
    mockShapes[props.id] = props.shape;
    return Pass(props);
  };
  const Camera = mockReact.forwardRef(() => null);
  const module = { MapView, Camera, Images: Pass, Image: Pass, FillExtrusionLayer: () => null, VectorSource: Pass, LineLayer: () => null, CameraGestureObserver: () => null, ShapeSource, SymbolLayer: () => null };
  return { loadMapbox: () => module };
});
jest.mock("@/services/poiPopularity", () => ({ cachedPopularity: () => ({}), loadPopularity: async () => false }));

import { TrackLineMap } from "@/map-v2/TrackLineMap";

describe("per-screen cap (render)", () => {
  it("40 badge candidates on screen: the map draws at most 12, none twice; below zoom 13 none", async () => {
    mockFeatures.list = Array.from({ length: 40 }, (_, i) => ({
      geometry: { type: "Point", coordinates: [151.2 + ((i % 5) - 2) * 0.0009, -33.87 - (Math.floor(i / 5) - 4) * 0.0009] },
      properties: { name: `Place ${i}`, maki: i % 4 === 0 ? "fuel" : "cafe", filterrank: i % 3 },
    }));
    await render(
      <TrackLineMap theme="light" roadThickness="normal" satellite={false} dimmed={false} show3DBuildings={false} showTraffic={false} padding={{ top: 0, right: 0, bottom: 0, left: 0 }} initialCenter={{ latitude: -33.87, longitude: 151.2 }} initialZoom={16} />
    );
    await act(async () => {
      (globalThis as { mockIdle?: (s: unknown) => void }).mockIdle!({ properties: { center: [151.2, -33.87], zoom: 16, heading: 0, pitch: 0, bounds: { ne: [151.21, -33.86], sw: [151.19, -33.88] } } });
      await new Promise((r) => setTimeout(r, 0));
    });
    const drawn = mockShapes["ranked-badges-src"].features as { properties: { name: string } }[];
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThanOrEqual(MAX_PER_SCREEN);
    expect(new Set(drawn.map((d) => d.properties.name)).size).toBe(drawn.length);
    expect(RANKED_BADGE_LAYER_ID).toBe("ranked-badges");
    // zoomed out below 13: nothing drawn
    await act(async () => {
      (globalThis as { mockIdle?: (s: unknown) => void }).mockIdle!({ properties: { center: [151.2, -33.87], zoom: 12, heading: 0, pitch: 0, bounds: { ne: [151.3, -33.8], sw: [151.1, -33.9] } } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mockShapes["ranked-badges-src"].features).toEqual([]);
  });
});
