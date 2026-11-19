// Lanes at a manoeuvre, from the routing data itself -- never made up. Mapbox (and OSRM, whose
// response format Mapbox's Directions API shares) give each intersection's lanes left to right,
// each with the directions painted on it ("indications") and whether it's a lane for this route
// ("valid"). Banner instructions repeat that as "lane" components with "active" set on the lanes
// to use. When a manoeuvre has no lane data, there is simply no lane strip and no lane sentence.
//
// Nothing here imports React Native, so it's unit-tested directly (__tests__/nav/lanes.test.ts).

export type LaneIndication =
  | "straight"
  | "slight left"
  | "slight right"
  | "left"
  | "right"
  | "sharp left"
  | "sharp right"
  | "uturn"
  | "merge to left"
  | "merge to right"
  | "none";

export interface Lane {
  /** What's painted on the lane, left-most first. "none" = an unmarked lane. */
  indications: LaneIndication[];
  /** A lane you can use for this route. */
  valid: boolean;
  /** A lane the router prefers (Mapbox "active"); falls back to valid. */
  active: boolean;
  /** Which of its arrows applies to this route, when the data says. */
  validIndication?: LaneIndication;
}

const KNOWN: ReadonlySet<string> = new Set<LaneIndication>([
  "straight",
  "slight left",
  "slight right",
  "left",
  "right",
  "sharp left",
  "sharp right",
  "uturn",
  "merge to left",
  "merge to right",
  "none",
]);

function indication(raw: unknown): LaneIndication | null {
  return typeof raw === "string" && KNOWN.has(raw) ? (raw as LaneIndication) : null;
}

function indications(raw: unknown): LaneIndication[] {
  const list = Array.isArray(raw) ? raw.map(indication).filter((x): x is LaneIndication => x !== null) : [];
  return list.length > 0 ? list : ["none"];
}

/** An intersection's `lanes` array (Mapbox / OSRM). Empty or missing -> null (no lane data). */
export function parseIntersectionLanes(raw: unknown): Lane[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lanes = raw.map((l: Record<string, unknown>) => {
    const valid = l?.valid === true;
    return {
      indications: indications(l?.indications),
      valid,
      active: typeof l?.active === "boolean" ? l.active && valid : valid,
      validIndication: indication(l?.valid_indication) ?? undefined,
    };
  });
  return lanes;
}

/**
 * A banner instruction's `sub.components` of type "lane" (Mapbox). These carry `directions`,
 * `active` and `active_direction`. Returns null when the banner has no lane components.
 */
export function parseBannerLanes(components: unknown): Lane[] | null {
  if (!Array.isArray(components)) return null;
  const lanes = components
    .filter((c: Record<string, unknown>) => c?.type === "lane")
    .map((c: Record<string, unknown>) => {
      const active = c.active === true;
      return {
        indications: indications(c.directions),
        valid: active,
        active,
        validIndication: indication(c.active_direction) ?? undefined,
      };
    });
  return lanes.length > 0 ? lanes : null;
}

/** Lane data worth showing: at least one usable lane, and not every lane usable. */
export function lanesAreUseful(lanes: Lane[] | null | undefined): lanes is Lane[] {
  if (!lanes || lanes.length < 2) return false;
  const usable = lanes.filter((l) => l.valid).length;
  return usable > 0 && usable < lanes.length;
}

/** The lane strip appears from this far before a manoeuvre with lane data. */
export const LANE_STRIP_FROM_METERS = 1000;

export function showLaneStrip(lanes: Lane[] | null | undefined, metersToManoeuvre: number): boolean {
  return lanesAreUseful(lanes) && metersToManoeuvre <= LANE_STRIP_FROM_METERS && metersToManoeuvre >= 0;
}

export type LaneSide = "left" | "right" | "middle";

export interface LaneSummary {
  /** How many lanes can be used. */
  count: number;
  total: number;
  /** Where those lanes sit across the road. */
  side: LaneSide;
}

/** Which side the usable lanes are on: "the two left lanes", "the right lane", "the middle lane". */
export function summariseLanes(lanes: Lane[]): LaneSummary | null {
  if (!lanesAreUseful(lanes)) return null;
  const valid = lanes.map((l, i) => (l.valid ? i : -1)).filter((i) => i >= 0);
  const first = valid[0];
  const last = valid[valid.length - 1];
  const side: LaneSide = first === 0 ? "left" : last === lanes.length - 1 ? "right" : "middle";
  return { count: valid.length, total: lanes.length, side };
}

const COUNT_WORDS = ["", "", "two", "three", "four", "five", "six"];

/** "the two left lanes", "the right lane", "the middle lane". */
export function lanePhrase(summary: LaneSummary): string {
  const plural = summary.count > 1;
  const count = plural ? `${COUNT_WORDS[summary.count] ?? String(summary.count)} ` : "";
  return `the ${count}${summary.side} lane${plural ? "s" : ""}`;
}

export interface LaneSentenceInput {
  lanes: Lane[] | undefined;
  /** What kind of manoeuvre the lanes lead to. */
  kind: "exit" | "fork" | "merge" | "turn" | "roundabout" | "other";
  /** Which way the road bends off ("left" / "right"), when it does. */
  side?: "left" | "right";
  /** The motorway exit number ("3B"), when signed. */
  exitNumber?: string;
  /** The road or destination the manoeuvre leads to. */
  toward?: string;
}

/**
 * The lane part of a spoken instruction:
 *   exit with a number:  "keep left, use the two left lanes to take exit 3B"
 *   exit without:        "keep left, use the left lane to take the exit to Silverwater Road"
 *   anything else:       "use the two right lanes"
 * Null when there's no useful lane data (then nothing about lanes is said).
 */
export function laneSentence(input: LaneSentenceInput): string | null {
  const summary = input.lanes ? summariseLanes(input.lanes) : null;
  if (!summary) return null;
  const lanes = `use ${lanePhrase(summary)}`;
  if (input.kind === "exit" || input.kind === "fork") {
    const keep = input.side ? `keep ${input.side}, ` : "";
    const target = input.exitNumber
      ? `take exit ${input.exitNumber}`
      : input.toward
        ? `take the exit to ${input.toward}`
        : "take the exit";
    return `${keep}${lanes} to ${target}`;
  }
  return lanes;
}
