// Conversational reporting: "Hey TrackLine, crash ahead", "police on the left", "traffic light's
// out", "something on the road in the right lane". The phone's own speech recogniser hears it
// (services/voiceSearch.ts, on-device); this decides what report it is -- type, the exact Settings
// > Reports item, and the lane when said. Rules, on the phone, nothing sent anywhere else to work
// it out (the old remote model endpoint is gone from the project). Anything it isn't sure of is
// null, so the app asks with the report grid instead of guessing. Pure; tested in
// __tests__/gap/voiceReport.test.ts.
import type { AlertType } from "@/types/alert";
import type { ReportItemId } from "@/settings/reportCatalog";
import { baseTypeOf } from "@/settings/reportGrid";

export type Lane = "left" | "middle" | "right" | "shoulder";

export interface VoiceReport {
  type: AlertType;
  item: ReportItemId;
  /** What it is, for the confirmation and the report's note ("Object on road"). */
  label: string;
  lane: Lane | null;
  /** The note saved with the report: the subtype and lane when they add something. */
  note: string | null;
  /** Spoken back: "Crash reported". */
  spoken: string;
}

const RULES: { re: RegExp; type: AlertType; item: ReportItemId; label: string; subtype?: string }[] = [
  { re: /\b(crash|accident|collision|smash|prang|rear[- ]ended)\b/i, type: "crash", item: "crash", label: "Crash" },
  { re: /\btraffic ?lights?\b.*\b(out|broken|not working|down|off|flashing|dead|faulty)\b|\b(broken|faulty|dead)\b.*\btraffic ?lights?\b/i, type: "traffic_light", item: "trafficLights", label: "Traffic light not working" },
  { re: /\b(ambulance|fire ?truck|fire engine|emergency vehicle|sirens?)\b/i, type: "emergency_vehicle", item: "emergencyVehicles", label: "Emergency vehicle" },
  { re: /\b(speed camera|mobile camera|camera van|speed van|radar|speed trap)\b/i, type: "camera", item: "mobilePoliceCamera", label: "Mobile police camera" },
  { re: /\b(police|cops?|highway patrol|booze bus|rbt|breath test(ing)?)\b/i, type: "police", item: "police", label: "Police" },
  { re: /\b(road ?(is )?closed|closure|road block|roadblock)\b/i, type: "hazard", item: "closures", label: "Road closed" },
  { re: /\b(road ?works?|construction|work zone)\b/i, type: "hazard", item: "roadwork", label: "Roadwork" },
  { re: /\b(traffic jam|jam|heavy traffic|stand ?still|bumper to bumper|gridlock|banked up)\b/i, type: "hazard", item: "traffic", label: "Heavy traffic" },
  { re: /\b(broken[- ]?down|break ?down|car on (the )?shoulder|stopped car|stalled)\b/i, type: "hazard", item: "carOnShoulder", label: "Car on shoulder" },
  { re: /\b(kangaroo|roo|animal|dog|cow|horse|wombat|deer)\b/i, type: "hazard", item: "animals", label: "Animal on road" },
  { re: /\b(flood(ing|ed)?|water over the road|water on the road)\b/i, type: "hazard", item: "badWeather", label: "Flooding" },
  { re: /\bpot ?holes?\b/i, type: "hazard", item: "pothole", label: "Pothole" },
  { re: /\b(gravel|loose stones?)\b/i, type: "hazard", item: "looseGravel", label: "Loose gravel" },
  { re: /\btram ?tracks?\b/i, type: "hazard", item: "tramTracks", label: "Tram tracks" },
  { re: /\b(lane (is )?blocked|blocked lane)\b/i, type: "hazard", item: "blockedLane", label: "Lane blocked" },
  { re: /\b(object|debris|something|stuff|tyre|tire|ladder|mattress|box)\b.*\b(on|in)\b.*\b(road|lane|freeway|motorway|highway)\b/i, type: "hazard", item: "otherHazards", label: "Hazard", subtype: "Object on road" },
  { re: /\bhazard\b/i, type: "hazard", item: "otherHazards", label: "Hazard" },
];

const LANES: [RegExp, Lane][] = [
  [/\b(left lane|on the left|left side|left hand lane)\b/i, "left"],
  [/\b(right lane|on the right|right side|right hand lane|fast lane)\b/i, "right"],
  [/\b(middle lane|centre lane|center lane|middle)\b/i, "middle"],
  [/\b(shoulder|emergency lane|breakdown lane)\b/i, "shoulder"],
];

/** Strips "hey trackline", "report a", "there's a" so "Hey TrackLine, report a crash" reads as "crash". */
export function stripPreamble(text: string): string {
  return text
    .trim()
    .replace(/^(hey|hi|ok|okay)[,\s]+track ?line[,.!\s]*/i, "")
    .replace(/^(please\s+)?(report|there'?s|there is|i see|watch out for|careful)\s+(a|an|some)?\s*/i, "")
    .trim();
}

export function parseVoiceReport(text: string): VoiceReport | null {
  const t = stripPreamble(text);
  if (!t) return null;
  // "No crash", "not a crash", "cancel": never a report.
  if (/\b(no|not|cancel|never ?mind)\b/i.test(t) && !/\bnot working\b/i.test(t)) return null;
  const rule = RULES.find((r) => r.re.test(t));
  if (!rule) return null;
  const lane = LANES.find(([re]) => re.test(t))?.[1] ?? null;
  const laneText = lane === "shoulder" ? "On the shoulder" : lane ? `${lane[0].toUpperCase()}${lane.slice(1)} lane` : null;
  const label = rule.subtype ?? rule.label;
  const note = [rule.subtype, laneText].filter(Boolean).join(" · ") || null;
  // The same report type the report grid gives this item, so the server treats it identically.
  return { type: baseTypeOf(rule.item) ?? rule.type, item: rule.item, label, lane, note, spoken: `${label} reported` };
}
