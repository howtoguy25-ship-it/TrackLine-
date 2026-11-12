// The data model for every icon on the Mapbox map (reports, traffic lights, speed cameras,
// fuel/food/hotel pins, NSW incidents, live cameras, place pins) -- plain data turned into one
// GeoJSON FeatureCollection, drawn by a single SymbolLayer. No React Native imports; tested in
// __tests__/mapV2.test.ts.
import { collection, pointFeature, type FeatureCollection, type LatLng, type PointFeature } from "@/map-v2/geo";

export interface MapPin {
  id: string;
  coordinate: LatLng;
  /** Name of an icon image (see layers/MapIcons.tsx for the names it knows). */
  icon: string;
  /** Multiplies the icon's drawn size. */
  size?: number;
  /** Text drawn on the icon (cluster counts). */
  label?: string;
  /** Where the coordinate sits on the icon. */
  anchor?: "center" | "bottom";
  /** Higher draws on top. */
  priority?: number;
  /** Degrees, relative to the screen (a Tracky's lean into a bend). */
  rotate?: number;
}

/** The pins as GeoJSON, ready for a ShapeSource. */
export function pinsToFeatures(pins: readonly MapPin[]): FeatureCollection<PointFeature> {
  return collection(
    pins.map((p) =>
      pointFeature(p.id, p.coordinate, {
        icon: p.icon,
        size: p.size ?? 1,
        label: p.label ?? "",
        anchor: p.anchor ?? "center",
        // Mapbox draws lower sort keys first, so the priority becomes the key directly.
        priority: p.priority ?? 0,
        rotate: p.rotate ?? 0,
      })
    )
  );
}

/** Every distinct icon the pins use, so only those images are registered. */
export function iconsUsed(pins: readonly MapPin[]): string[] {
  return Array.from(new Set(pins.map((p) => p.icon))).sort();
}

// ---------------------------------------------------------------------------------------------
// Grouping pins that would sit on top of each other.

export interface PinGroup<T> {
  key: string;
  coordinate: LatLng;
  members: T[];
}

/**
 * Groups points into grid cells of `cellDegrees` (a few hundred metres at city zoom), each group
 * placed at its members' average position. Deterministic: the same points always give the
 * same groups, so pins don't jump around between renders.
 */
export function groupByCell<T>(items: readonly T[], at: (item: T) => LatLng, cellDegrees: number): PinGroup<T>[] {
  if (cellDegrees <= 0) return items.map((item, i) => ({ key: `i${i}`, coordinate: at(item), members: [item] }));
  const cells = new Map<string, T[]>();
  for (const item of items) {
    const p = at(item);
    const key = `${Math.floor(p.latitude / cellDegrees)}:${Math.floor(p.longitude / cellDegrees)}`;
    const list = cells.get(key);
    if (list) list.push(item);
    else cells.set(key, [item]);
  }
  return Array.from(cells.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, members]) => {
      const lat = members.reduce((s, m) => s + at(m).latitude, 0) / members.length;
      const lng = members.reduce((s, m) => s + at(m).longitude, 0) / members.length;
      return { key, coordinate: { latitude: lat, longitude: lng }, members };
    });
}

/**
 * Pins for one kind of place: a single pin where a cell holds one, a counted cluster pin where
 * it holds several. `onePin` builds the single pin; clusters get `${kind}-cluster` icons.
 */
export function clusteredPins<T>(
  kind: string,
  items: readonly T[],
  at: (item: T) => LatLng,
  cellDegrees: number,
  onePin: (item: T) => MapPin
): MapPin[] {
  return groupByCell(items, at, cellDegrees).map((g) =>
    g.members.length === 1
      ? onePin(g.members[0])
      : { id: `${kind}-cluster:${g.key}`, coordinate: g.coordinate, icon: `${kind}-cluster`, label: String(g.members.length) }
  );
}
