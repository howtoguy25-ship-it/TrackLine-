// The ONE owner of the ahead-alert banner: what shows, for how long, what waits, and every timer.
// Nothing else sets a banner timer, so nothing can leak one.
//
//   one at a time   the due alert with the best tier, then the nearest
//   shows           7 s (6 s minor features), then slides away (220 ms); the next one comes in
//                   400 ms after it has fully left
//   passes          the driver passing the spot slides it away at once (a driver report keeps
//                   its Still there / Not there buttons until 30 m past)
//   replaced        a higher-tier alert slides the current one away early and takes its place;
//                   the replaced one is not shown again unless it's critical
//   reminder        critical alerts once more at ~150 m, for 4 s; nothing else repeats
//   tap / swipe     tap pauses (tap again resumes); swipe sends it away for good
//   manoeuvre       nothing new starts during a manoeuvre close-up unless critical within 200 m
//   reset           reroute, background, end of navigation and unmount clear every timer
//
// Time comes from an injected scheduler, so the tests drive it with fake timers and can assert
// that no timer is left running (activeTimers()). Tested in __tests__/nav/aheadBanner.test.ts.
import type { AheadAlert } from "@/nav/ahead/aheadFeed";
import {
  CRITICAL_DURING_MANOEUVRE_M,
  ENTER_MS,
  LEAVE_MS,
  PASSED_M,
  QUEUE_GAP_MS,
  REMINDER_AT_M,
  bannerMs,
  warnDistanceM,
} from "@/nav/ahead/aheadTiming";

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type BannerPhase = "entering" | "shown" | "leaving";

export interface BannerState {
  alert: AheadAlert | null;
  /** Live distance to it (m); negative once passed. */
  aheadM: number;
  reminder: boolean;
  phase: BannerPhase | null;
  paused: boolean;
  /** Changes every time a different banner starts (for the view's key). */
  seq: number;
}

export interface BannerUpdate {
  feed: readonly AheadAlert[];
  carAlongM: number;
  speedMps: number;
  /** A manoeuvre close-up / lane guidance is on screen. */
  manoeuvreBusy: boolean;
}

export type ResetReason = "reroute" | "background" | "end" | "unmount";

const EMPTY: BannerState = { alert: null, aheadM: 0, reminder: false, phase: null, paused: false, seq: 0 };

export class AheadBannerController {
  private timers = new Map<string, unknown>();
  private state: BannerState = EMPTY;
  private holdStartedAt = 0;
  private holdLeftMs = 0;
  private shown = new Set<string>();
  private reminded = new Set<string>();
  private dismissed = new Set<string>();
  private last: BannerUpdate = { feed: [], carAlongM: 0, speedMps: 0, manoeuvreBusy: false };
  private listeners = new Set<(s: BannerState) => void>();
  private disposed = false;
  private seq = 0;

  constructor(
    private scheduler: Scheduler,
    private now: () => number,
    private hooks: { onShow?: (alert: AheadAlert, reminder: boolean) => void } = {}
  ) {}

  getState = (): BannerState => this.state;

  /** What to do when a banner appears (speak, chime); replaceable at any time. */
  setOnShow(fn: (alert: AheadAlert, reminder: boolean) => void): void {
    this.hooks = { ...this.hooks, onShow: fn };
  }

  subscribe = (listener: (s: BannerState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** How many timers are running (0 after any reset). */
  activeTimers(): number {
    return this.timers.size;
  }

  update(input: BannerUpdate): void {
    if (this.disposed) return;
    this.last = input;
    const cur = this.state.alert;
    if (cur) {
      const aheadM = cur.alongM - input.carAlongM;
      const passedBy = cur.source === "community" ? -PASSED_M : 0;
      if (aheadM < passedBy && this.state.phase !== "leaving") {
        this.set({ ...this.state, aheadM });
        this.leave(false);
      } else if (aheadM !== this.state.aheadM) {
        this.set({ ...this.state, aheadM });
      }
      // A more important alert takes the current one's place.
      if (this.state.phase !== "leaving" && this.state.alert) {
        const better = this.due().find((c) => c.alert.tier < this.state.alert!.tier);
        if (better) {
          if (this.state.alert.critical && !this.state.reminder) this.shown.delete(this.state.alert.key);
          this.leave(true);
        }
      }
    }
    this.pump();
  }

  /** Tap: pause (stays open) or resume. */
  tap(): void {
    if (this.disposed || !this.state.alert || this.state.phase === "leaving") return;
    if (this.state.paused) {
      this.after("hold", Math.max(0, this.holdLeftMs), () => this.leave(false));
      this.holdStartedAt = this.now();
      this.set({ ...this.state, paused: false });
    } else {
      this.holdLeftMs -= this.now() - this.holdStartedAt;
      this.clear("hold");
      this.set({ ...this.state, paused: true });
    }
  }

  /** Swipe down: away now, and this alert never comes back (no reminder either). */
  swipe(): void {
    if (this.disposed || !this.state.alert || this.state.phase === "leaving") return;
    this.dismissed.add(this.state.alert.key);
    this.leave(false);
  }

  /**
   * Clears every timer and the banner. A reroute or trip to the background keeps the memory of
   * what was shown (max one banner per alert); ending the drive or unmounting forgets it all.
   */
  reset(reason: ResetReason): void {
    for (const h of this.timers.values()) this.scheduler.clearTimeout(h);
    this.timers.clear();
    if (reason === "end" || reason === "unmount") {
      this.shown.clear();
      this.reminded.clear();
      this.dismissed.clear();
      this.last = { feed: [], carAlongM: 0, speedMps: 0, manoeuvreBusy: false };
    }
    if (reason === "unmount") {
      this.disposed = true;
      this.listeners.clear();
      this.state = EMPTY;
      return;
    }
    this.set(EMPTY);
  }

  // ---- internals ----------------------------------------------------------------------------

  /** Alerts that want a banner now, best first. */
  private due(): { alert: AheadAlert; reminder: boolean }[] {
    const { feed, carAlongM, speedMps, manoeuvreBusy } = this.last;
    const out: { alert: AheadAlert; reminder: boolean }[] = [];
    for (const a of feed) {
      const aheadM = a.alongM - carAlongM;
      if (aheadM <= 0 || this.dismissed.has(a.key)) continue;
      if (this.state.alert?.key === a.key) continue;
      let reminder = false;
      if (!this.shown.has(a.key)) {
        if (aheadM > warnDistanceM(a, speedMps)) continue;
      } else if (a.critical && !this.reminded.has(a.key) && aheadM <= REMINDER_AT_M) {
        reminder = true;
      } else continue;
      if (manoeuvreBusy && !(a.critical && aheadM <= CRITICAL_DURING_MANOEUVRE_M)) continue;
      out.push({ alert: { ...a, aheadM }, reminder });
    }
    return out.sort((x, y) => x.alert.tier - y.alert.tier || x.alert.aheadM - y.alert.aheadM);
  }

  private pump(): void {
    if (this.disposed || this.state.alert || this.timers.has("leave") || this.timers.has("gap")) return;
    const next = this.due()[0];
    if (next) this.show(next.alert, next.reminder);
  }

  private show(alert: AheadAlert, reminder: boolean): void {
    (reminder ? this.reminded : this.shown).add(alert.key);
    this.seq += 1;
    this.set({ alert, aheadM: alert.aheadM, reminder, phase: "entering", paused: false, seq: this.seq });
    this.after("enter", ENTER_MS, () => this.state.phase === "entering" && this.set({ ...this.state, phase: "shown" }));
    this.holdLeftMs = bannerMs(alert, reminder);
    this.holdStartedAt = this.now();
    this.after("hold", this.holdLeftMs, () => this.leave(false));
    try {
      this.hooks.onShow?.(alert, reminder);
    } catch {
      // A failing voice/chime must never take the banner down with it.
    }
  }

  /** Slide away; `immediate` (a replacement) skips the 400 ms gap before the next one. */
  private leave(immediate: boolean): void {
    if (!this.state.alert || this.state.phase === "leaving") return;
    this.clear("hold");
    this.clear("enter");
    this.set({ ...this.state, phase: "leaving", paused: false });
    this.after("leave", LEAVE_MS, () => {
      this.set({ ...EMPTY, seq: this.seq });
      if (immediate) this.pump();
      else this.after("gap", QUEUE_GAP_MS, () => this.pump());
    });
  }

  private after(name: string, ms: number, fn: () => void): void {
    this.clear(name);
    const handle = this.scheduler.setTimeout(() => {
      this.timers.delete(name);
      if (!this.disposed) fn();
    }, ms);
    this.timers.set(name, handle);
  }

  private clear(name: string): void {
    const h = this.timers.get(name);
    if (h !== undefined) {
      this.scheduler.clearTimeout(h);
      this.timers.delete(name);
    }
  }

  private set(next: BannerState): void {
    this.state = next;
    for (const l of this.listeners) l(next);
  }
}
