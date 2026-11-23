// The siren radar's decisions, from each 0.96-1 s window the on-device YAMNet model classifies
// (services/sirenDetection.ts). Pure; tested in __tests__/siren/sirenTracker.test.ts.
//
//   trigger    siren confidence >= TRIGGER_CONFIDENCE in TRIGGER_HITS of the last TRIGGER_WINDOWS
//              windows (one loud horn or a song with a siren sample doesn't do it)
//   type       the strongest of the police / ambulance / fire classes; if none stands out,
//              "Emergency vehicle" -- never a guess beyond what the model heard
//   closeness  from the loudness trend (RMS dB) over the last ~3 s: rising -> "Getting closer",
//              falling -> "Moving away", otherwise "Nearby". No left / right / behind: a phone's
//              microphones can't tell that reliably, so the app never says it.
//   end        END_AFTER_MS after the last window with a siren
//   when       only while driving (over MIN_SPEED_KMH, or navigating), with the setting on, and
//              never during a phone call or while the app's own voice / music is loud

export const TRIGGER_CONFIDENCE = 0.6;
export const TRIGGER_HITS = 3;
export const TRIGGER_WINDOWS = 5;
export const END_AFTER_MS = 8000;
export const MIN_SPEED_KMH = 10;
/** dB per second of loudness change that counts as getting closer / moving away. */
export const TREND_DB_PER_S = 1.5;
const TREND_SPAN_MS = 3000;

/** YAMNet (AudioSet) class names the radar listens for. */
export const SIREN_CLASSES = {
  generic: ["Siren", "Civil defense siren", "Emergency vehicle"],
  police: ["Police car (siren)"],
  ambulance: ["Ambulance (siren)"],
  fire: ["Fire engine, fire truck (siren)"],
} as const;

export type SirenType = "police" | "ambulance" | "fire" | "emergency";
export type Closeness = "closer" | "nearby" | "away";

export const TYPE_LABEL: Record<SirenType, string> = { police: "Police", ambulance: "Ambulance", fire: "Fire truck", emergency: "Emergency vehicle" };
export const CLOSENESS_LABEL: Record<Closeness, string> = { closer: "Getting closer", nearby: "Nearby", away: "Moving away" };

export interface SirenWindow {
  at: number;
  /** label -> confidence, from the model. */
  scores: Record<string, number>;
  /** Loudness of the window (dBFS, from the recorder's metering), if known. */
  rmsDb: number | null;
}

export function sirenConfidence(scores: Record<string, number>): number {
  let best = 0;
  for (const group of Object.values(SIREN_CLASSES)) for (const label of group) best = Math.max(best, scores[label] ?? 0);
  return best;
}

/** A siren window: the siren classes reach the threshold and music isn't louder than them. */
export function isSirenWindow(scores: Record<string, number>, threshold: number): boolean {
  const c = sirenConfidence(scores);
  return c >= threshold && (scores.Music ?? 0) <= c;
}

export function typeGuess(windows: readonly SirenWindow[]): SirenType {
  const sum = { police: 0, ambulance: 0, fire: 0 };
  for (const w of windows) for (const k of ["police", "ambulance", "fire"] as const) for (const label of SIREN_CLASSES[k]) sum[k] += w.scores[label] ?? 0;
  const [top, second] = (Object.entries(sum) as [keyof typeof sum, number][]).sort((a, b) => b[1] - a[1]);
  // A clear winner only: at least a little evidence, and well ahead of the next.
  if (top[1] < 0.3 * windows.length || top[1] < second[1] * 1.5) return "emergency";
  return top[0];
}

export function closeness(windows: readonly SirenWindow[]): Closeness {
  const pts = windows.filter((w) => w.rmsDb != null && Number.isFinite(w.rmsDb));
  if (pts.length < 3) return "nearby";
  const last = pts[pts.length - 1].at;
  const span = pts.filter((w) => last - w.at <= TREND_SPAN_MS);
  if (span.length < 3) return "nearby";
  // Least-squares slope, dB per second.
  const xs = span.map((w) => (w.at - span[0].at) / 1000);
  const ys = span.map((w) => w.rmsDb as number);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (den === 0) return "nearby";
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den;
  return slope >= TREND_DB_PER_S ? "closer" : slope <= -TREND_DB_PER_S ? "away" : "nearby";
}

export function shouldListen(p: { settingOn: boolean; speedKmh: number | null; navigating: boolean; onCall: boolean; ownAudioLoud: boolean }): boolean {
  if (!p.settingOn || p.onCall || p.ownAudioLoud) return false;
  return p.navigating || (p.speedKmh ?? 0) > MIN_SPEED_KMH;
}

export type SirenEvent =
  | { kind: "start"; type: SirenType; closeness: Closeness; at: number }
  | { kind: "update"; type: SirenType; closeness: Closeness; at: number }
  | { kind: "end"; type: SirenType; at: number; loudestAt: number };

/** Feed it every window; it says when a siren starts, changes, and ends. */
export class SirenTracker {
  /** Settings > Siren radar sensitivity; 0.6 by default. */
  threshold = TRIGGER_CONFIDENCE;
  private recent: SirenWindow[] = [];
  private hits: SirenWindow[] = [];
  private active = false;
  private lastHitAt = 0;
  private last: { type: SirenType; closeness: Closeness } | null = null;

  push(w: SirenWindow): SirenEvent[] {
    const out: SirenEvent[] = [];
    const hit = isSirenWindow(w.scores, this.threshold);
    this.recent = [...this.recent, w].slice(-TRIGGER_WINDOWS);
    if (hit) {
      this.hits.push(w);
      this.lastHitAt = w.at;
    }
    const hitsInRecent = this.recent.filter((x) => isSirenWindow(x.scores, this.threshold)).length;
    if (!this.active && hitsInRecent >= TRIGGER_HITS) {
      this.active = true;
      const now = { type: typeGuess(this.hits), closeness: closeness(this.hits) };
      this.last = now;
      out.push({ kind: "start", ...now, at: w.at });
    } else if (this.active && hit) {
      const now = { type: typeGuess(this.hits), closeness: closeness(this.hits) };
      if (!this.last || now.type !== this.last.type || now.closeness !== this.last.closeness) out.push({ kind: "update", ...now, at: w.at });
      this.last = now;
    }
    out.push(...this.tick(w.at));
    return out;
  }

  /** Call on a timer too: a siren that stops being heard ends END_AFTER_MS later. */
  tick(now: number): SirenEvent[] {
    if (!this.active || now - this.lastHitAt < END_AFTER_MS) return [];
    const loudest = this.hits.reduce((a, b) => ((b.rmsDb ?? -Infinity) > (a.rmsDb ?? -Infinity) ? b : a), this.hits[0]);
    const ev: SirenEvent = { kind: "end", type: this.last?.type ?? "emergency", at: now, loudestAt: loudest?.at ?? this.lastHitAt };
    this.reset();
    return [ev];
  }

  reset(): void {
    this.recent = [];
    this.hits = [];
    this.active = false;
    this.last = null;
  }

  get isActive(): boolean {
    return this.active;
  }
}
