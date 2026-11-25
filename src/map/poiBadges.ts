// Brand & popular-place badges on the map: small rounded-square badges with a pointer, our own
// category icon, and the place's name beside it. Drawn natively from Mapbox Streets v8's own
// `poi_label` features (real data already in the map tiles -- no extra requests, no billing):
//
//   - which places: branded ones (Mapbox's standardized `brand` field) in the categories below,
//     plus every hospital (rarely branded, always worth showing);
//   - when: fuel and hospitals from zoom 13, everything else from zoom 15;
//   - how many: Mapbox's own `filterrank` prominence (0 = most prominent at that zoom) keeps the
//     least prominent off and orders the rest, and native symbol collision with generous padding
//     keeps badges apart -- in practice about a dozen on a phone screen (BADGE_PADDING_PX);
//   - logos: only for signed partners. PARTNER_LOGOS is the hook -- empty until a partner's logo
//     file and written permission are in licences/. The style asks for "logo:<brand>" first and
//     falls back to our category badge, so adding a partner is one entry, no style change.
//
// Which of them get drawn is decided by the app, not native collision: map/poiRanking.ts ranks
// the candidates on screen by real popularity (Google Places rating count + business status,
// cached server-side; anonymous opt-in arrivals; a 300 m nearby boost) and draws the top ~12.
//
// Plain data, no React Native imports; tested in __tests__/poiBadges.test.ts.

export type BadgeCategory = "fuel" | "hospital" | "cart" | "cup" | "fork" | "bag" | "parking";

/** Mapbox maki value -> our badge category. Values from the Streets v8 reference. */
export const MAKI_BADGE: Readonly<Record<string, BadgeCategory>> = {
  fuel: "fuel",
  "charging-station": "fuel",
  hospital: "hospital",
  grocery: "cart",
  convenience: "cart",
  "alcohol-shop": "cart",
  cafe: "cup",
  bakery: "cup",
  "ice-cream": "cup",
  restaurant: "fork",
  "fast-food": "fork",
  "restaurant-pizza": "fork",
  "restaurant-noodle": "fork",
  "restaurant-seafood": "fork",
  shop: "bag",
  "clothing-store": "bag",
  shoe: "bag",
  "jewelry-store": "bag",
  furniture: "bag",
  hardware: "bag",
  "mobile-phone": "bag",
  pharmacy: "bag",
  parking: "parking",
  "parking-garage": "parking",
};

/** Categories shown from zoom 13; the rest from zoom 15. */
export const EARLY_CATEGORIES: readonly BadgeCategory[] = ["fuel", "hospital"];
export const EARLY_MIN_ZOOM = 13;
export const BADGE_MIN_ZOOM = 15;
/** Only the more prominent places get a badge (Mapbox filterrank 0-5, lower = more prominent). */
export const BADGE_MAX_FILTERRANK = 2;
/** Space kept clear around each badge; sized so a phone screen holds about a dozen. */
export const BADGE_PADDING_PX = 28;
/** Our badge colours per category (fills; the glyph is white). */
export const BADGE_COLOURS: Readonly<Record<BadgeCategory, string>> = {
  fuel: "#16A34A",
  hospital: "#D93025",
  cart: "#1A73E8",
  cup: "#8D5524",
  fork: "#F97316",
  bag: "#9334E6",
  parking: "#1967D2",
};

/** Signed partners' logos: brand value -> image name. Empty: no partner has signed yet. */
export const PARTNER_LOGOS: Readonly<Record<string, string>> = {};

export const BADGE_CATEGORIES = Object.keys(BADGE_COLOURS) as BadgeCategory[];

export function badgeIconName(category: BadgeCategory): string {
  return `badge:${category}`;
}

export function badgeCategoryForMaki(maki: string | null | undefined): BadgeCategory | null {
  return (maki && MAKI_BADGE[maki]) || null;
}

function makisFor(categories: readonly BadgeCategory[]): string[] {
  return Object.entries(MAKI_BADGE)
    .filter(([, c]) => categories.includes(c))
    .map(([m]) => m)
    .sort();
}

type Json = unknown;

/** Mapbox filter for one of the two badge layers. */
export function badgeFilter(early: boolean): Json {
  const categories = early ? EARLY_CATEGORIES : BADGE_CATEGORIES.filter((c) => !EARLY_CATEGORIES.includes(c));
  return [
    "all",
    ["match", ["get", "maki"], makisFor(categories), true, false],
    // Branded places, and hospitals whatever their brand.
    ["any", ["==", ["get", "maki"], "hospital"], ["has", "brand"]],
    ["<=", ["get", "filterrank"], BADGE_MAX_FILTERRANK],
  ];
}

/** Every feature either badge layer draws (so the plain POI labels can skip them). */
export function isBadgeFeature(): Json {
  return [
    "all",
    ["match", ["get", "maki"], makisFor(BADGE_CATEGORIES), true, false],
    ["any", ["==", ["get", "maki"], "hospital"], ["has", "brand"]],
    ["<=", ["get", "filterrank"], BADGE_MAX_FILTERRANK],
  ];
}

/** Partner logo first (when registered), else our category badge. */
export function badgeIconExpression(): Json {
  const byMaki: Json[] = [];
  for (const category of BADGE_CATEGORIES) {
    byMaki.push(makisFor([category]), badgeIconName(category));
  }
  const categoryIcon = ["match", ["get", "maki"], ...byMaki, badgeIconName("bag")];
  return ["coalesce", ["image", ["concat", "logo:", ["coalesce", ["get", "brand"], ""]]], ["image", categoryIcon]];
}

export const BADGE_LAYER_IDS = ["poi-badges-early", "poi-badges"] as const;

// ---- ranked badges (map/poiRanking.ts) -------------------------------------------------------
// The map no longer lets native collision choose the badges. The badge layers above are
// replaced by one invisible candidate layer (nothing drawn, nothing collides, but its features
// can be read back); the app ranks those candidates by real popularity and draws the top ones
// in its own layer (RANKED_BADGE_LAYER_ID).

export const BADGE_CANDIDATE_LAYER_ID = "poi-badge-candidates";
export const RANKED_BADGE_LAYER_ID = "ranked-badges";

export function badgeCandidateLayer(): Json {
  return {
    id: BADGE_CANDIDATE_LAYER_ID,
    type: "circle",
    source: "composite",
    "source-layer": "poi_label",
    minzoom: EARLY_MIN_ZOOM,
    filter: isBadgeFeature(),
    paint: { "circle-radius": 1, "circle-opacity": 0, "circle-stroke-opacity": 0 },
  };
}

/** A style with the badge layers swapped for the candidate layer (same position in the stack). */
export function withRankedBadges<T extends { layers: { id: string }[] }>(style: T): T {
  const layers: unknown[] = [];
  let inserted = false;
  for (const l of style.layers) {
    if ((BADGE_LAYER_IDS as readonly string[]).includes(l.id)) {
      if (!inserted) layers.push(badgeCandidateLayer());
      inserted = true;
      continue;
    }
    layers.push(l);
  }
  return { ...style, layers: layers as T["layers"] };
}
