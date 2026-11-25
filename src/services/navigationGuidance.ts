import { distanceKm } from "@/utils/geo";
import type { RouteStep } from "@/services/directions";

const MANEUVER_TRIGGER_METERS = 200;
// Widened from a fixed 25m -- this app polls GPS every ~2s or every 5m travelled (see
// LocationContext's watchPositionAsync), and at highway speed a couple of fixes that close
// together can still land 30-40m apart. A 25m-only capture window was a real, confirmed way
// for a completed instruction to get stuck on screen instead of clearing: a fast-moving vehicle
// could jump clean over it between two consecutive fixes.
const STEP_COMPLETE_METERS = 35;
// How many steps ahead to check for "already passed this one too, in the same GPS tick" --
// covers several short, closely-spaced maneuvers (e.g. consecutive roundabout exits, as seen in
// this app's own directions list) all being covered between two fixes. Bounded so this stays a
// cheap, constant-time check every tick instead of scanning the whole remaining route.
const SKIP_AHEAD_LIMIT = 4;

// A step that follows this closely after the previous one is announced together with it
// ("turn left, and then turn right") -- the same 150m the instruction card's "Then" chip uses.
const CHAIN_NEXT_STEP_METERS = 150;
// An advance warning is only worth giving if there's still a real gap before the final one.
const EARLY_MIN_GAP_ABOVE_FINAL_METERS = 100;
// ...and only if the driver has had the step for a little while first: without this margin a
// step that starts 820m out would say "in 800 metres" the instant the previous turn finishes.
const EARLY_MIN_LEAD_METERS = 150;

export interface GuidanceState {
  activeStepIndex: number;
  spokenStepIndices: Set<number>;
  /** How far out each step was when guidance first saw it -- decides which advance warning fits. */
  stepEntryMeters: Map<number, number>;
  /** Steps whose advance warning has been given (or deliberately skipped). */
  earlySpokenStepIndices: Set<number>;
  /** Set once "you've arrived" has been reported, so it's only ever said once per route. */
  arrivedAnnounced: boolean;
}

export function createGuidanceState(): GuidanceState {
  return {
    activeStepIndex: 0,
    spokenStepIndices: new Set(),
    stepEntryMeters: new Map(),
    earlySpokenStepIndices: new Set(),
    arrivedAnnounced: false,
  };
}

export interface GuidanceAnnouncement {
  step: RouteStep;
  stepIndex: number;
  kind: "early" | "final";
  /** Road distance left to the manoeuvre. */
  distanceMeters: number;
  /** The following step, when it comes up within CHAIN_NEXT_STEP_METERS of this one. */
  thenStep: RouteStep | null;
  isLastStep: boolean;
}

/**
 * Distance still to drive along this step's own road geometry -- not the straight line to its
 * end, which on a curving road or a long ramp can be far shorter than what's actually left.
 * Used for "in 1 kilometre"-style warnings, where that difference is audible.
 */
export function remainingStepMeters(step: RouteStep, userLat: number, userLng: number): number {
  const line = step.polyline;
  if (!line || line.length < 2) return distanceToStepEndMeters(step, userLat, userLng);

  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((userLat * Math.PI) / 180);
  const px = userLng * metersPerDegLon;
  const py = userLat * metersPerDegLat;

  // Closest point on the line, and how much of the line lies beyond it.
  let bestDist = Infinity;
  let bestRemaining = 0;
  let remainingAfterSegment = 0;
  for (let i = line.length - 2; i >= 0; i--) {
    const ax = line[i].longitude * metersPerDegLon;
    const ay = line[i].latitude * metersPerDegLat;
    const bx = line[i + 1].longitude * metersPerDegLon;
    const by = line[i + 1].latitude * metersPerDegLat;
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSq = abx * abx + aby * aby;
    const length = Math.sqrt(lengthSq);
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq)) : 0;
    const dist = Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
    if (dist < bestDist) {
      bestDist = dist;
      bestRemaining = remainingAfterSegment + (1 - t) * length;
    }
    remainingAfterSegment += length;
  }
  return bestRemaining;
}

/** The longest advance-warning distance that suits a step first seen `entryMeters` out. */
export function earlyThresholdFor(entryMeters: number, thresholds: number[]): number | null {
  for (const threshold of thresholds) {
    if (threshold <= entryMeters - EARLY_MIN_LEAD_METERS) return threshold;
  }
  return null;
}

function distanceToStepEndMeters(step: RouteStep, userLat: number, userLng: number): number {
  return distanceKm(userLat, userLng, step.endLocation.latitude, step.endLocation.longitude) * 1000;
}

/**
 * Advances guidance against the user's live position. Returns the step to speak (if any)
 * this tick, and whether the active step index changed (route progressed to next maneuver).
 */
export function evaluateGuidance(
  state: GuidanceState,
  steps: RouteStep[],
  userLat: number,
  userLng: number,
  // Advance-warning distances, longest first (navSpeechPlan's earlyAnnouncementThresholds).
  // Leaving this out gives exactly the old behaviour: one call-out per step, 200m before it.
  earlyThresholds: number[] = [],
  // From the route matcher (nav/routeMatcher.ts): which step's road the car is on and how far
  // along the road its manoeuvre still is. With it, a step is done when the car has actually
  // driven past its manoeuvre -- not when it's within 35 m of it in a straight line, which on a
  // U-shaped car-park exit, a roundabout or a cloverleaf is true from the wrong side too.
  match?: { stepIndex: number; metersToStepEnd: number } | null
): {
  stepToSpeak: RouteStep | null;
  activeStepIndex: number;
  announcement: GuidanceAnnouncement | null;
  /** True on exactly one tick: the one where the driver reaches the end of the route. */
  arrived: boolean;
} {
  if (state.activeStepIndex >= steps.length) {
    return { stepToSpeak: null, activeStepIndex: state.activeStepIndex, announcement: null, arrived: false };
  }

  if (match && match.stepIndex > state.activeStepIndex) {
    // Driven past one or more manoeuvres since the last fix: nothing left to say about those.
    for (let i = state.activeStepIndex; i < match.stepIndex; i++) state.spokenStepIndices.add(i);
    state.activeStepIndex = Math.min(match.stepIndex, steps.length - 1);
  }
  const stepIndex = state.activeStepIndex;
  const currentStep = steps[stepIndex];
  const matched = match && match.stepIndex === stepIndex;
  const distMeters = matched ? match.metersToStepEnd : distanceToStepEndMeters(currentStep, userLat, userLng);
  const isLastStep = stepIndex === steps.length - 1;
  const followingStep = isLastStep ? null : steps[stepIndex + 1];
  const thenStep = followingStep && followingStep.distanceMeters < CHAIN_NEXT_STEP_METERS ? followingStep : null;

  let stepToSpeak: RouteStep | null = null;
  let announcement: GuidanceAnnouncement | null = null;

  if (!state.spokenStepIndices.has(stepIndex) && distMeters <= MANEUVER_TRIGGER_METERS) {
    stepToSpeak = currentStep;
    state.spokenStepIndices.add(stepIndex);
    // Once the final call-out has gone, a late advance warning would only be confusing.
    state.earlySpokenStepIndices.add(stepIndex);
    announcement = {
      step: currentStep,
      stepIndex,
      kind: "final",
      distanceMeters: matched ? distMeters : Math.min(distMeters, remainingStepMeters(currentStep, userLat, userLng)),
      thenStep,
      isLastStep,
    };
  } else if (
    earlyThresholds.length > 0 &&
    !state.spokenStepIndices.has(stepIndex) &&
    !state.earlySpokenStepIndices.has(stepIndex)
  ) {
    const remaining = matched ? distMeters : remainingStepMeters(currentStep, userLat, userLng);
    if (!state.stepEntryMeters.has(stepIndex)) state.stepEntryMeters.set(stepIndex, remaining);
    const threshold = earlyThresholdFor(state.stepEntryMeters.get(stepIndex)!, earlyThresholds);
    if (threshold === null) {
      // Too short a step for any advance warning -- the final call-out is all it gets.
      state.earlySpokenStepIndices.add(stepIndex);
    } else if (remaining <= threshold) {
      state.earlySpokenStepIndices.add(stepIndex);
      // A GPS gap can carry the driver from beyond the threshold to almost on top of the turn
      // in one fix; announcing "in 800 metres" there would be wrong, so it's skipped instead.
      if (remaining > MANEUVER_TRIGGER_METERS + EARLY_MIN_GAP_ABOVE_FINAL_METERS) {
        announcement = { step: currentStep, stepIndex, kind: "early", distanceMeters: remaining, thenStep: null, isLastStep };
      }
    }
  }

  // Consider the maneuver complete once the user is very close to (or has passed) the
  // step's end point, then advance to the next step. With the route matcher, the step moves on
  // only once the car has actually driven past it (the match at the top of the next fix).
  if (matched) {
    // nothing: progress decides
  } else if (distMeters <= STEP_COMPLETE_METERS) {
    if (state.activeStepIndex < steps.length - 1) state.activeStepIndex += 1;
  } else {
    // GPS-jump case: this fix isn't close to the *current* step's end, but check whether it
    // already landed past one or more of the next few steps too -- see SKIP_AHEAD_LIMIT above.
    for (let ahead = 1; ahead <= SKIP_AHEAD_LIMIT && state.activeStepIndex + ahead < steps.length; ahead++) {
      const aheadIndex = state.activeStepIndex + ahead;
      if (distanceToStepEndMeters(steps[aheadIndex], userLat, userLng) <= STEP_COMPLETE_METERS) {
        // Every step from the old activeStepIndex through aheadIndex is now behind the
        // vehicle -- nothing left to announce for a maneuver already passed, so mark them
        // spoken and jump straight past all of them.
        for (let i = state.activeStepIndex; i <= aheadIndex; i++) state.spokenStepIndices.add(i);
        state.activeStepIndex = Math.min(aheadIndex + 1, steps.length - 1);
        break;
      }
    }
  }

  // Arrival: on the last step and within the same distance that counts any step as complete.
  // Checked against the step that was current when this tick began, so it can't fire on the
  // tick that merely advances INTO the last step.
  let arrived = false;
  if (isLastStep && !state.arrivedAnnounced && distMeters <= STEP_COMPLETE_METERS) {
    state.arrivedAnnounced = true;
    arrived = true;
    // "Your destination is on the left" and "you've arrived" in the same breath would just be
    // the second cutting off the first -- arriving wins.
    announcement = null;
    stepToSpeak = null;
    state.spokenStepIndices.add(stepIndex);
  }

  return { stepToSpeak, activeStepIndex: state.activeStepIndex, announcement, arrived };
}

/**
 * What guidance is expected to say for one step, worked out ahead of time from the route alone.
 * Used to fetch a character voice's clips before they're needed -- so it has to apply exactly
 * the same rules as evaluateGuidance above (which advance warning, whether the next step is
 * chained on), or the fetched sentences won't be the ones actually spoken.
 */
export function expectedAnnouncements(
  steps: RouteStep[],
  stepIndex: number,
  earlyThresholds: number[]
): GuidanceAnnouncement[] {
  const step = steps[stepIndex];
  if (!step) return [];
  const isLastStep = stepIndex === steps.length - 1;
  const followingStep = isLastStep ? null : steps[stepIndex + 1];
  const thenStep = followingStep && followingStep.distanceMeters < CHAIN_NEXT_STEP_METERS ? followingStep : null;
  const expected: GuidanceAnnouncement[] = [
    { step, stepIndex, kind: "final", distanceMeters: MANEUVER_TRIGGER_METERS, thenStep, isLastStep },
  ];
  const threshold = earlyThresholdFor(step.distanceMeters, earlyThresholds);
  if (threshold !== null) {
    expected.push({ step, stepIndex, kind: "early", distanceMeters: threshold, thenStep: null, isLastStep });
  }
  return expected;
}
