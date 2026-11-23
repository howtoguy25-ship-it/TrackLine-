// Gap item 5: the siren radar (services/sirenDetection.ts, on-device) hears an emergency vehicle
// while you're navigating -> the same ahead banner and voice as every other alert, "Emergency
// vehicle nearby, move aside safely". A siren has no position or direction we can know, so it is
// never put on the map or given a distance: it rides just ahead of the car ("Nearby") while the
// radar keeps hearing it, and ends SIREN_HOLD_MS after the last detection. One banner per
// episode: detections inside the hold keep the same key, so the controller doesn't repeat it.
// No official feed publishes emergency vehicles. Pure; tested in __tests__/gap/sirenAhead.test.ts.
import { KIND_TIER } from "@/nav/ahead/aheadKinds";
import type { AheadAlert } from "@/nav/ahead/aheadFeed";

export const SIREN_HOLD_MS = 60_000;
/** Just ahead of the car, so "passing the spot" never ends it; the hold does. */
const RIDE_AHEAD_M = 1;
export const SIREN_TITLE = "Emergency vehicle nearby";
export const SIREN_SPOKEN = "Emergency vehicle nearby, move aside safely";

export interface SirenEpisode {
  firstAt: number;
  lastAt: number;
  /** Where the car was when it was first heard (for "show me" from the list; not drawn on the map). */
  lat: number;
  lng: number;
}

/** A detection: continues the episode if it's still within the hold, otherwise starts a new one. */
export function noteSiren(prev: SirenEpisode | null, at: number, where: { latitude: number; longitude: number }): SirenEpisode {
  if (prev && at - prev.lastAt <= SIREN_HOLD_MS) return { ...prev, lastAt: at };
  return { firstAt: at, lastAt: at, lat: where.latitude, lng: where.longitude };
}

export function sirenActive(ep: SirenEpisode | null, now: number): ep is SirenEpisode {
  return !!ep && now - ep.lastAt <= SIREN_HOLD_MS;
}

/** The ahead alert for an active episode, placed with the car (null once it has ended). */
export function sirenAheadAlert(ep: SirenEpisode | null, carAlongM: number, now: number): AheadAlert | null {
  if (!sirenActive(ep, now)) return null;
  return {
    key: `siren:${ep.firstAt}`,
    kind: "emergency",
    item: "emergencyVehicles",
    source: "siren",
    lat: ep.lat,
    lng: ep.lng,
    alongM: carAlongM + RIDE_AHEAD_M,
    aheadM: RIDE_AHEAD_M,
    tier: KIND_TIER.emergency,
    critical: false,
    minor: false,
    title: SIREN_TITLE,
  };
}
