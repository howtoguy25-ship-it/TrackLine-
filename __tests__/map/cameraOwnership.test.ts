// Permanent fix §2-§4 regression tests at the app level: ONE camera owner (lint-enforced), the
// user's zoom respected on the home map, Recentre the way back, preview fitted and never moved by
// location updates, the drive facing the road from the start.
import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { CameraController } from "@/map-v2/cameraController";
import { navCameraBearing, navFollowPadding, navStartBearing, NAV_ARROW_FRACTION } from "@/nav/navCamera";
import { allVisible, boundsOf, previewEdgePadding, previewFitCoordinates, projectFitted } from "@/nav/previewCamera";
import { bearingDegrees } from "@/utils/geo";

const CAMERA_CALL = /\.(animateCamera|fitToCoordinates|animateToRegion|setCamera|flyTo|fitBounds|easeTo|jumpTo)\(/;
const OWNERS = new Set(["src/map-v2/cameraController.ts", "src/map-v2/TrackLineMap.tsx"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** A fake map that keeps its own camera, like the real one. */
function fakeMap() {
  const cam = { zoom: 15, center: { latitude: -33.87, longitude: 151.21 }, pitch: 45, heading: 0 };
  const target = {
    animateCamera: jest.fn((c: Partial<typeof cam>) => Object.assign(cam, c)),
    animateToRegion: jest.fn(),
    fitToCoordinates: jest.fn(),
  };
  return { cam, target };
}

describe("one camera owner (§2)", () => {
  it("no camera call anywhere in src except the controller and the map component", () => {
    const offenders = sourceFiles("src")
      .filter((f) => !OWNERS.has(f.replace(/\\/g, "/")))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => CAMERA_CALL.test(line) && !/^\s*(\/\/|\*)/.test(line))
      );
    expect(offenders).toEqual([]);
  });

  it("the lint rule rejects a direct camera call outside the controller, and allows it inside", () => {
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const lint = (filename: string) => {
      const out = spawnSync("node_modules/.bin/eslint", ["--stdin", "--stdin-filename", filename, "-f", "json"], {
        input: "export function f(m: { animateCamera(c: object): void }) {\n  m.animateCamera({ zoom: 18.5 });\n}\n",
        encoding: "utf8",
      });
      return (JSON.parse(out.stdout)[0].messages as { message: string }[]).map((m) => m.message).join("\n");
    };
    expect(lint("src/screens/Bad.tsx")).toMatch(/Move the camera only through CameraController/);
    expect(lint("src/map-v2/cameraController.ts")).not.toMatch(/CameraController/);
  });

  it("root causes stay fixed in MapScreen: no 3D re-zoom on every fix, no 100 km snap-back, no foreground reset, no 10 s timer", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).not.toMatch(/pitch: 65, zoom: 18\.5/);
    expect(src).not.toMatch(/userMovedMapRef/);
    expect(src).not.toMatch(/SANITY_RECENTER_DISTANCE_KM/);
    expect(src).not.toMatch(/AUTO_RECENTER_IDLE_MS = 10_000/);
    expect(src).toMatch(/\[show3D, route, camera\]/); // the 3D effect no longer listens to GPS
    expect(src).toMatch(/const onMapPanDrag = useCallback\(\(\) => \{\s*camera\.gesture\(\);/);
    expect(src).toMatch(/if \(details\?\.isGesture\) camera\.gesture\(\);/);
    expect(src).toMatch(/shouldAutoRecentre\(/);
  });
});

describe("home map (§2)", () => {
  it("pinch-out on the home map keeps its zoom for 60 s of GPS fixes", () => {
    const { cam, target } = fakeMap();
    const camera = new CameraController({ current: target });
    // The driver pinches out to zoom 11 (the map does that itself) -> gesture -> FREE.
    cam.zoom = 11;
    camera.gesture(0);
    // 60 s of fixes: the follow effect and the 3D tilt each try to move it.
    for (let t = 1; t <= 60; t++) {
      camera.move("follow", { center: { latitude: -33.87 + t * 1e-5, longitude: 151.21 }, zoom: 16 }, { duration: 500 });
      camera.move("follow", { pitch: 45 }, { duration: 600 });
      camera.fit("autoFocus", [{ latitude: -33.8, longitude: 151.2 }]);
      camera.move("navFollow", { zoom: 17 }); // not driving: never allowed
    }
    expect(cam.zoom).toBe(11);
    expect(target.animateCamera).not.toHaveBeenCalled();
    expect(target.fitToCoordinates).not.toHaveBeenCalled();
    expect(camera.state).toBe("FREE");
  });

  it("Recentre restores follow: the next fix moves the camera again", () => {
    const { cam, target } = fakeMap();
    const camera = new CameraController({ current: target });
    camera.gesture(0);
    expect(camera.recentre()).toBe("FOLLOW");
    camera.move("recentre", { center: { latitude: -33.87, longitude: 151.21 }, zoom: 16 });
    camera.move("follow", { center: { latitude: -33.871, longitude: 151.21 } });
    expect(target.animateCamera).toHaveBeenCalledTimes(2);
    expect(cam.zoom).toBe(16);
  });

  it("auto-recentre never happens on the home map", () => {
    const camera = new CameraController({ current: fakeMap().target });
    camera.gesture(0);
    expect(camera.isNavigating).toBe(false);
  });
});

describe("route preview (§3)", () => {
  const routes = [
    [
      { latitude: -33.87, longitude: 151.2 },
      { latitude: -33.86, longitude: 151.23 },
      { latitude: -33.84, longitude: 151.25 },
    ],
    [
      { latitude: -33.87, longitude: 151.2 },
      { latitude: -33.88, longitude: 151.24 },
      { latitude: -33.84, longitude: 151.25 },
    ],
  ];
  it("route bounds are inside the visible rect at both sheet heights, on 320/375/390/430 pt phones", () => {
    const coords = previewFitCoordinates(routes, routes[0][0], routes[0][2]);
    const fit = boundsOf(coords)!;
    for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932]]) {
      for (const sheetHeight of [Math.round(height * 0.3), Math.round(height * 0.55)]) {
        const padding = previewEdgePadding(140, sheetHeight);
        const screen = projectFitted(coords, fit, { width, height }, padding);
        expect([width, sheetHeight, allVisible(screen, { width, height }, padding)]).toEqual([width, sheetHeight, true]);
      }
    }
  });

  it("location updates never move the camera in ROUTE_PREVIEW; the fit does", () => {
    const { target } = fakeMap();
    const camera = new CameraController({ current: target });
    camera.setMode("ROUTE_PREVIEW", false);
    for (let i = 0; i < 30; i++) camera.move("follow", { center: { latitude: -33.87 + i * 1e-4, longitude: 151.2 } });
    expect(target.animateCamera).not.toHaveBeenCalled();
    expect(camera.fit("previewFit", previewFitCoordinates(routes, null, null), { animated: true })).toBe(true);
    expect(target.fitToCoordinates).toHaveBeenCalledTimes(1);
  });

  it("MapScreen: an explicit fit re-enters ROUTE_PREVIEW; the fit effect uses the previewFit source", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/camera\.setMode\("ROUTE_PREVIEW", false\);\s*setPreviewFit/);
    expect(src).toMatch(/camera\.fit\("previewFit", coords, \{ animated: true \}\)/);
  });
});

describe("navigation camera (§4)", () => {
  // Parked on a street running east, then the route turns north.
  const route = [
    { latitude: -33.87, longitude: 151.2 },
    { latitude: -33.87, longitude: 151.205 },
    { latitude: -33.865, longitude: 151.205 },
  ];
  const firstSegment = bearingDegrees(route[0].latitude, route[0].longitude, route[1].latitude, route[1].longitude);
  const diff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

  it("the initial bearing equals the first segment's bearing (±10°), whatever the parked heading", () => {
    const parked = { latitude: -33.87003, longitude: 151.2004 }; // a few metres off the road
    const start = navStartBearing(route, parked)!;
    expect(diff(start, firstSegment)).toBeLessThanOrEqual(10);
    // A stale compass/GPS heading (here: facing south-west) doesn't win.
    expect(diff(navCameraBearing({ keepNorthUp: false, navNorthUp: false, roadBearing: start, heading: 225 }), firstSegment)).toBeLessThanOrEqual(10);
  });

  it("uses the segment you're actually on", () => {
    const onSecond = { latitude: -33.8675, longitude: 151.20502 };
    expect(diff(navStartBearing(route, onSecond)!, 0)).toBeLessThanOrEqual(10);
  });

  it("never north-up unless the driver asked for it", () => {
    expect(navCameraBearing({ keepNorthUp: false, navNorthUp: false, roadBearing: 90, heading: 80 })).toBe(90);
    expect(navCameraBearing({ keepNorthUp: false, navNorthUp: false, roadBearing: null, heading: 80 })).toBe(80);
    expect(navCameraBearing({ keepNorthUp: true, navNorthUp: false, roadBearing: 90, heading: 80 })).toBe(0);
    expect(navCameraBearing({ keepNorthUp: false, navNorthUp: true, roadBearing: 90, heading: 80 })).toBe(0);
  });

  it("the arrow sits at ~70% of the screen height", () => {
    for (const h of [568, 667, 844, 932]) {
      const p = navFollowPadding(h);
      const arrowY = (h - p.bottom + p.top) / 2;
      expect(Math.abs(arrowY / h - NAV_ARROW_FRACTION)).toBeLessThan(0.01);
    }
  });

  it("MapScreen starts the drive in NAV_FOLLOW facing the route, and every chase move uses that bearing", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/camera\.setMode\("NAV_FOLLOW", true\);/);
    expect(src).toMatch(/roadBearing: navStartBearing\(chosen\.polyline, currentLatLng\)/);
    expect(src).toMatch(/const bearing = navBearingRef\.current;\s*if \(camera\.move\("navFollow"/);
  });
});
