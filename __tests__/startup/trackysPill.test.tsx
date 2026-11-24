// Startup §2-3 on the phone: the pill's words and timing, one message at a time, greeting again
// after 10 min away, and the Trackys loaded for the map view (no fixed radius, max 50).
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { render, screen } from "@testing-library/react-native";

jest.mock("@firebase/functions", () => ({ httpsCallable: jest.fn() }));
jest.mock("@/services/firebase", () => ({ functions: {}, db: {} }));
import { useSharedValue } from "react-native-reanimated";
import { done, enqueue, reportsPillText, PILL_SHOW_MS } from "@/map/homePill";
import { shouldGreet, trackysPillText, GREET_AFTER_BACKGROUND_MS } from "@/services/trackysAround";
import { HomeInfoPill } from "@/components/HomeInfoPill";
import { geohashCellAndNeighbours, viewportGeohashPrecision, decodeGeohashBounds, encodeGeohash } from "@/utils/geo";
import { presencesToShow } from "@/map/presenceFilter";

describe("the pill", () => {
  it("real counts: 'A few' under 10, else the rounded number with a thousands separator", () => {
    expect(trackysPillText({ few: true, count: null, radiusKm: 10 })).toBe("A few Trackys around you");
    expect(trackysPillText({ few: false, count: 1250, radiusKm: 25 })).toBe("1,250 Trackys around you");
    expect(reportsPillText(0)).toBeNull();
    expect(reportsPillText(3)).toBe("3 reports near you");
  });
  it("one message at a time, 5 s each, no duplicates of a kind", () => {
    let q = enqueue([], { kind: "trackys", text: "a" });
    q = enqueue(q, { kind: "trackys", text: "again" });
    q = enqueue(q, { kind: "reports", text: "3 reports near you" });
    expect(q.map((m) => m.kind)).toEqual(["trackys", "reports"]);
    expect(done(q).map((m) => m.kind)).toEqual(["reports"]);
    expect(PILL_SHOW_MS).toBe(5000);
  });
  it("greets on open and again only after more than 10 min in the background", () => {
    expect(shouldGreet(null, 1000)).toBe(true);
    expect(shouldGreet(0, GREET_AFTER_BACKGROUND_MS - 1)).toBe(false);
    expect(shouldGreet(0, GREET_AFTER_BACKGROUND_MS)).toBe(true);
  });
  it("renders our Tracky and the text; it's a 44pt-tall button", async () => {
    function Host() {
      const h = useSharedValue(150);
      return <HomeInfoPill message={{ kind: "trackys", text: "1,250 Trackys around you" }} sheetVisibleHeight={h} scheme="light" onPress={() => {}} />;
    }
    await render(<Host />);
    expect(screen.getByText("1,250 Trackys around you")).toBeTruthy();
    expect(screen.getByLabelText("1,250 Trackys around you")).toBeTruthy();
  });
  it("the app never downloads positions to count: it asks the server for the rounded count", () => {
    const svc = readFileSync("src/services/trackysAround.ts", "utf8");
    expect(svc).toMatch(/httpsCallable<\{ lat: number; lng: number \}, TrackysCount>\(functions, "trackysAround"\)/);
    expect(svc).not.toMatch(/collection\(|onSnapshot|getDocs/);
  });
});

describe("Trackys in the map view", () => {
  it("reads the geohash cell around the view and its 8 neighbours; wider view -> bigger cells", () => {
    const cells = geohashCellAndNeighbours(-33.87, 151.21, viewportGeohashPrecision(0.05));
    expect(cells).toHaveLength(9);
    expect(cells).toContain(encodeGeohash(-33.87, 151.21, 5));
    expect(viewportGeohashPrecision(5)).toBeLessThan(viewportGeohashPrecision(0.01));
    const b = decodeGeohashBounds(cells[0]);
    expect(b.latMax).toBeGreaterThan(b.latMin);
  });
  it("keeps the 50 nearest the middle of the view, never one on your own arrow, never you", () => {
    const list = Array.from({ length: 80 }, (_, i) => ({ uid: `u${i}`, lat: -33.87 + i * 0.001, lng: 151.21 }));
    const out = presencesToShow([...list, { uid: "me", lat: -33.87, lng: 151.21 }], { ownUid: "me", blocked: new Set(), here: { latitude: -33.87, longitude: 151.21 }, me: { latitude: -33.87, longitude: 151.21 }, max: 50 });
    expect(out).toHaveLength(50);
    expect(out.some((p) => p.uid === "me" || p.uid === "u0")).toBe(false); // u0 is on your arrow
  });
  it("MapScreen subscribes by the view's cells and re-queries as the view moves; presence.ts caps each cell at 50", () => {
    const map = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(map).toMatch(/return subscribeViewportPresence\(user\.uid, presenceCellsKey\.split\(","\), setPresenceList\);/);
    expect(map).toMatch(/\[user, settings\.showTrackysOnMap, presenceCellsKey\]/);
    const p = readFileSync("src/services/presence.ts", "utf8");
    expect(p).toMatch(/where\("geohash", ">=", cell\), where\("geohash", "<=", `\$\{cell\}\\uf8ff`\), limit\(VIEWPORT_PRESENCE_LIMIT\)/);
  });
});
