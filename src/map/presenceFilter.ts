// Which other drivers' Trackys go on the map: never the driver themselves (the server's nearby
// list includes their own entry, which used to be drawn on top of their own arrow), never anyone
// they've blocked, nor any earlier account this phone used (services/ownUids.ts); nearest first,
// at most `max`. Pure, tested in __tests__/nav/navArrowLine.test.ts.
import { distanceKm } from "@/utils/geo";
import type { LatLng } from "@/utils/polyline";

/**
 * Permanent fix §1: anything this close to you is drawn on your own arrow -- in practice your own
 * presence under an id this phone never saw (a reinstall, another device signed in as you), whose
 * server entry lingers for minutes. It's hidden; a real neighbour that close is under your arrow anyway.
 */
export const ON_MY_ARROW_M = 20;

/**
 * Fix pass 5 §3: everyone but you (current uid and every id this phone has used). Shared by the
 * drawn layer (presencesToShow) and anything else that reads other drivers -- e.g. "Trackys
 * slowing down ahead", which used the raw list and could count your own position.
 */
export function othersOnly<T extends { uid: string }>(list: readonly T[], ownUid: string | null, ownUids?: ReadonlySet<string>): T[] {
  if (!ownUid) return [];
  return list.filter((p) => p.uid !== ownUid && !ownUids?.has(p.uid));
}

export function presencesToShow<T extends { uid: string; lat: number; lng: number }>(
  list: readonly T[],
  o: { ownUid: string | null; blocked: ReadonlySet<string>; here: LatLng; max: number; ownUids?: ReadonlySet<string>; /** Your own position (default: `here`): nobody is drawn on your arrow. */ me?: LatLng | null }
): T[] {
  // Until we know who you are, we can't tell which one is you: draw none.
  return othersOnly(list, o.ownUid, o.ownUids)
    .filter((p) => !o.blocked.has(p.uid))
    .filter((p) => {
      const me = o.me ?? o.here;
      return distanceKm(me.latitude, me.longitude, p.lat, p.lng) * 1000 > ON_MY_ARROW_M;
    })
    .map((p) => ({ p, d: distanceKm(o.here.latitude, o.here.longitude, p.lat, p.lng) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, o.max)
    .map((x) => x.p);
}
