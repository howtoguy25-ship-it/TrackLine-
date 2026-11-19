import { getAllDeviceVoices } from "@/services/voice";
import { getPersonaVoice } from "@/services/personaVoices";
import { getRecordedVoiceName } from "@/services/recordedVoices";
import { parseVoiceIdentifier } from "@/services/navSpeechPlan";

/**
 * The display name of whichever voice is selected -- a phone voice, the driver's own recorded
 * voice, or a character voice. One place, so the Sound sheet and Settings can't disagree.
 */
export async function getVoiceDisplayName(voiceIdentifier: string | null, deviceDefaultLabel: string): Promise<string> {
  const voice = parseVoiceIdentifier(voiceIdentifier);
  if (voice.kind === "recorded") return (await getRecordedVoiceName())?.trim() || "My voice";
  if (voice.kind === "persona") return getPersonaVoice(voice.personaId)?.name ?? deviceDefaultLabel;
  if (!voice.identifier) return deviceDefaultLabel;
  const voices = await getAllDeviceVoices();
  return voices.find((v) => v.identifier === voice.identifier)?.name ?? deviceDefaultLabel;
}
