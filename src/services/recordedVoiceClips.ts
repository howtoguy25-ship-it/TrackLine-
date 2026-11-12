// The fixed list of clips a driver can record. Kept in its own file with no imports, so the
// rules that depend on it (navSpeechPlan.ts) can be checked without a phone -- see
// scripts/test-nav-speech.ts. Storage and upload live in recordedVoices.ts.
//
// Real, explicit request (Waze-style redesign, Phase 3 "Record your own voice"). Every real
// clip the brief lists, grouped into its own 5 real sections -- nothing invented beyond this.
// "Start of drive" also lets the user add custom phrases (see addCustomStartPhrase below).
export interface VoiceClipDef {
  key: string;
  label: string;
}

export interface VoiceClipSection {
  title: string;
  clips: VoiceClipDef[];
}

const ORDINAL_EXITS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

export const VOICE_CLIP_SECTIONS: VoiceClipSection[] = [
  {
    title: "Start of drive",
    clips: [
      { key: "start_all_set", label: "All set. Let's go" },
      { key: "start_were_all_set", label: "We're all set, let's go!" },
    ],
  },
  {
    title: "Distances",
    clips: [
      { key: "dist_200m", label: "In 200 metres" },
      { key: "dist_400m", label: "In 400 metres" },
      { key: "dist_800m", label: "In 800 metres" },
      { key: "dist_1km", label: "In 1 kilometre" },
      { key: "dist_1_5km", label: "In 1.5 kilometres" },
    ],
  },
  {
    title: "Instructions",
    clips: [
      { key: "instr_keep_left", label: "Keep left" },
      { key: "instr_keep_right", label: "Keep right" },
      { key: "instr_turn_left", label: "Turn left" },
      { key: "instr_turn_right", label: "Turn right" },
      { key: "instr_exit_left", label: "Exit left" },
      { key: "instr_exit_right", label: "Exit right" },
      { key: "instr_straight", label: "Go straight on" },
      { key: "instr_uturn", label: "Make a U-turn" },
      { key: "instr_roundabout", label: "At the roundabout" },
      ...ORDINAL_EXITS.map((ordinal, i) => ({
        key: `instr_exit_${i + 1}`,
        label: `Take the ${ordinal} exit`,
      })),
    ],
  },
  {
    title: "Reports",
    clips: [
      { key: "report_police", label: "Police reported" },
      { key: "report_crash", label: "Crash reported" },
      { key: "report_hazard", label: "Hazard reported" },
      { key: "report_heavy_traffic", label: "Heavy traffic reported" },
      { key: "report_red_light_camera", label: "Red light camera reported" },
      { key: "report_speed_camera", label: "Speed camera reported" },
    ],
  },
  {
    title: "Other",
    clips: [
      { key: "other_and_then", label: "And then" },
      { key: "other_rerouting", label: "Re-routing" },
      { key: "other_arrived", label: "You've arrived" },
    ],
  },
];

export function totalClipCount(): number {
  return VOICE_CLIP_SECTIONS.reduce((sum, s) => sum + s.clips.length, 0);
}
