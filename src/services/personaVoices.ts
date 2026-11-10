import { env } from "@/config/env";

// Real, explicit request (Waze-style redesign, Phase 3 voice picker) -- "Sarcastic Co-pilot" &
// "Dry Wit" (max 2 sarcasm voices -- scripted lines generated once via a TTS provider e.g.
// ElevenLabs and bundled/cached, not live). "Matilda" (Aussie female) and "Aussie Footy Fan"
// (casual Aussie) are also named personas, not a real device voice under those exact names on
// any real phone -- so all four are built the same honest way: real, listed entries in the
// picker, each backed by a real ElevenLabs-generated clip once a real API key exists, and a
// clear "voice not available yet" state (never a fake/silent selection) until then. See
// NOTES.md for the full story and .env.example for how to set the real key.

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

export function isElevenLabsConfigured(): boolean {
  return env.elevenLabsApiKey.length > 0;
}

// Real ElevenLabs TTS call + on-device cache -- deliberately NEVER called from this picker
// screen's own render path until isElevenLabsConfigured() is true, so there's no risk of a
// silent no-op network call standing in for a real voice. Scripted lines are meant to be
// generated ONCE (per the brief) and reused, not regenerated live per navigation -- callers
// (the recording/caching pipeline, not yet wired to the live nav voice engine) are responsible
// for calling this during a one-time generation pass and persisting the resulting local file,
// not calling it on every turn-by-turn instruction.
export async function generatePersonaClip(
  personaId: string,
  elevenLabsVoiceId: string,
  text: string
): Promise<ArrayBuffer> {
  if (!isElevenLabsConfigured()) {
    throw new Error(`ElevenLabs is not configured -- cannot generate the "${personaId}" persona clip for real.`);
  }
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": env.elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
    }),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs TTS request failed (${response.status})`);
  }
  return response.arrayBuffer();
}
