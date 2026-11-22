// Which other drivers' Trackys go on the map: never the driver themselves (the server's nearby
// list includes their own entry, which used to be drawn on top of their own arrow), never anyone
// they've blocked, nor any earlier account this phone used (services/ownUids.ts); nearest first,
// at most `max`. Pure, tested in __tests__/nav/navArrowLine.test.ts.
import { distanceKm } from "@/utils/geo";
import type { LatLng } from "@/utils/polyline";

export function presencesToShow<T extends { uid: string; lat: number; lng: number }>(
  list: readonly T[],
  o: { ownUid: string | null; blocked: ReadonlySet<string>; here: LatLng; max: number; ownUids?: ReadonlySet<string> }
): T[] {
  return list
    .filter((p) => p.uid !== o.ownUid && !o.ownUids?.has(p.uid) && !o.blocked.has(p.uid))
    .map((p) => ({ p, d: distanceKm(o.here.latitude, o.here.longitude, p.lat, p.lng) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, o.max)
    .map((x) => x.p);
}
