// One permission at a time. Every system permission prompt in the app (location, notifications,
// microphone, speech, camera, photos, contacts, calendar, tracking) is asked through here, so:
//
//   * two prompts are never on screen at once, and never asked in the same moment (iOS drops
//     the tracking prompt outright if it's asked while another alert is up -- it just returns
//     "not determined" -- and stacks the rest);
//   * at start-up they come in a sensible order -- location first (the map needs it), tracking
//     last -- whatever order the screens happen to ask in;
//   * a short pause separates one prompt from the next, so they arrive one by one, smoothly;
//   * nothing is asked while a full-screen card the driver must read (updated terms, What's new,
//     an announcement) is up: those cards "hold" the queue until they close;
//   * the voice doesn't talk while a prompt is on screen (navSpeech waits), and the start-up ad
//     never shows over or straight after a prompt (AppOpenAdManager waits).
//
// A permission that's already been answered never waits: the OS shows nothing for it, so it
// skips the queue (no start-up delay for a returning driver).
//
// Pure core (PromptQueue, tested with a fake clock in __tests__/permissions/permissionQueue.test.ts)
// plus the app-wide instance bound to React Native's AppState.
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

export type PermissionKind = "location" | "notifications" | "microphone" | "speech" | "camera" | "photos" | "contacts" | "calendar" | "tracking";

/** The order prompts are shown in when several are waiting. Tracking always last. */
export const PERMISSION_ORDER: readonly PermissionKind[] = ["location", "notifications", "microphone", "speech", "camera", "photos", "contacts", "calendar", "tracking"];
/** At start-up, asks arriving within this window are put in order before the first is shown. */
export const COLLECT_MS = 400;
/** The pause after one prompt (or a held card) closes before the next prompt appears. */
export const PROMPT_GAP_MS = 800;

export interface QueueDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** The app is in front and active (a prompt shown in the background would be lost). */
  isActive(): boolean;
  /** Resolves once the app is active again. */
  whenActive(): Promise<void>;
}

export interface AskOptions {
  /** Resolves true if this permission was already answered (no prompt will appear). */
  decided?: () => Promise<boolean>;
}

interface Job {
  kind: PermissionKind;
  seq: number;
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export interface QueueSnapshot {
  /** A system prompt is on screen right now. */
  open: PermissionKind | null;
  /** Prompts waiting their turn. */
  waiting: PermissionKind[];
  /** Full-screen cards holding the queue. */
  holds: number;
}

export class PromptQueue {
  private jobs: Job[] = [];
  private inflight = new Map<PermissionKind, Promise<unknown>>();
  private running: Job | null = null;
  private holds = new Set<symbol>();
  private lastClosedAt = Number.NEGATIVE_INFINITY;
  private listeners = new Set<() => void>();
  private changeWaiters: (() => void)[] = [];
  private pumping = false;
  private seq = 0;
  private snap: QueueSnapshot = { open: null, waiting: [], holds: 0 };
  /** Every prompt shown, in order (diagnostics + tests). */
  readonly history: { kind: PermissionKind; at: number; closedAt?: number }[] = [];

  constructor(private deps: QueueDeps) {}

  /** Runs `request` (the call that shows the system prompt) when it's this prompt's turn. */
  ask<T>(kind: PermissionKind, request: () => Promise<T>, options: AskOptions = {}): Promise<T> {
    const existing = this.inflight.get(kind);
    if (existing) return existing as Promise<T>; // the same prompt asked twice: one prompt, one answer
    const p = (async () => {
      if (options.decided) {
        const decided = await options.decided().catch(() => false);
        if (decided) return request();
      }
      return new Promise<T>((resolve, reject) => {
        this.jobs.push({ kind, seq: this.seq++, run: request, resolve: resolve as (v: unknown) => void, reject });
        this.emit();
        void this.pump();
      });
    })();
    this.inflight.set(kind, p);
    const clear = () => {
      if (this.inflight.get(kind) === p) this.inflight.delete(kind);
    };
    p.then(clear, clear);
    return p;
  }

  /** A full-screen card is up: no prompt until the returned release() is called. */
  hold(): () => void {
    const token = Symbol("hold");
    this.holds.add(token);
    this.emit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds.delete(token);
      this.lastClosedAt = this.deps.now();
      this.emit();
      void this.pump();
    };
  }

  promptOpen(): boolean {
    return this.running !== null;
  }

  /** Something is on screen or about to be: a prompt open or waiting, a card holding, or the pause after one. */
  busy(): boolean {
    return this.running !== null || this.jobs.length > 0 || this.holds.size > 0 || this.deps.now() < this.lastClosedAt + PROMPT_GAP_MS;
  }

  /** Prompts are open or waiting (cards don't count). */
  promptsPending(): boolean {
    return this.running !== null || this.jobs.length > 0;
  }

  snapshot(): QueueSnapshot {
    return this.snap;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolves once no prompt is open. */
  async whenNoPromptOpen(): Promise<void> {
    while (this.running) await this.changed();
  }

  /** Resolves once nothing is open, waiting or holding, and the pause after the last one has passed. */
  async whenIdle(): Promise<void> {
    for (;;) {
      if (this.running || this.jobs.length > 0 || this.holds.size > 0) {
        await this.changed();
        continue;
      }
      const wait = this.lastClosedAt + PROMPT_GAP_MS - this.deps.now();
      if (wait > 0) {
        await this.deps.sleep(wait);
        continue;
      }
      return;
    }
  }

  private changed(): Promise<void> {
    return new Promise((resolve) => this.changeWaiters.push(resolve));
  }

  private emit(): void {
    this.snap = { open: this.running?.kind ?? null, waiting: this.jobs.map((j) => j.kind), holds: this.holds.size };
    const waiters = this.changeWaiters;
    this.changeWaiters = [];
    waiters.forEach((w) => w());
    this.listeners.forEach((l) => l());
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      // Let asks made in the same moment (start-up) arrive, so they're shown in order.
      await this.deps.sleep(COLLECT_MS);
      while (this.jobs.length > 0) {
        if (this.holds.size > 0) {
          await this.changed();
          continue;
        }
        if (!this.deps.isActive()) {
          await this.deps.whenActive();
          continue;
        }
        const wait = this.lastClosedAt + PROMPT_GAP_MS - this.deps.now();
        if (wait > 0) {
          await this.deps.sleep(wait);
          continue;
        }
        this.jobs.sort((a, b) => PERMISSION_ORDER.indexOf(a.kind) - PERMISSION_ORDER.indexOf(b.kind) || a.seq - b.seq);
        const job = this.jobs.shift()!;
        this.running = job;
        const entry: { kind: PermissionKind; at: number; closedAt?: number } = { kind: job.kind, at: this.deps.now() };
        this.history.push(entry);
        this.emit();
        try {
          job.resolve(await job.run());
        } catch (e) {
          job.reject(e);
        }
        this.running = null;
        this.lastClosedAt = this.deps.now();
        entry.closedAt = this.lastClosedAt;
        this.emit();
      }
    } finally {
      this.pumping = false;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The app-wide queue.

const appDeps: QueueDeps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  // No AppState (a test environment, or very early start-up): treat the app as in front.
  isActive: () => !AppState || AppState.currentState == null || AppState.currentState === "active",
  whenActive: () =>
    new Promise((resolve) => {
      if (!AppState || AppState.currentState == null || AppState.currentState === "active") return resolve();
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") {
          sub.remove();
          resolve();
        }
      });
    }),
};

export const permissionQueue = new PromptQueue(appDeps);

/** Ask a system permission through the queue (one prompt at a time, in order). */
export function askPermission<T>(kind: PermissionKind, request: () => Promise<T>, options?: AskOptions): Promise<T> {
  return permissionQueue.ask(kind, request, options);
}

export function isPermissionPromptOpen(): boolean {
  return permissionQueue.promptOpen();
}

export function whenPromptsIdle(): Promise<void> {
  return permissionQueue.whenIdle();
}

/** Re-renders with the queue's state (open / waiting prompts, holds). */
export function usePermissionQueue(): QueueSnapshot {
  return useSyncExternalStore(
    (fn) => permissionQueue.subscribe(fn),
    () => permissionQueue.snapshot()
  );
}

/** While `active`, a full-screen card holds every prompt back. */
export function useHoldPrompts(active: boolean): void {
  useEffect(() => (active ? permissionQueue.hold() : undefined), [active]);
}

/** A permission response that won't show a prompt if asked again (granted, or refused for good). */
export function answered(r: { granted?: boolean; status?: string; canAskAgain?: boolean }): boolean {
  return r.granted === true || r.status === "granted" || r.canAskAgain === false;
}
