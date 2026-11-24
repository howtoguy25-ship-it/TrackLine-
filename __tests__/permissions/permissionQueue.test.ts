// Permissions one by one (bug: at a cold start location, tracking and notifications were all
// asked in the same moment -- LocationContext, the ads start-up and sign-in each asked on their
// own -- so prompts stacked, iOS dropped the tracking prompt, the start-up ad could pop up
// straight after a prompt was answered, and the voice could talk over a prompt).
import { readFileSync } from "fs";
import { describe, expect, it } from "@jest/globals";
import { COLLECT_MS, PERMISSION_ORDER, PROMPT_GAP_MS, PromptQueue, answered, type PermissionKind } from "@/services/permissionQueue";

/** A fake clock: sleep() resolves when the test advances time. */
function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void }[] = [];
  let active = true;
  let activeWaiters: (() => void)[] = [];
  const deps = {
    now: () => now,
    sleep: (ms: number) => new Promise<void>((resolve) => timers.push({ at: now + ms, fn: resolve })),
    isActive: () => active,
    whenActive: () => new Promise<void>((resolve) => (active ? resolve() : activeWaiters.push(resolve))),
  };
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    deps,
    flush,
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        await flush();
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers = timers.slice(1);
        now = next.at;
        next.fn();
      }
      now = end;
      await flush();
    },
    setActive(v: boolean) {
      active = v;
      if (v) {
        activeWaiters.forEach((w) => w());
        activeWaiters = [];
      }
    },
  };
}

/** A prompt the "driver" answers when the test says so. */
function prompt(log: string[], kind: string) {
  let answer!: (v: { granted: boolean }) => void;
  const shown = { value: false };
  const request = () => {
    log.push(`show ${kind}`);
    shown.value = true;
    return new Promise<{ granted: boolean }>((resolve) => (answer = resolve));
  };
  return { request, shown, answer: (granted = true) => answer({ granted }) };
}

describe("one prompt at a time", () => {
  it("start-up: asks made together are shown one by one, location first, tracking last", async () => {
    const c = fakeClock();
    const q = new PromptQueue(c.deps);
    const log: string[] = [];
    const tracking = prompt(log, "tracking");
    const notif = prompt(log, "notifications");
    const loc = prompt(log, "location");
    // The order the app happened to ask in at a cold start: ads first, then sign-in, then the map.
    q.ask("tracking", tracking.request);
    q.ask("notifications", notif.request);
    q.ask("location", loc.request);
    await c.advance(COLLECT_MS);
    expect(log).toEqual(["show location"]);
    expect(q.snapshot().open).toBe("location");
    expect(q.snapshot().waiting).toEqual(expect.arrayContaining(["tracking", "notifications"]));

    loc.answer();
    await c.advance(PROMPT_GAP_MS - 1);
    expect(log).toEqual(["show location"]); // the pause between prompts
    await c.advance(1);
    expect(log).toEqual(["show location", "show notifications"]);
    notif.answer(false);
    await c.advance(PROMPT_GAP_MS);
    expect(log).toEqual(["show location", "show notifications", "show tracking"]);
    tracking.answer();
    await c.advance(PROMPT_GAP_MS);
    expect(q.busy()).toBe(false);
    // Never two open at once: each closed before the next opened, with the gap between.
    for (let i = 1; i < q.history.length; i++) {
      expect(q.history[i].at - q.history[i - 1].closedAt!).toBeGreaterThanOrEqual(PROMPT_GAP_MS);
    }
  });

  it("the same permission asked twice (map + speedometer both want location) shows one prompt", async () => {
    const c = fakeClock();
    const q = new PromptQueue(c.deps);
    const log: string[] = [];
    const loc = prompt(log, "location");
    const a = q.ask("location", loc.request);
    const b = q.ask("location", loc.request);
    await c.advance(COLLECT_MS);
    loc.answer(true);
    expect(await a).toEqual({ granted: true });
    expect(await b).toEqual({ granted: true });
    expect(log).toEqual(["show location"]);
  });

  it("an already answered permission doesn't wait (no prompt will appear)", async () => {
    const c = fakeClock();
    const q = new PromptQueue(c.deps);
    const log: string[] = [];
    const notif = prompt(log, "notifications");
    q.ask("notifications", notif.request);
    await c.advance(COLLECT_MS);
    let got: unknown = null;
    q.ask("location", async () => ({ granted: true }), { decided: async () => true }).then((r) => (got = r));
    await c.flush();
    expect(got).toEqual({ granted: true }); // straight through, while notifications is still open
  });

  it("a full-screen card holds every prompt until it closes, then the pause, then the prompt", async () => {
    const c = fakeClock();
    const q = new PromptQueue(c.deps);
    const log: string[] = [];
    const release = q.hold();
    const loc = prompt(log, "location");
    q.ask("location", loc.request);
    await c.advance(5000);
    expect(log).toEqual([]);
    release();
    await c.advance(PROMPT_GAP_MS - 1);
    expect(log).toEqual([]);
    await c.advance(1);
    expect(log).toEqual(["show location"]);
  });

  it("never shown while the app isn't in front", async () => {
    const c = fakeClock();
    const q = new PromptQueue(c.deps);
    const log: string[] = [];
    c.setActive(false);
    const mic = prompt(log, "microphone");
    q.ask("microphone", mic.request);
    await c.advance(5000);
    expect(log).toEqual([]);
    c.setActive(true);
    await c.advance(10);
    expect(log).toEqual(["show microphone"]);
  });

  it("whenIdle waits for the last prompt and the pause after it", async () => {
    const c = fakeClock();
    const q = new PromptQueue(c.deps);
    const log: string[] = [];
    const loc = prompt(log, "location");
    q.ask("location", loc.request);
    let idle = false;
    q.whenIdle().then(() => (idle = true));
    await c.advance(COLLECT_MS);
    loc.answer();
    await c.advance(PROMPT_GAP_MS - 1);
    expect(idle).toBe(false);
    await c.advance(1);
    expect(idle).toBe(true);
  });

  it("order covers every kind, tracking last", () => {
    const kinds: PermissionKind[] = ["location", "notifications", "microphone", "speech", "camera", "photos", "contacts", "calendar", "tracking"];
    expect([...PERMISSION_ORDER].sort()).toEqual([...kinds].sort());
    expect(PERMISSION_ORDER[0]).toBe("location");
    expect(PERMISSION_ORDER[PERMISSION_ORDER.length - 1]).toBe("tracking");
    expect(answered({ status: "granted" })).toBe(true);
    expect(answered({ status: "denied", canAskAgain: false })).toBe(true);
    expect(answered({ status: "undetermined", canAskAgain: true })).toBe(false);
  });
});

describe("every prompt in the app goes through the queue", () => {
  const sources = [
    "src/context/LocationContext.tsx",
    "src/hooks/useLiveSpeed.ts",
    "src/services/contactAddresses.ts",
    "src/services/calendarEvents.ts",
    "src/services/voiceSearch.ts",
    "src/services/wakePhrase.ts",
    "src/services/navNotification.ts",
    "src/services/pushNotifications.ts",
    "src/services/sirenDetection.ts",
    "src/services/ads.ts",
    "src/screens/RecordVoiceScreen.tsx",
    "src/screens/PlacePage.tsx",
    "src/screens/VehicleDetectionScreen.tsx",
    "src/screens/DocumentScanScreen.tsx",
    "src/components/LiveVehicleCamera.tsx",
  ];
  it.each(sources)("%s asks through askPermission", (f) => {
    expect(readFileSync(f, "utf8")).toMatch(/askPermission\("/);
  });

  it("no request call anywhere outside the queue", () => {
    const { execSync } = require("child_process") as typeof import("child_process");
    const hits = execSync(
      String.raw`grep -rnE "request[A-Za-z]*Permissions?(Async)?\(|requestCalendarPermissions\(|requestPermission\)" src --include=*.ts --include=*.tsx || true`,
      { encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean)
      // Every remaining call is the request handed to askPermission (same line), or the definition of the queue.
      .filter((l) => !/askPermission\(/.test(l) && !l.startsWith("src/services/permissionQueue.ts"))
      // Not calls: comments and log lines.
      .filter((l) => !/^[^:]+:\d+:\s*(\/\/|\*)/.test(l) && !/Sentry\.logger/.test(l))
      // LocationContext's own "ask again" (it re-runs the queued request above).
      .filter((l) => !/requestLocationPermission\(\)/.test(l));
    expect(hits).toEqual([]);
  });
});

describe("nothing else on top of a prompt", () => {
  it("the voice waits while a prompt is on screen, then says only the newest thing", () => {
    const src = readFileSync("src/services/navSpeech.ts", "utf8");
    expect(src).toMatch(/if \(isPermissionPromptOpen\(\)\) \{/);
    expect(src).toMatch(/permissionQueue\.whenNoPromptOpen\(\)/);
  });
  it("the start-up ad: only on a real return from the background, never over or right after a prompt", () => {
    const src = readFileSync("src/components/AppOpenAdManager.tsx", "utf8");
    expect(src).toMatch(/if \(from === "background"\) evaluateOpen\(\)/);
    expect(src).toMatch(/whenPromptsIdle\(\)/);
    expect(src).toMatch(/if \(permissionQueue\.busy\(\)\) return tryShow\(\)/);
  });
  it("What's new / announcements wait for prompts and hold them; updated terms come first", () => {
    const gates = readFileSync("src/components/AppGates.tsx", "utf8");
    expect(gates).toMatch(/useHoldPrompts\(showWhatsNew \|\| !!ann\)/);
    expect(gates).toMatch(/const promptTurn = /);
    const legal = readFileSync("src/components/LegalGate.tsx", "utf8");
    expect(legal).toMatch(/useHoldPrompts\(visible/);
  });
});
