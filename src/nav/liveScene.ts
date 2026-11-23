// Live road view (the Tesla-style view while navigating): the vehicles the phone's camera really
// sees, placed where the on-device model puts them, on a road drawn along your real route.
// Pure; tested in __tests__/nav/liveScene.test.ts. The camera side is components/LiveVehicleCamera.
//
// Where a vehicle is: the same pinhole estimate the AI vehicle detection screen shows
// (utils/speedTracker.ts estimateDistanceM: its real width by kind, the phone's ~68 deg view) for
// how far ahead, and how far its box centre sits from the middle of the picture for how far left or
// right. An estimate from one camera, not radar: good to a few metres, not centimetres.
import { estimateDistanceM } from "@/utils/speedTracker";
import { pointAt, type RouteGeometry } from "@/nav/routeMatcher";

type LatLng = { latitude: number; longitude: number };

/** Same focal assumption as utils/speedTracker.ts (imageWidthPx * 0.75 at 1x). */
export const FOCAL_FACTOR = 0.75;
/** Drawn out to this far ahead; beyond it a phone camera can't place a car usefully. */
export const SCENE_RANGE_M = 80;
/** Left/right limit drawn (about three lanes each side). */
export const SCENE_HALF_WIDTH_M = 12;
export const LANE_WIDTH_M = 3.5;
/** Closer than this ahead in your lane: drawn in the caution colour. */
export const CLOSE_AHEAD_M = 12;
/** A track the camera hasn't confirmed for this long is dropped from the view. */
export const STALE_MS = 1500;

export type SceneKind = "car" | "truck" | "bus" | "motorcycle";

export interface CameraTrack {
  id: number;
  /** x, y, width, height in the upright frame's pixels. */
  bbox: [number, number, number, number];
  cls: SceneKind;
  /** Smoothed distance from the tracker when it has one (metres). */
  distanceM?: number | null;
  speedKmh?: number | null;
}

export interface SceneVehicle {
  id: number;
  kind: SceneKind;
  /** Metres to the right of the car's centre line (negative = left). */
  x: number;
  /** Metres ahead. */
  z: number;
  close: boolean;
  speedKmh: number | null;
}

export function trackToScene(t: CameraTrack, frameWidthPx: number, zoom = 1): SceneVehicle | null {
  const [bx, , bw] = t.bbox;
  if (!(frameWidthPx > 0) || !(bw > 0)) return null;
  const z = t.distanceM && t.distanceM > 0 ? t.distanceM : estimateDistanceM(bw, frameWidthPx, zoom, t.cls);
  const focal = frameWidthPx * FOCAL_FACTOR * Math.max(zoom, 1);
  const x = ((bx + bw / 2 - frameWidthPx / 2) * z) / focal;
  if (!(z > 0) || z > SCENE_RANGE_M || Math.abs(x) > SCENE_HALF_WIDTH_M) return null;
  return { id: t.id, kind: t.cls, x, z, close: z < CLOSE_AHEAD_M && Math.abs(x) < LANE_WIDTH_M / 2, speedKmh: t.speedKmh ?? null };
}

export function sceneFromTracks(tracks: readonly CameraTrack[], frameWidthPx: number, zoom = 1): SceneVehicle[] {
  return tracks
    .map((t) => trackToScene(t, frameWidthPx, zoom))
    .filter((v): v is SceneVehicle => !!v)
    .sort((a, b) => b.z - a.z); // far first, so near ones are drawn on top
}

/** A point in the car's own frame: x metres to the right, z metres ahead. */
export interface LocalPoint {
  x: number;
  z: number;
}

const R = 6371000;
export function toLocal(car: LatLng, headingDeg: number, p: LatLng): LocalPoint {
  const dLat = ((p.latitude - car.latitude) * Math.PI) / 180;
  const dLng = ((p.longitude - car.longitude) * Math.PI) / 180;
  const north = dLat * R;
  const east = dLng * R * Math.cos((car.latitude * Math.PI) / 180);
  const h = (headingDeg * Math.PI) / 180;
  return { x: east * Math.cos(h) - north * Math.sin(h), z: east * Math.sin(h) + north * Math.cos(h) };
}

/** Your route from where you are, out to `lengthM`, in the car's frame (every `stepM`). */
export function routeAhead(geo: RouteGeometry, alongM: number, car: LatLng, headingDeg: number, lengthM = SCENE_RANGE_M + 20, stepM = 5): LocalPoint[] {
  const out: LocalPoint[] = [];
  const end = Math.min(geo.length, alongM + lengthM);
  for (let a = alongM; a <= end + 0.01; a += stepM) out.push(toLocal(car, headingDeg, pointAt(geo, a)));
  return out;
}

export interface View {
  width: number;
  height: number;
}

/** The chase view: a camera 4.5 m up and 12 m behind the car, looking down the road. */
export const EYE_HEIGHT_M = 4.5;
export const EYE_BEHIND_M = 12;
/** Where your own car is drawn (its back, metres ahead of the car's position): whole, near the bottom. */
export const ME_Z_M = 0.5;
/** Where the far horizon sits, as a share of the panel's height. */
export const HORIZON = 0.16;

/** Screen position of a road-level point; null if it's behind the eye. */
export function project(p: LocalPoint, v: View, heightM = 0): { u: number; v: number; scale: number } | null {
  const d = p.z + EYE_BEHIND_M;
  if (d <= 1) return null;
  // Focal chosen so road level at the car (z = 0) is 88 % of the way down the panel.
  const f = (v.height * (0.88 - HORIZON) * EYE_BEHIND_M) / EYE_HEIGHT_M;
  return { u: v.width / 2 + (f * p.x) / d, v: v.height * HORIZON + (f * (EYE_HEIGHT_M - heightM)) / d, scale: f / d };
}

/** Real sizes (metres) the vehicles are drawn at: width, length, height. */
export const KIND_SIZE: Record<SceneKind, { w: number; l: number; h: number }> = {
  car: { w: 1.8, l: 4.5, h: 1.5 },
  truck: { w: 2.5, l: 8, h: 3.2 },
  bus: { w: 2.5, l: 12, h: 3.2 },
  motorcycle: { w: 0.8, l: 2.1, h: 1.4 },
};

export type LiveStatus = "starting" | "running" | "noPermission" | "noCamera" | "modelFailed";

export const STATUS_TEXT: Record<Exclude<LiveStatus, "running">, string> = {
  starting: "Starting the camera…",
  noPermission: "Live view needs the camera. Mount the phone facing the road and allow camera access.",
  noCamera: "This phone has no back camera Live view can use.",
  modelFailed: "The vehicle model didn't load.",
};

/** Shown only while driving a route with the setting on. */
export function liveViewShown(settingOn: boolean, navigating: boolean, driving: boolean): boolean {
  return settingOn && navigating && driving;
}

/** Room it takes above the ETA bar: about a third of the screen, 200-260 pt. */
export function liveViewHeight(windowHeight: number): number {
  return Math.round(Math.min(260, Math.max(200, windowHeight * 0.3)));
}
