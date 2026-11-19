// The info banner above the bottom bar while driving: the nearest real thing reported on the road
// still ahead ("Police reported ahead · 800 m", "Road closed ahead · 1.2 km"), only when there is
// one within INFO_BANNER_MAX_METERS. Built from the same events-on-route the ETA sheet lists (real
// community reports and Live Traffic NSW incidents projected onto the remaining route), so tapping
// it opens exactly that list. Pure; tested in __tests__/nav/navOptions.test.tsx.
import type { RouteEvent } from "@/travel/etaSheet";
import { formatDistance, type DistanceUnit } from "@/utils/navFormat";

export const INFO_BANNER_MAX_METERS = 5000;

export interface InfoBanner {
  text: string;
  kind: RouteEvent["kind"];
  eventId: string;
}

export function infoBannerFor(events: RouteEvent[], unit: DistanceUnit, maxMeters = INFO_BANNER_MAX_METERS): InfoBanner | null {
  const next = events.filter((e) => e.alongMeters >= 0 && e.alongMeters <= maxMeters).sort((a, b) => a.alongMeters - b.alongMeters)[0];
  if (!next) return null;
  const what = next.kind === "incident" ? `${next.label} ahead` : `${next.label} reported ahead`;
  return { text: `${what} · ${formatDistance(next.alongMeters, unit)}`, kind: next.kind, eventId: next.id };
}
