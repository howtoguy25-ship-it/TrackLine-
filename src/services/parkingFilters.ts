// What a car park's own OpenStreetMap tags say about it, and the filtering/sorting built on
// that. No imports and no I/O, so all of it is checked by scripts/test-parking-filters.ts.
//
// The governing rule: OSM coverage of these details is patchy, so every attribute is
// THREE-valued -- yes, no, or "the map doesn't say" (null). A filter only keeps car parks that
// are a definite yes, and the sheet tells the driver how many were left out for not saying,
// rather than quietly treating silence as either answer.

export type Tags = Record<string, string> | undefined;

export interface ParkingAttributes {
  /** true = free, false = paid, null = not stated. */
  free: boolean | null;
  openNow: boolean | null;
  /** Multi-storey, underground, or otherwise roofed. */
  covered: boolean | null;
  wheelchairAccessible: boolean | null;
  disabledBays: boolean | null;
  evCharging: boolean | null;
  /** Number of spaces, when mapped. */
  capacity: number | null;
  /** True when tagged private/permit/customers-only -- shown as a label, never hidden. */
  restricted: boolean;
}

const DAYS = ["su", "mo", "tu", "we", "th", "fr", "sa"];

function parseMinutes(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Day indexes (0 = Sunday) a selector like "Mo-Fr", "Sa,Su" or "Mo-We,Fr" covers, or null. */
function parseDays(selector: string): Set<number> | null {
  const days = new Set<number>();
  for (const part of selector.toLowerCase().split(",")) {
    const range = part.trim().split("-");
    const from = DAYS.indexOf(range[0]);
    const to = range.length === 2 ? DAYS.indexOf(range[1]) : from;
    if (from < 0 || to < 0 || range.length > 2) return null;
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  return days;
}

/**
 * Whether an OSM `opening_hours` value means "open" at the given moment.
 *
 * Handles the forms that make up nearly all real car-park tagging: "24/7", and rules like
 * "Mo-Fr 07:00-19:00; Sa,Su 08:00-18:00", "06:00-22:00" (every day), times that run past
 * midnight, and "off"/"closed". The full opening_hours grammar is far larger (public holidays,
 * month ranges, sunrise/sunset...) -- anything outside the handled forms returns null, "don't
 * know", never a guess.
 */
export function isOpenAt(openingHours: string | undefined, now: Date): boolean | null {
  if (!openingHours) return null;
  const value = openingHours.trim();
  if (!value) return null;
  if (value === "24/7") return true;

  const day = now.getDay();
  const minute = now.getHours() * 60 + now.getMinutes();
  let result: boolean | null = false;
  let matchedAnyRule = false;

  for (const rawRule of value.split(";")) {
    const rule = rawRule.trim();
    if (!rule) continue;
    // "<days> <times>" | "<times>" | "<days> off"
    const match = /^(?:([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s+)?(.+)$/.exec(rule);
    if (!match) return null;
    const days = match[1] ? parseDays(match[1].replace(/\s+/g, "")) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    const timesText = match[2].trim().toLowerCase();

    if (timesText === "off" || timesText === "closed") {
      // A later rule overrides an earlier one for the days it names.
      if (days.has(day)) result = false;
      matchedAnyRule = true;
      continue;
    }

    let openByThisRule = false;
    for (const span of timesText.split(",")) {
      const [fromText, toText] = span.trim().split("-");
      const from = parseMinutes(fromText ?? "");
      const to = parseMinutes(toText ?? "");
      if (from === null || to === null) return null;
      if (to > from) {
        if (days.has(day) && minute >= from && minute < to) openByThisRule = true;
      } else {
        // Runs past midnight: open late on a listed day, or early on the day after one.
        const yesterday = (day + 6) % 7;
        if (days.has(day) && minute >= from) openByThisRule = true;
        if (days.has(yesterday) && minute < to) openByThisRule = true;
      }
    }
    matchedAnyRule = true;
    if (days.has(day)) result = openByThisRule;
    else if (openByThisRule) result = true;
  }
  return matchedAnyRule ? result : null;
}

function yesNo(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const v = value.trim().toLowerCase();
  if (v === "yes" || v === "designated" || v === "true") return true;
  if (v === "no" || v === "false") return false;
  return null;
}

function count(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parkingAttributes(tags: Tags, now: Date): ParkingAttributes {
  const t = tags ?? {};

  // fee=no is free; fee=yes (or a stated charge) is paid. A conditional fee ("free after 6pm")
  // is neither, so it's left as not stated.
  let free: boolean | null = null;
  const fee = t.fee?.trim().toLowerCase();
  if (fee === "no") free = true;
  else if (fee === "yes" || (fee === undefined && !!t.charge)) free = false;

  const kind = t.parking?.trim().toLowerCase();
  let covered = yesNo(t.covered);
  if (covered === null && kind) {
    if (kind === "multi-storey" || kind === "underground" || kind === "carports" || kind === "garage") covered = true;
    else if (kind === "surface" || kind === "street_side" || kind === "lane" || kind === "rooftop") covered = false;
  }

  // "limited" wheelchair access isn't a yes for someone who needs it.
  const wheelchair = t.wheelchair?.trim().toLowerCase();
  const wheelchairAccessible = wheelchair === "yes" ? true : wheelchair === "no" || wheelchair === "limited" ? false : null;

  const disabledCount = count(t["capacity:disabled"]);
  const disabledBays =
    disabledCount !== null ? disabledCount > 0 : yesNo(t["capacity:disabled"]) ?? yesNo(t["parking_space:disabled"]);

  const chargingCount = count(t["capacity:charging"]);
  const evCharging = chargingCount !== null ? chargingCount > 0 : yesNo(t["capacity:charging"]);

  const access = t.access?.trim().toLowerCase();
  const restricted = access === "private" || access === "permit" || access === "customers" || access === "no";

  return {
    free,
    openNow: isOpenAt(t.opening_hours, now),
    covered,
    wheelchairAccessible,
    disabledBays,
    evCharging,
    capacity: count(t.capacity),
    restricted,
  };
}

export type ParkingSort = "nearest" | "freeFirst" | "largest";

export const PARKING_SORT_LABELS: Record<ParkingSort, string> = {
  nearest: "Nearest",
  freeFirst: "Free first",
  largest: "Most spaces",
};

export interface ParkingFilters {
  openNow: boolean;
  free: boolean;
  covered: boolean;
  wheelchairAccessible: boolean;
  disabledBays: boolean;
  evCharging: boolean;
}

export const NO_PARKING_FILTERS: ParkingFilters = {
  openNow: false,
  free: false,
  covered: false,
  wheelchairAccessible: false,
  disabledBays: false,
  evCharging: false,
};

export const PARKING_FILTER_LABELS: Record<keyof ParkingFilters, string> = {
  openNow: "Open now",
  free: "Free",
  covered: "Covered",
  wheelchairAccessible: "Wheelchair accessible",
  disabledBays: "Disabled bays",
  evCharging: "EV charging",
};

export function activeFilterCount(filters: ParkingFilters): number {
  return Object.values(filters).filter(Boolean).length;
}

interface Filterable {
  distanceMeters: number;
  attributes: ParkingAttributes;
}

export interface ParkingFilterResult<T> {
  kept: T[];
  /** Left out because the map says they DON'T meet a chosen filter. */
  excludedNo: number;
  /** Left out only because the map doesn't say either way. */
  excludedUnknown: number;
}

export function applyParkingFilters<T extends Filterable>(
  items: T[],
  filters: ParkingFilters,
  sort: ParkingSort
): ParkingFilterResult<T> {
  const wanted = (Object.keys(filters) as (keyof ParkingFilters)[]).filter((key) => filters[key]);
  const kept: T[] = [];
  let excludedNo = 0;
  let excludedUnknown = 0;
  for (const item of items) {
    const values = wanted.map((key) => item.attributes[key]);
    if (values.some((v) => v === false)) excludedNo++;
    else if (values.some((v) => v === null)) excludedUnknown++;
    else kept.push(item);
  }

  const byDistance = (a: T, b: T) => a.distanceMeters - b.distanceMeters;
  if (sort === "freeFirst") {
    // Free, then not stated, then paid -- nearest first within each.
    const rank = (item: T) => (item.attributes.free === true ? 0 : item.attributes.free === null ? 1 : 2);
    kept.sort((a, b) => rank(a) - rank(b) || byDistance(a, b));
  } else if (sort === "largest") {
    // Car parks with no stated size go last, nearest first among themselves.
    kept.sort((a, b) => (b.attributes.capacity ?? -1) - (a.attributes.capacity ?? -1) || byDistance(a, b));
  } else {
    kept.sort(byDistance);
  }
  return { kept, excludedNo, excludedUnknown };
}
