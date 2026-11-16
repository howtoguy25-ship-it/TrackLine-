// Which brand / popular-place badges to draw on this screen, and in what order.
//
// Candidates are the badge features Mapbox's own tiles hold for the view (map/poiBadges.ts
// decides which places qualify). Each gets a popularity score from real data only:
//
//   prominence   Mapbox's filterrank (0 = most prominent at this zoom)          up to 25
//   ratings      Google Places userRatingCount, log-scaled (100 -> 20, 10k -> 40) up to 40
//   arrivals     anonymous count of opted-in TrackLine drivers who arrived there    up to 25
//   nearby       within NEARBY_BOOST_M of the driver                               +20
//
// A place Google lists as closed (temporarily or for good) gets no badge. Then, best first, a
// badge is kept only if its box doesn't overlap one already kept (plus padding), up to
// MAX_PER_SCREEN. Places with no Google data yet simply rank on what's known -- never a
// made-up rating.
//
// Pure; tested in __tests__/poiRanking.test.ts.

import { BADGE_MIN_ZOOM, EARLY_CATEGORIES, EARLY_MIN_ZOOM, BADGE_PADDING_PX, type BadgeCategory } from "@/map/poiBadges";

export const MAX_PER_SCREEN = 12;
export const NEARBY_BOOST_M = 300;
export const NEARBY_BOOST = 20;
/** Badge box on screen (badge + its name beside it), in points. */
export const BADGE_BOX = { width: 110, height: 34 };

export interface BadgeCandidate {
  /** Stable key for the place: Mapbox feature id, or name + rounded position. */
  key: string;
  name: string;
  brand?: string | null;
  category: BadgeCategory;
  filterrank: number;
  lat: number;
  lng: number;
  /** Position on screen (points). */
  x: number;
  y: number;
}

export interface Popularity {
  ratingCount?: number | null;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
  arrivals?: number | null;
}

export interface RankInput {
  zoom: number;
  driver?: { latitude: number; longitude: number } | null;
  popularity?: Readonly<Record<string, Popularity>>;
  screen: { width: number; height: number };
  max?: number;
}

export interface RankedBadge extends BadgeCandidate {
  score: number;
}

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
export function metres(a: { latitude: number; longitude: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.latitude);
  const dLng = rad(b.lng - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Shown at this zoom? Fuel and hospitals from 13, everything else from 15. */
export function visibleAtZoom(category: BadgeCategory, zoom: number): boolean {
  return zoom >= (EARLY_CATEGORIES.includes(category) ? EARLY_MIN_ZOOM : BADGE_MIN_ZOOM);
}

export function popularityScore(c: BadgeCandidate, pop: Popularity | undefined, driver: RankInput["driver"]): number | null {
  if (pop?.businessStatus === "CLOSED_PERMANENTLY" || pop?.businessStatus === "CLOSED_TEMPORARILY") return null;
  const prominence = Math.max(0, 5 - Math.min(5, c.filterrank)) * 5;
  const ratings = pop?.ratingCount ? Math.min(40, 10 * Math.log10(1 + pop.ratingCount)) : 0;
  const arrivals = pop?.arrivals ? Math.min(25, 12.5 * Math.log10(1 + pop.arrivals)) : 0;
  const nearby = driver && metres(driver, c) <= NEARBY_BOOST_M ? NEARBY_BOOST : 0;
  return prominence + ratings + arrivals + nearby;
}

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const w = BADGE_BOX.width + BADGE_PADDING_PX;
  const h = BADGE_BOX.height + BADGE_PADDING_PX;
  return Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;
}

/** The badges to draw: on screen, open, best first, no two overlapping, at most max. */
export function rankBadges(candidates: readonly BadgeCandidate[], input: RankInput): RankedBadge[] {
  const max = input.max ?? MAX_PER_SCREEN;
  const scored: RankedBadge[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    if (!visibleAtZoom(c.category, input.zoom)) continue;
    if (c.x < 0 || c.y < 0 || c.x > input.screen.width || c.y > input.screen.height) continue;
    const score = popularityScore(c, input.popularity?.[c.key], input.driver);
    if (score === null) continue;
    scored.push({ ...c, score });
  }
  // Best first; ties go to the more prominent, then by key so the order never flickers.
  scored.sort((a, b) => b.score - a.score || a.filterrank - b.filterrank || a.key.localeCompare(b.key));
  const kept: RankedBadge[] = [];
  for (const c of scored) {
    if (kept.length >= max) break;
    if (kept.some((k) => overlaps(k, c))) continue;
    kept.push(c);
  }
  return kept;
}

/** The cache key the server uses for a place's popularity (name + ~150 m cell). */
export function popularityKey(name: string, lat: number, lng: number): string {
  const n = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
  return `${n}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
}
