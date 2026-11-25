// When a drive starts with a connection, the map tiles along the route are downloaded so the map
// still draws if the signal drops on the way (Mapbox offline packs; the route's own area only,
// zoom 10-15, at most the 3 most recent drives kept). Best-effort: if it can't, the drive is
// unaffected.
import { loadMapbox } from "@/map-v2/mapbox";
import type { LatLng } from "@/utils/polyline";

const PREFIX = "trackline-route-";
export const KEEP_PACKS = 3;
/** Routes whose area is bigger than this (in degrees, either side) aren't downloaded. */
export const MAX_SPAN_DEG = 1.2;
// The packs carry Mapbox Streets v8 tiles, the same tileset TrackLine's own style draws.
const PACK_STYLE = "mapbox://styles/mapbox/streets-v12";

export function routeBounds(line: LatLng[], marginDeg = 0.01): [[number, number], [number, number]] | null {
  if (line.length < 2) return null;
  let n = -90, s = 90, e = -180, w = 180;
  for (const p of line) {
    n = Math.max(n, p.latitude);
    s = Math.min(s, p.latitude);
    e = Math.max(e, p.longitude);
    w = Math.min(w, p.longitude);
  }
  if (n - s > MAX_SPAN_DEG || e - w > MAX_SPAN_DEG) return null;
  return [
    [e + marginDeg, n + marginDeg],
    [w - marginDeg, s - marginDeg],
  ];
}

export async function downloadRouteArea(line: LatLng[], nowMs = Date.now()): Promise<boolean> {
  const Mapbox = loadMapbox() as { offlineManager?: any } | null;
  const om = Mapbox?.offlineManager;
  const bounds = routeBounds(line);
  if (!om || !bounds) return false;
  try {
    const packs: { name: string }[] = (await om.getPacks()) ?? [];
    const ours = packs.map((p) => p.name).filter((n) => typeof n === "string" && n.startsWith(PREFIX)).sort();
    for (const old of ours.slice(0, Math.max(0, ours.length - (KEEP_PACKS - 1)))) await om.deletePack(old).catch(() => {});
    await om.createPack(
      { name: `${PREFIX}${nowMs}`, styleURL: PACK_STYLE, bounds, minZoom: 10, maxZoom: 15 },
      () => {},
      () => {}
    );
    return true;
  } catch {
    return false;
  }
}

// ---- Settings > Offline maps: areas the driver downloads, with real progress, size and delete ----
// Tested in __tests__/gap/offlineMaps.test.tsx.

const AREA_PREFIX = "trackline-area-";
export const AREA_RADII_KM = [10, 25, 50] as const;
export type AreaRadiusKm = (typeof AREA_RADII_KM)[number];
/** Mapbox reports a finished pack as state 2 (Inactive 0, Active 1, Complete 2). */
const COMPLETE = 2;
export const LIST_TIMEOUT_MS = 10_000;

/** A square around a point, `radiusKm` each way, as Mapbox pack bounds [[ne], [sw]]. */
export function areaBounds(center: { latitude: number; longitude: number }, radiusKm: number): [[number, number], [number, number]] {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180)));
  return [
    [center.longitude + dLng, center.latitude + dLat],
    [center.longitude - dLng, center.latitude - dLat],
  ];
}

export interface OfflineArea {
  name: string;
  kind: "area" | "route";
  label: string;
  createdAt: number | null;
  percentage: number;
  bytes: number;
  complete: boolean;
}

/** Is the offline map engine in this build at all (Mapbox native + a usable token)? */
export function offlineMapsAvailable(): boolean {
  return !!(loadMapbox() as { offlineManager?: unknown } | null)?.offlineManager;
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The phone's map store didn't answer in 10 s")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Every pack TrackLine made: areas the driver downloaded and the recent drives' route areas. */
export async function listOfflineAreas(): Promise<OfflineArea[]> {
  const om = (loadMapbox() as { offlineManager?: any } | null)?.offlineManager;
  if (!om) throw new Error("Offline maps aren't available in this version");
  const packs: { name: string; metadata?: { label?: string; createdAt?: number } | null; status: () => Promise<{ percentage: number; completedResourceSize: number; state: number }> }[] =
    (await timeout(om.getPacks(), LIST_TIMEOUT_MS)) ?? [];
  const out: OfflineArea[] = [];
  for (const p of packs) {
    const name = p.name;
    if (typeof name !== "string") continue;
    const kind = name.startsWith(AREA_PREFIX) ? "area" : name.startsWith(PREFIX) ? "route" : null;
    if (!kind) continue;
    const s = await p.status().catch(() => null);
    const stamp = Number(name.slice(kind === "area" ? AREA_PREFIX.length : PREFIX.length));
    out.push({
      name,
      kind,
      label: p.metadata?.label ?? (kind === "route" ? "Recent drive" : "Area"),
      createdAt: p.metadata?.createdAt ?? (Number.isFinite(stamp) ? stamp : null),
      percentage: s ? Math.round(s.percentage) : 0,
      bytes: s?.completedResourceSize ?? 0,
      complete: !!s && (s.state === COMPLETE || s.percentage >= 100),
    });
  }
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export interface DownloadProgress {
  percentage: number;
  bytes: number;
  complete: boolean;
}

/** Starts downloading the area; progress and errors come back through the callbacks. Returns the pack name. */
export async function downloadArea(
  center: { latitude: number; longitude: number },
  radiusKm: number,
  onProgress: (p: DownloadProgress) => void,
  onError: (message: string) => void,
  nowMs = Date.now()
): Promise<string> {
  const om = (loadMapbox() as { offlineManager?: any } | null)?.offlineManager;
  if (!om) throw new Error("Offline maps aren't available in this version");
  const name = `${AREA_PREFIX}${nowMs}`;
  await om.createPack(
    { name, styleURL: PACK_STYLE, bounds: areaBounds(center, radiusKm), minZoom: 10, maxZoom: 15, metadata: { label: `${radiusKm} km around you`, createdAt: nowMs } },
    (_pack: unknown, s: { percentage: number; completedResourceSize: number; state: number }) =>
      onProgress({ percentage: Math.round(s.percentage), bytes: s.completedResourceSize, complete: s.state === COMPLETE || s.percentage >= 100 }),
    (_pack: unknown, err: { message?: string }) => onError(err?.message || "The download stopped")
  );
  return name;
}

export async function deleteOfflineArea(name: string): Promise<void> {
  const om = (loadMapbox() as { offlineManager?: any } | null)?.offlineManager;
  if (!om) throw new Error("Offline maps aren't available in this version");
  await om.deletePack(name);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}
