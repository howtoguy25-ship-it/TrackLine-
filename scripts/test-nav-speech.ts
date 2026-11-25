// Real unit checks for the navigation voice's rules -- what gets said, when, and in which
// pieces. Run with:
//   npx tsx scripts/test-nav-speech.ts
// Covers src/services/navSpeechPlan.ts and the announcement side of navigationGuidance.ts.
// Nothing here plays audio: that half (navSpeech.ts) needs a phone.
import {
  RECORDED_VOICE_IDENTIFIER,
  distanceCue,
  earlyAnnouncementThresholds,
  maneuverSegments,
  parseVoiceIdentifier,
  personaVoiceIdentifier,
  planPhrase,
  planStepAnnouncement,
  shouldSpeakPhrase,
  shouldSpeakStep,
} from "../src/services/navSpeechPlan";
import {
  createGuidanceState,
  evaluateGuidance,
  expectedAnnouncements,
  remainingStepMeters,
} from "../src/services/navigationGuidance";
import { VOICE_CLIP_SECTIONS } from "../src/services/recordedVoiceClips";
import { personaLine, allPersonaLines, PERSONA_VOICES } from "../src/services/personaVoices";
import type { RouteStep } from "../src/services/directions";

const assert = {
  ok(value: unknown, message?: string): void {
    if (!value) throw new Error(message ?? "assertion failed");
  },
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
};

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// A straight road heading north from (-33.9, 151.2). 0.001 deg of latitude is ~111.3m.
const M = 1 / 111_320;
function northStep(startMeters: number, lengthMeters: number, extra: Partial<RouteStep> = {}): RouteStep {
  const start = { latitude: -33.9 + startMeters * M, longitude: 151.2 };
  const end = { latitude: -33.9 + (startMeters + lengthMeters) * M, longitude: 151.2 };
  return {
    instruction: "Turn left onto George St",
    maneuver: "turn-left",
    distanceMeters: lengthMeters,
    durationSeconds: lengthMeters / 15,
    startLocation: start,
    endLocation: end,
    polyline: [start, end],
    ...extra,
  };
}
const at = (meters: number) => ({ lat: -33.9 + meters * M, lng: 151.2 });

console.log("voice selection");
check("no identifier -> the phone's default voice", () => {
  const v = parseVoiceIdentifier(null);
  assert.equal(v.kind, "device");
});
check("recorded and character markers are recognised; anything else is a phone voice id", () => {
  assert.equal(parseVoiceIdentifier(RECORDED_VOICE_IDENTIFIER).kind, "recorded");
  const persona = parseVoiceIdentifier(personaVoiceIdentifier("matilda"));
  assert.ok(persona.kind === "persona" && persona.personaId === "matilda");
  const device = parseVoiceIdentifier("com.apple.voice.compact.en-AU.Karen");
  assert.ok(device.kind === "device" && device.identifier === "com.apple.voice.compact.en-AU.Karen");
});

console.log("distance cues");
check("every metric cue is one of the clips a driver can actually record", () => {
  const recordable = new Set(VOICE_CLIP_SECTIONS.flatMap((s) => s.clips.map((c) => c.key)));
  for (const meters of [200, 400, 800, 1000, 1500]) {
    const cue = distanceCue(meters, "km");
    assert.ok(cue?.clipKey && recordable.has(cue.clipKey), `no recordable clip for ${meters}m`);
  }
});
check("just under a threshold still reads as that threshold", () => {
  assert.equal(distanceCue(960, "km")?.text, "In 1 kilometre");
  assert.equal(distanceCue(185, "km")?.text, "In 200 metres");
});
check("a distance that isn't near any cue says no distance at all, rather than a wrong one", () => {
  assert.equal(distanceCue(90, "km"), null);
  assert.equal(distanceCue(4000, "km"), null);
});
check("miles has spoken cues but no clips (there are none to record)", () => {
  const cue = distanceCue(800, "miles");
  assert.equal(cue?.text, "In half a mile");
  assert.equal(cue?.clipKey, undefined);
});
check("advance-warning thresholds exclude the final 200m cue, longest first", () => {
  assert.equal(earlyAnnouncementThresholds("km").join(","), "1500,1000,800,400");
});

console.log("manoeuvres as clips");
check("every clip a manoeuvre can map to is recordable", () => {
  const recordable = new Set(VOICE_CLIP_SECTIONS.flatMap((s) => s.clips.map((c) => c.key)));
  const maneuvers = [
    "turn-left", "turn-right", "turn-slight-left", "turn-slight-right", "turn-sharp-left", "turn-sharp-right",
    "uturn-left", "uturn-right", "fork-left", "fork-right", "ramp-left", "ramp-right", "straight",
  ] as const;
  for (const maneuver of maneuvers) {
    const segments = maneuverSegments({ instruction: "x", maneuver });
    assert.ok(segments && segments.every((s) => s.clipKey && recordable.has(s.clipKey)), maneuver);
  }
});
check("a roundabout is 'at the roundabout' + the exit Google's sentence names", () => {
  const segments = maneuverSegments({
    instruction: "At the roundabout, take the 3rd exit onto Pitt St",
    maneuver: "roundabout-left",
  });
  assert.equal(segments?.map((s) => s.clipKey).join(","), "instr_roundabout,instr_exit_3");
});
check("no clip for 'merge', a step with no manoeuvre, or a roundabout with no stated exit", () => {
  assert.equal(maneuverSegments({ instruction: "Merge onto M4", maneuver: "merge" }), null);
  assert.equal(maneuverSegments({ instruction: "Head north on George St", maneuver: undefined }), null);
  assert.equal(maneuverSegments({ instruction: "Enter the roundabout", maneuver: "roundabout-right" }), null);
});

console.log("planning a turn");
check("advance warning: distance + instruction, as clips and as one sentence", () => {
  const plan = planStepAnnouncement({ step: northStep(0, 2000), distanceMeters: 990, kind: "early" }, "km");
  assert.equal(plan.fullText, "In 1 kilometre, turn left onto George St");
  assert.equal(plan.segments.map((s) => s.clipKey).join(","), "dist_1km,instr_turn_left");
});
check("final call-out for a phone voice is unchanged: Google's own sentence, no distance in front", () => {
  const plan = planStepAnnouncement({ step: northStep(0, 2000), distanceMeters: 195, kind: "final" }, "km");
  assert.equal(plan.fullText, "Turn left onto George St");
  assert.equal(plan.segments.map((s) => s.clipKey).join(","), "dist_200m,instr_turn_left");
});
check("a closely following turn is chained on with 'and then'", () => {
  const then = northStep(2000, 80, { instruction: "Turn right onto Pitt St.", maneuver: "turn-right" });
  const plan = planStepAnnouncement(
    { step: northStep(0, 2000), distanceMeters: 195, kind: "final", thenStep: then },
    "km"
  );
  assert.equal(plan.fullText, "Turn left onto George St, and then turn right onto Pitt St");
  assert.equal(
    plan.segments.map((s) => s.clipKey).join(","),
    "dist_200m,instr_turn_left,other_and_then,instr_turn_right"
  );
});
check("FALLBACK: a step with no clip keeps its full sentence as a spoken segment", () => {
  const step = northStep(0, 2000, { instruction: "Merge onto M4 Mwy", maneuver: "merge" });
  const plan = planStepAnnouncement({ step, distanceMeters: 800, kind: "early" }, "km");
  assert.equal(plan.segments.length, 2);
  assert.equal(plan.segments[0].clipKey, "dist_800m");
  assert.equal(plan.segments[1].clipKey, undefined);
  assert.equal(plan.segments[1].text, "Merge onto M4 Mwy");
});
check("every segment always carries text, so a missing recording can always be spoken instead", () => {
  const plan = planStepAnnouncement({ step: northStep(0, 2000), distanceMeters: 400, kind: "early" }, "km");
  assert.ok(plan.segments.every((s) => s.text.length > 0));
});

console.log("phrases");
check("start prefers a phrase the driver has actually recorded, including one they added", () => {
  const custom = [{ clipKey: "start_custom_abc", text: "Engines on" }];
  for (let i = 0; i < 10; i++) {
    const plan = planPhrase(
      { kind: "start" },
      { customStartPhrases: custom, recordedKeys: new Set(["start_custom_abc"]), random: () => i / 10 }
    );
    assert.equal(plan.segments[0].clipKey, "start_custom_abc");
  }
});
check("start with nothing recorded still says one of the built-in phrases", () => {
  const plan = planPhrase({ kind: "start" }, { random: () => 0.99 });
  assert.equal(plan.fullText, "We're all set, let's go!");
});
check("each report type has words; the four with a recordable clip name it", () => {
  assert.equal(planPhrase({ kind: "report", alertType: "police" }).segments[0].clipKey, "report_police");
  assert.equal(planPhrase({ kind: "report", alertType: "camera" }).segments[0].clipKey, "report_speed_camera");
  assert.equal(planPhrase({ kind: "report", alertType: "emergency_vehicle" }).segments[0].clipKey, undefined);
  assert.equal(planPhrase({ kind: "report", alertType: "emergency_vehicle" }).fullText, "Emergency vehicle reported");
});

console.log("spoken directions setting");
check("Off: nothing at all", () => {
  assert.ok(!shouldSpeakStep("off", "final", northStep(0, 500), false));
  assert.ok(!shouldSpeakPhrase("off", { kind: "report", alertType: "police" }));
});
check("Only alerts: reports yes; turns, start, re-routing no", () => {
  assert.ok(shouldSpeakPhrase("onlyAlerts", { kind: "report", alertType: "police" }));
  assert.ok(shouldSpeakPhrase("onlyAlerts", { kind: "heavyTraffic" }));
  assert.ok(!shouldSpeakStep("onlyAlerts", "final", northStep(0, 500), false));
  assert.ok(!shouldSpeakPhrase("onlyAlerts", { kind: "rerouting" }));
});
check("Less chatty: real turns and arrival only -- no advance warning, no 'go straight', no opener", () => {
  assert.ok(shouldSpeakStep("lessChatty", "final", northStep(0, 500), false));
  assert.ok(!shouldSpeakStep("lessChatty", "early", northStep(0, 500), false));
  assert.ok(!shouldSpeakStep("lessChatty", "final", northStep(0, 500, { maneuver: "straight" }), false));
  assert.ok(shouldSpeakStep("lessChatty", "final", northStep(0, 500, { maneuver: undefined }), true));
  assert.ok(!shouldSpeakPhrase("lessChatty", { kind: "start" }));
  assert.ok(shouldSpeakPhrase("lessChatty", { kind: "arrived" }));
});

console.log("guidance: when things are announced");
const KM = earlyAnnouncementThresholds("km");
check("road distance follows the road, not the straight line", () => {
  // An L-shaped step: 500m north then 500m east. From the start, the end is ~707m away in a
  // straight line but 1000m by road.
  const start = { latitude: -33.9, longitude: 151.2 };
  const corner = { latitude: -33.9 + 500 * M, longitude: 151.2 };
  const end = { latitude: corner.latitude, longitude: 151.2 + (500 * M) / Math.cos((-33.9 * Math.PI) / 180) };
  const step = northStep(0, 1000, { polyline: [start, corner, end], endLocation: end });
  const remaining = remainingStepMeters(step, start.latitude, start.longitude);
  assert.ok(Math.abs(remaining - 1000) < 5, `expected ~1000, got ${remaining}`);
});
check("a long step gets one advance warning at 1.5km, then the final one at 200m", () => {
  const steps = [northStep(0, 5000), northStep(5000, 3000)];
  const state = createGuidanceState();
  const said: string[] = [];
  for (let m = 0; m <= 4990; m += 25) {
    const { announcement } = evaluateGuidance(state, steps, at(m).lat, at(m).lng, KM);
    if (announcement) said.push(`${announcement.kind}@${Math.round(announcement.distanceMeters / 100) * 100}`);
  }
  assert.equal(said.join(" "), "early@1500 final@200");
});
check("a step first seen 1km out warns at 800m -- never 'in 1 kilometre' the instant it begins", () => {
  const steps = [northStep(0, 1000), northStep(1000, 3000)];
  const state = createGuidanceState();
  const first = evaluateGuidance(state, steps, at(0).lat, at(0).lng, KM);
  assert.equal(first.announcement, null);
  let early: number | null = null;
  for (let m = 0; m <= 700; m += 20) {
    const { announcement } = evaluateGuidance(state, steps, at(m).lat, at(m).lng, KM);
    if (announcement?.kind === "early" && early === null) early = announcement.distanceMeters;
  }
  assert.ok(early !== null && early <= 800 && early > 760, `early at ${early}`);
});
check("a short step (300m) gets no advance warning, only the final call-out", () => {
  const steps = [northStep(0, 300), northStep(300, 3000)];
  const state = createGuidanceState();
  const kinds: string[] = [];
  for (let m = 0; m <= 280; m += 10) {
    const { announcement } = evaluateGuidance(state, steps, at(m).lat, at(m).lng, KM);
    if (announcement) kinds.push(announcement.kind);
  }
  assert.equal(kinds.join(","), "final");
});
check("without thresholds (Less chatty) there is never an advance warning", () => {
  const steps = [northStep(0, 5000), northStep(5000, 3000)];
  const state = createGuidanceState();
  const kinds: string[] = [];
  for (let m = 0; m <= 4990; m += 25) {
    const { announcement } = evaluateGuidance(state, steps, at(m).lat, at(m).lng);
    if (announcement) kinds.push(announcement.kind);
  }
  assert.equal(kinds.join(","), "final");
});
check("a GPS gap that jumps past the warning point skips it instead of saying a stale distance", () => {
  const steps = [northStep(0, 5000), northStep(5000, 3000)];
  const state = createGuidanceState();
  evaluateGuidance(state, steps, at(0).lat, at(0).lng, KM);
  const jumped = evaluateGuidance(state, steps, at(4750).lat, at(4750).lng, KM); // 250m to go
  assert.equal(jumped.announcement, null);
  const final = evaluateGuidance(state, steps, at(4810).lat, at(4810).lng, KM);
  assert.equal(final.announcement?.kind, "final");
});
check("the next step is chained only when it follows within 150m", () => {
  const close = [northStep(0, 1000), northStep(1000, 100), northStep(1100, 2000)];
  const s1 = createGuidanceState();
  const a = evaluateGuidance(s1, close, at(850).lat, at(850).lng, KM).announcement;
  assert.ok(a?.kind === "final" && a.thenStep === close[1]);
  const far = [northStep(0, 1000), northStep(1000, 400)];
  const s2 = createGuidanceState();
  const b = evaluateGuidance(s2, far, at(850).lat, at(850).lng, KM).announcement;
  assert.ok(b?.kind === "final" && b.thenStep === null);
});
check("'arrived' fires exactly once, at the end of the last step, and not when merely entering it", () => {
  const steps = [northStep(0, 500), northStep(500, 500, { instruction: "Your destination is on the left", maneuver: undefined })];
  const state = createGuidanceState();
  let arrivals = 0;
  let arrivedAt = -1;
  for (let m = 0; m <= 1000; m += 10) {
    const { arrived } = evaluateGuidance(state, steps, at(m).lat, at(m).lng, KM);
    if (arrived) {
      arrivals++;
      arrivedAt = m;
    }
  }
  assert.equal(arrivals, 1);
  assert.ok(arrivedAt >= 960, `arrived at ${arrivedAt}m of 1000`);
});
check("what's pre-fetched for a character voice is exactly what guidance then says", () => {
  const steps = [northStep(0, 5000), northStep(5000, 100, { instruction: "Turn right onto Pitt St", maneuver: "turn-right" }), northStep(5100, 900)];
  const expected = new Set(
    expectedAnnouncements(steps, 0, KM).map((a) => planStepAnnouncement(a, "km").fullText)
  );
  const state = createGuidanceState();
  const spoken: string[] = [];
  for (let m = 0; m <= 4990; m += 25) {
    const { announcement } = evaluateGuidance(state, steps, at(m).lat, at(m).lng, KM);
    if (announcement) spoken.push(planStepAnnouncement(announcement, "km").fullText);
  }
  assert.equal(spoken.length, 2);
  for (const sentence of spoken) assert.ok(expected.has(sentence), `not pre-fetched: "${sentence}"`);
});

console.log("character voices");
check("every character has its own lines for setting off, re-routing, arriving and heavy traffic", () => {
  for (const persona of PERSONA_VOICES) {
    for (const kind of ["start", "rerouting", "arrived", "heavyTraffic"] as const) {
      assert.ok(personaLine(persona.id, { kind }, () => 0), `${persona.id} has no ${kind} line`);
    }
    assert.ok(allPersonaLines(persona.id).length >= 4);
  }
});
check("a report is always said straight, whatever the character", () => {
  assert.equal(personaLine("sarcastic_copilot", { kind: "report", alertType: "police" }), null);
});

console.log(`\n${passed} checks passed`);
