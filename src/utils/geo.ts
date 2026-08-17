const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(latitude: number, longitude: number, precision = 9): string {
  const latRange: [number, number] = [-90, 90];
  const lonRange: [number, number] = [-180, 180];
  let hash = "";
  let isEven = true;
  let bit = 0;
  let ch = 0;

  while (hash.length < precision) {
    if (isEven) {
      const mid = (lonRange[0] + lonRange[1]) / 2;
      if (longitude > mid) {
        ch |= 1 << (4 - bit);
        lonRange[0] = mid;
      } else {
        lonRange[1] = mid;
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (latitude > mid) {
        ch |= 1 << (4 - bit);
        latRange[0] = mid;
      } else {
        latRange[1] = mid;
      }
    }
    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Initial compass bearing (0-360, 0 = north) from point 1 to point 2 -- real great-circle
 *  bearing, not a flat-plane approximation, so it stays accurate at any latitude. */
export function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Real great-circle destination point (not a flat-plane approximation), given a start point,
 *  an initial bearing in degrees, and a distance in meters -- the direct inverse of
 *  bearingDegrees/distanceKm above (start + bearing + distance -> end point, instead of two
 *  points -> bearing/distance). Used to place a live alert a short distance AHEAD of the
 *  driver's own current heading rather than exactly on top of their live GPS fix -- a report
 *  genuinely reflects a real hazard on the ROAD ahead, and placing it exactly at the reporter's
 *  own coordinate (their live GPS fix, itself always a little stale, plus however many seconds
 *  the type-picker/confirm tap sequence took) was landing pins measurably behind where the
 *  hazard actually is relative to the direction traffic is moving -- the real, confirmed
 *  complaint behind "the set alert doesn't set in its direction placed". */
export function offsetLatLngByHeading(
  lat: number,
  lon: number,
  headingDeg: number,
  distanceMeters: number
): { latitude: number; longitude: number } {
  const R = 6371000; // mean Earth radius, meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const brng = toRad(headingDeg);
  const angularDist = distanceMeters / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) + Math.cos(lat1) * Math.sin(angularDist) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { latitude: toDeg(lat2), longitude: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** Shortest distance in meters from a point to a polyline (the minimum over every segment's
 *  point-to-segment distance) -- the real signal for "has the driver actually left the route,"
 *  not just "is the current step's endpoint getting farther away" (which never fires at all if
 *  a missed turn/exit sends the driver somewhere the remaining steps never happen to pass near).
 *  Uses a flat-plane equirectangular approximation (fine at the tens/hundreds-of-meters scale
 *  this is used at -- not meant for long-distance navigation math the way distanceKm's real
 *  haversine calculation above is). */
export function distanceToPolylineMeters(
  lat: number,
  lon: number,
  polyline: { latitude: number; longitude: number }[]
): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return distanceKm(lat, lon, polyline[0].latitude, polyline[0].longitude) * 1000;
  }

  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const px = lon * metersPerDegLon;
  const py = lat * metersPerDegLat;

  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const ax = a.longitude * metersPerDegLon;
    const ay = a.latitude * metersPerDegLat;
    const bx = b.longitude * metersPerDegLon;
    const by = b.latitude * metersPerDegLat;

    const abx = bx - ax;
    const aby = by - ay;
    const lengthSq = abx * abx + aby * aby;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq)) : 0;
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

/** Walks forward along a polyline starting from the point on it nearest (lat, lon), returning
 *  the lat/lon reached after `meters` of travel along the line -- "the point 1km ahead on the
 *  route from here," not just some fixed vertex. Used to scope the traffic-jam check to a
 *  near-term window ahead of the driver (per explicit request: "traffic ... from their
 *  location live -to 1km") instead of averaging delay over the whole remaining trip. Returns
 *  null if the polyline ends before `meters` is covered (remaining route is shorter than the
 *  window -- the whole-route check already covers that case). */
export function pointAheadOnPolylineMeters(
  lat: number,
  lon: number,
  polyline: { latitude: number; longitude: number }[],
  meters: number
): { latitude: number; longitude: number } | null {
  if (polyline.length < 2) return null;

  // Same nearest-segment projection distanceToPolylineMeters above uses, so "ahead" starts
  // from wherever the driver actually is relative to the route line, not the nearest vertex.
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const px = lon * metersPerDegLon;
  const py = lat * metersPerDegLat;

  let bestIndex = 0;
  let bestT = 0;
  let bestDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const ax = a.longitude * metersPerDegLon;
    const ay = a.latitude * metersPerDegLat;
    const bx = b.longitude * metersPerDegLon;
    const by = b.latitude * metersPerDegLat;
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSq = abx * abx + aby * aby;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq)) : 0;
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
      bestT = t;
    }
  }

  const segStart = polyline[bestIndex];
  const segEnd = polyline[bestIndex + 1];
  let cursor = {
    latitude: segStart.latitude + bestT * (segEnd.latitude - segStart.latitude),
    longitude: segStart.longitude + bestT * (segEnd.longitude - segStart.longitude),
  };
  let cursorIndex = bestIndex;
  let segRemainingMeters = distanceKm(cursor.latitude, cursor.longitude, segEnd.latitude, segEnd.longitude) * 1000;

  let remaining = meters;
  while (remaining > segRemainingMeters) {
    remaining -= segRemainingMeters;
    cursorIndex += 1;
    if (cursorIndex >= polyline.length - 1) return null;
    cursor = polyline[cursorIndex];
    const next = polyline[cursorIndex + 1];
    segRemainingMeters = distanceKm(cursor.latitude, cursor.longitude, next.latitude, next.longitude) * 1000;
  }

  const next = polyline[cursorIndex + 1];
  const frac = segRemainingMeters > 0 ? remaining / segRemainingMeters : 0;
  return {
    latitude: cursor.latitude + frac * (next.latitude - cursor.latitude),
    longitude: cursor.longitude + frac * (next.longitude - cursor.longitude),
  };
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
