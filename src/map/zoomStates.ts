// Map polish §2: every report on the map has three zoom states, each drawn by MapIcons.
//   close  (z >= 15)   the full pin: round badge, white ring, pointer, soft shadow
//   mid    (z 12-15)   the icon at 60%, no pointer; icons that would overlap (within
//                      MID_OVERLAP_PX on screen) merge into one count badge -- tap it to zoom in
//   far    (z < 12)    a small coloured dot (police blue, crash / closure red, hazard / roadwork
//                      amber, camera purple), at most MAX_DOTS, the most important first, then
//                      nearest the centre
// Pure; tested in __tests__/map/zoomStates.test.ts.
import { clusterPoints } from "@/utils/markerCluster";
import type { AlertType } from "@/types/alert";

export const CLOSE_ZOOM = 15;
export const FAR_BELOW_ZOOM = 12;
export const MID_SCALE = 0.6;
export const MID_OVERLAP_PX = 28;
export const MAX_DOTS = 60;

export type PinState = "close" | "mid" | "far";
export function pinState(zoom: number): PinState {
  if (zoom >= CLOSE_ZOOM) return "close";
  if (zoom >= FAR_BELOW_ZOOM) return "mid";
  return "far";
}

export type DotColour = "police" | "red" | "amber" | "camera" | "tracky" | "other";

/** The far-zoom dot colour for a report: by what it is (the item when it says more than the type). */
export function dotColour(type: AlertType | string, item?: string | null): DotColour {
  if (item === "closures" || type === "crash" || type === "emergency_vehicle") return "red";
  if (type === "police") return "police";
  if (type === "camera" || /camera/i.test(item ?? "")) return "camera";
  if (type === "hazard" || type === "roadwork" || type === "traffic_light" || type === "traffic") return "amber";
  return "other";
}

/** Which dots win when there are too many: crashes and closures, then police, hazards, cameras. */
const DOT_PRIORITY: Record<DotColour, number> = { red: 0, police: 1, amber: 2, camera: 3, tracky: 4, other: 5 };

export interface PinPoint {
  id: string;
  lat: number;
  lng: number;
  type: AlertType | string;
  item?: string | null;
}

export interface PinView {
  zoom: number;
  /** The latitude span on screen, and the screen's height in points (for "overlap on screen"). */
  latitudeDelta: number;
  screenHeight: number;
  centre: { latitude: number; longitude: number };
}

export interface PinLayout<T extends PinPoint> {
  state: PinState;
  /** Drawn one by one: full pins (close) or 60% icons (mid). `scale` multiplies the pin size. */
  singles: { point: T; scale: number }[];
  /** Mid zoom only: items that would overlap, as one count badge. */
  clusters: { lat: number; lng: number; count: number; ids: string[] }[];
  /** Far zoom only. */
  dots: { point: T; colour: DotColour }[];
}

export function layoutPins<T extends PinPoint>(points: readonly T[], view: PinView): PinLayout<T> {
  const state = pinState(view.zoom);
  if (state === "close") return { state, singles: points.map((point) => ({ point, scale: 1 })), clusters: [], dots: [] };
  if (state === "mid") {
    const cell = (view.latitudeDelta / Math.max(1, view.screenHeight)) * MID_OVERLAP_PX;
    const groups = clusterPoints([...points], cell);
    return {
      state,
      singles: groups.filter((g) => g.count === 1).map((g) => ({ point: g.points[0], scale: MID_SCALE })),
      clusters: groups.filter((g) => g.count > 1).map((g) => ({ lat: g.lat, lng: g.lng, count: g.count, ids: g.points.map((p) => p.id) })),
      dots: [],
    };
  }
  const cosLat = Math.cos((view.centre.latitude * Math.PI) / 180);
  const d = (p: T) => (p.lat - view.centre.latitude) ** 2 + ((p.lng - view.centre.longitude) * cosLat) ** 2;
  const dots = points
    .map((point) => ({ point, colour: dotColour(point.type, point.item) }))
    .sort((a, b) => DOT_PRIORITY[a.colour] - DOT_PRIORITY[b.colour] || d(a.point) - d(b.point))
    .slice(0, MAX_DOTS);
  return { state, singles: [], clusters: [], dots };
}

/** The mid-zoom version of a pin icon: the same badge with no pointer ("alert:crash" -> "alert-mid:crash"). */
export function midPinIcon(icon: string): string {
  return icon.startsWith("alert:") ? `alert-mid:${icon.slice(6)}` : icon;
}
