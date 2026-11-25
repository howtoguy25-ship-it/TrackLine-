// Drives a car along a track while navigating a route, through the app's own pipeline
// (src/nav/navPipeline.ts: route matcher -> guidance -> approach machine), one second at a time
// via the shared simulator (src/dev/simulateDrive.ts). With no fix in a second (signal loss),
// the pipeline dead-reckons, exactly as MapScreen does.
import type { Route } from "@/services/directions";
import type { LatLng } from "@/utils/polyline";
import { driveTrack, routeSpeedAt, type GpsNoise, type SimSecond } from "@/dev/simulateDrive";
import { createNavPipeline, navFix, navNoFix, type NavTick } from "@/nav/navPipeline";
import type { ApproachEffect } from "@/nav/approach";
import { INITIAL_REROUTE_TRIGGER, rerouteTrigger, type RerouteReason } from "@/nav/rerouteTrigger";

export interface DriveOutcome {
  confirmed: Set<number>;
  missed: Set<number>;
  effects: { t: number; effect: ApproachEffect }[];
  /** Progress along the route after each second. */
  along: number[];
  /** Active step after each second. */
  steps: number[];
  arrived: boolean;
  ticks: NavTick[];
  /** Reroutes the app would have started (MapScreen runs the same rerouteTrigger). */
  reroutes: { t: number; reason: RerouteReason }[];
}

export function driveNav(
  route: Route,
  track: readonly LatLng[],
  opts: { noise?: GpsNoise; stopAtMiss?: boolean; speedKmh?: number; speedAt?: (p: LatLng) => number; injected?: SimSecond[] } = {}
): DriveOutcome {
  const p = createNavPipeline(route);
  const speedAt = opts.speedAt ?? (opts.speedKmh ? () => opts.speedKmh! : routeSpeedAt(route.steps, 50));
  const out: DriveOutcome = { confirmed: new Set(), missed: new Set(), effects: [], along: [], steps: [], arrived: false, ticks: [], reroutes: [] };
  let trigger = INITIAL_REROUTE_TRIGGER;
  for (const sec of opts.injected ?? driveTrack(track, speedAt, opts.noise)) {
    const tick = sec.fix ? navFix(p, route, sec.fix) : navNoFix(p, route, sec.timeMs);
    if (!tick) continue;
    out.ticks.push(tick);
    out.along.push(tick.match.along);
    out.steps.push(tick.activeStepIndex);
    if (tick.arrived) out.arrived = true;
    for (const effect of tick.effects) {
      out.effects.push({ t: sec.timeMs, effect });
      if (effect.kind === "confirmed") out.confirmed.add(effect.stepIndex);
      if (effect.kind === "missed") out.missed.add(effect.stepIndex);
    }
    const position = sec.fix ? { latitude: sec.fix.latitude, longitude: sec.fix.longitude } : tick.match.snapped;
    const r = rerouteTrigger(trigger, { nowMs: sec.timeMs, match: tick.match, position, missedManoeuvre: tick.effects.some((e) => e.kind === "missed"), judging: p.approach.phase === "approach" });
    trigger = r.state;
    if (r.reason) out.reroutes.push({ t: sec.timeMs, reason: r.reason });
    if (opts.stopAtMiss && (out.missed.size || out.reroutes.length)) break;
  }
  return out;
}
