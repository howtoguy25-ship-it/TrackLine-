// Settings > Reports > Lane ending, from the route itself: Mapbox gives the lanes at each
// intersection along a step (`intersections[].lanes`). Where the count drops from one mapped
// intersection to the next while you carry straight on (the same step), a lane ends between
// them -- the point is put at the intersection where the lower count is first seen. Only real
// lane data: intersections without lane info are skipped, never guessed.
import type { LatLng } from "@/utils/polyline";

type MapboxIntersection = { location?: number[]; lanes?: unknown[] };

export function laneEndingsInStep(intersections: readonly MapboxIntersection[] | undefined): LatLng[] {
  const out: LatLng[] = [];
  let last: number | null = null;
  for (const x of intersections ?? []) {
    const n = Array.isArray(x.lanes) ? x.lanes.length : 0;
    if (n === 0) continue;
    if (last !== null && n < last && Array.isArray(x.location) && x.location.length >= 2) {
      out.push({ latitude: x.location[1], longitude: x.location[0] });
    }
    last = n;
  }
  return out;
}
