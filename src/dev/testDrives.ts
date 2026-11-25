// Development builds only: two recorded test drives through a real Sydney motorway exit, for
// checking lane guidance, the approach zoom, the confirmation chip and rerouting without
// driving. Both navigate the same recorded route (Great Western Hwy, onto the M4 eastbound, off
// at the Silverwater Road exit); the simulated car either takes the exit or stays on the M4
// past it. The routes are real OSRM responses over OpenStreetMap (src/dev/testRoutes).

import taken from "@/dev/testRoutes/m4-silverwater-taken.json";
import missed from "@/dev/testRoutes/m4-silverwater-missed.json";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import type { Route } from "@/services/directions";
import type { LatLng } from "@/utils/polyline";

export type TestDriveKind = "taken" | "missed";

export const TEST_DRIVE_LABELS: Record<TestDriveKind, string> = {
  taken: "M4 Silverwater exit (taken)",
  missed: "M4 Silverwater exit (missed)",
};

export interface TestDrive {
  /** The route navigation follows. */
  route: Route;
  /** Where the simulated car actually goes. */
  track: LatLng[];
  destination: { name: string; location: LatLng };
  speedKmh: number;
}

export function testDrive(kind: TestDriveKind): TestDrive {
  const route = parseMapboxResponse(taken)[0];
  const track = kind === "taken" ? route.polyline : parseMapboxResponse(missed)[0].polyline;
  const end = route.polyline[route.polyline.length - 1];
  return { route, track, destination: { name: "Silverwater (test drive)", location: end }, speedKmh: 90 };
}

type Listener = (kind: TestDriveKind) => void;
const listeners = new Set<Listener>();

/** Settings › Developer asks; the map screen (listening) starts it. */
export function requestTestDrive(kind: TestDriveKind): void {
  listeners.forEach((l) => l(kind));
}

export function onTestDriveRequested(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
