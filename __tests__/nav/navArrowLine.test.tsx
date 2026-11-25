// Nav fix §3: the driver is the 3D arrow (home, preview, navigation), their own Tracky/ghost is
// never drawn, and the route is one clean line that starts under the arrow.
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { render } from "@testing-library/react-native";
import { presencesToShow } from "@/map/presenceFilter";
import { routeAheadOf } from "@/map-v2/geo";
import { CarNavArrow, NavArrow3D } from "@/components/LocationMarkers";
import { distanceKm } from "@/utils/geo";

const HERE = { latitude: -33.9187, longitude: 151.0349 };
const meters = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;

describe("own Tracky is never on the map", () => {
  it("the driver's own uid is filtered out; others stay, nearest first, blocked ones go", () => {
    const list = [
      { uid: "me", lat: HERE.latitude, lng: HERE.longitude },
      { uid: "far", lat: -33.9, lng: 151.1 },
      { uid: "near", lat: -33.919, lng: 151.035 },
      { uid: "blocked", lat: -33.918, lng: 151.035 },
    ];
    const shown = presencesToShow(list, { ownUid: "me", blocked: new Set(["blocked"]), here: HERE, max: 10 });
    expect(shown.map((p) => p.uid)).toEqual(["near", "far"]);
  });

  it("MapScreen passes the signed-in uid to the filter", () => {
    expect(readFileSync("src/screens/MapScreen.tsx", "utf8")).toMatch(/presencesToShow\(presenceList, \{ ownUid: user\?\.uid \?\? null/);
  });
});

describe("the arrow", () => {
  it("the default marker component is the 3D arrow", async () => {
    const a = JSON.stringify((await render(<CarNavArrow markerStyle="default" />)).toJSON());
    const b = JSON.stringify((await render(<NavArrow3D />)).toJSON());
    expect(a).toBe(b);
  });
});

describe("route line", () => {
  // A street running east, with corner points 200 m apart.
  const route = [0, 1, 2, 3, 4].map((i) => ({ latitude: -33.92, longitude: 151.03 + i * 0.00217 }));

  it("starts within 15 m of the driver, even mid-block between corner points", () => {
    const driver = { latitude: -33.92003, longitude: 151.0333 }; // ~70 m along the first block, 3 m off
    const ahead = routeAheadOf(route, driver);
    expect(meters(ahead[0], driver)).toBeLessThan(15);
    // The part already driven is gone: the first corner behind the driver isn't in the line.
    expect(ahead).not.toContainEqual(route[0]);
    expect(ahead[ahead.length - 1]).toEqual(route[4]);
  });

  it("one line with one dark casing during navigation (no faded copy underneath, no white outline)", () => {
    const src = readFileSync("src/map-v2/MapboxLayers.tsx", "utf8");
    expect(src).not.toMatch(/nav-travelled/);
    const at = src.indexOf('id="nav-route"');
    const navRoute = src.slice(at, src.indexOf("/>", at));
    expect(navRoute).toMatch(/casingColor=\{ROUTE_PURPLE_CASING\}/);
    expect(navRoute).not.toMatch(/#FFFFFF/);
  });
});
