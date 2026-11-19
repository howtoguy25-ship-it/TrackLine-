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
