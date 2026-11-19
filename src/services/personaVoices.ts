import type { NavPhrase } from "@/services/navSpeechPlan";

// The four character voices from the voice picker. Each is a real synthesized voice: the server
// (firebase/functions -- synthesizePersonaSpeech) turns a sentence into audio with ElevenLabs and
// the app caches the result (services/personaSpeech.ts).
//
// The ElevenLabs key lives ONLY on the server, as a Cloud Functions secret. It used to be read
// from the app's own config, which would have shipped the key inside every copy of the app.
//
// Until that secret is set these voices stay visibly locked in the picker -- see
// getPersonaVoicesAvailable in personaSpeech.ts, and DEPLOY.md for how to set it.

export interface PersonaVoice {
  id: string;
  name: string;
  description: string;
}

export const PERSONA_VOICES: PersonaVoice[] = [
  { id: "matilda", name: "Matilda", description: "Aussie female" },
  { id: "footy_fan", name: "Aussie Footy Fan", description: "Casual Aussie" },
  { id: "sarcastic_copilot", name: "Sarcastic Co-pilot", description: "Dry, sarcastic" },
  { id: "dry_wit", name: "Dry Wit", description: "Deadpan humour" },
];

export function getPersonaVoice(personaId: string): PersonaVoice | undefined {
  return PERSONA_VOICES.find((p) => p.id === personaId);
}

// What makes a character a character: its own scripted lines for the moments that aren't a
// turn. Turn instructions themselves are always spoken straight -- a joke in the middle of
// "turn left onto George Street" is the one place it would cost the driver something.
type ScriptedKind = Exclude<NavPhrase["kind"], "report">;

const PERSONA_SCRIPTS: Record<string, Partial<Record<ScriptedKind, string[]>>> = {
  matilda: {
    start: ["Righto, all set. Let's hit the road.", "Buckle up, we're off."],
    rerouting: ["No worries, finding another way."],
    arrived: ["Here we are. You've arrived."],
    heavyTraffic: ["Bit of a traffic jam ahead."],
  },
  footy_fan: {
    start: ["Siren's gone, we're away! Let's go.", "Bounce the ball, we're off!"],
    rerouting: ["Turnover! Finding another way through."],
    arrived: ["Full time! You've arrived."],
    heavyTraffic: ["Bit of a pack forming up ahead. Heavy traffic."],
  },
  sarcastic_copilot: {
    start: ["Oh good, we're driving. Try to keep up.", "All set. What could possibly go wrong."],
    rerouting: ["Re-routing. Again. Not that I'm counting."],
    arrived: ["You've arrived. Against all odds."],
    heavyTraffic: ["Heavy traffic ahead. I'm sure it's everyone else's fault."],
  },
  dry_wit: {
    start: ["All set. Do try to enjoy yourself.", "We're off. Contain your excitement."],
    rerouting: ["Re-routing. A bold choice back there."],
    arrived: ["You've arrived. Thrilling."],
    heavyTraffic: ["Heavy traffic ahead. How novel."],
  },
};

/** A character's own line for this moment, or null when it should just say the standard one. */
export function personaLine(personaId: string, phrase: NavPhrase, random: () => number = Math.random): string | null {
  if (phrase.kind === "report") return null;
  const lines = PERSONA_SCRIPTS[personaId]?.[phrase.kind];
  if (!lines || lines.length === 0) return null;
  return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))];
}

/** Every scripted line a character might say -- fetched ahead of time so none is ever late. */
export function allPersonaLines(personaId: string): string[] {
  const script = PERSONA_SCRIPTS[personaId];
  return script ? Object.values(script).flat() : [];
}
