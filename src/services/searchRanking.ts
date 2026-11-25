// Ordering for the search screen's autocomplete list, and the session token rules that keep
// Google's Places bill down. No imports, so scripts/test-ui-logic.ts checks it directly.

export interface RankablePrediction {
  primaryText: string;
  secondaryText: string;
  distanceMeters?: number;
}

/**
 * How well a result's name matches what was typed:
 *   0 -- the name starts with it ("Bond" -> "Bondi Beach")
 *   1 -- a word in the name starts with it ("Bond" -> "North Bondi")
 *   2 -- anything else Google decided was relevant (an address, a fuzzy match)
 */
export function matchQuality(prediction: RankablePrediction, query: string): 0 | 1 | 2 {
  const q = normalize(query);
  if (!q) return 2;
  const name = normalize(prediction.primaryText);
  if (name.startsWith(q)) return 0;
  if (name.split(/[\s,\-/]+/).some((word) => word.startsWith(q))) return 1;
  return 2;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best matches first, nearest first within each level of match -- so a closer "Bondi Beach"
 * comes before a farther one, but a farther exact name still beats a nearby loose match.
 * Results without a distance go after those with one, in Google's own order. Stable: equal
 * results keep the order Google gave them.
 */
export function rankPredictions<T extends RankablePrediction>(predictions: T[], query: string): T[] {
  return predictions
    .map((prediction, index) => ({ prediction, index, quality: matchQuality(prediction, query) }))
    .sort((a, b) => {
      if (a.quality !== b.quality) return a.quality - b.quality;
      const da = a.prediction.distanceMeters;
      const db = b.prediction.distanceMeters;
      if (da !== undefined && db !== undefined && da !== db) return da - db;
      if (da !== undefined && db === undefined) return -1;
      if (da === undefined && db !== undefined) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.prediction);
}

/**
 * Google bills autocomplete per SESSION when every keystroke of one search carries the same
 * token and the search ends with a details request carrying it too -- instead of per keystroke.
 * A session therefore starts with the first keystroke and ends when a result is chosen (or the
 * search is abandoned). This tracks that; the token itself comes from the caller.
 */
export class SearchSession {
  private token: string | null = null;

  constructor(private readonly makeToken: () => string) {}

  /** The token for an autocomplete request, starting a session if none is open. */
  forAutocomplete(): string {
    if (!this.token) this.token = this.makeToken();
    return this.token;
  }

  /** The token for the details request that ends the session -- and closes it. */
  forDetails(): string | undefined {
    const token = this.token ?? undefined;
    this.token = null;
    return token;
  }

  /** The search was abandoned without choosing anything. */
  abandon(): void {
    this.token = null;
  }

  get active(): boolean {
    return this.token !== null;
  }
}

/** Autocomplete waits this long after the last keystroke before asking. */
export const AUTOCOMPLETE_DEBOUNCE_MS = 250;
