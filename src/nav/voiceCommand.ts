// Spoken commands while driving (the microphone button, top-right): the phone's own speech
// recogniser (services/voiceSearch.ts) hears the phrase, this decides what it means. Only a few
// clear, safe commands; anything else is "didn't catch that", never a guess. Tested in
// __tests__/nav/navOptions.test.tsx.

export type NavVoiceCommand = "stop" | "report" | "mute" | "unmute" | "routes" | "search";

const RULES: [RegExp, NavVoiceCommand][] = [
  [/\b(stop|end|cancel|exit|finish)\b.*\b(navigation|navigating|route|drive|driving|trip|directions)\b|^\s*(stop|end)\s*$/i, "stop"],
  [/\b(un ?mute|sound on|turn (the )?sound on|voice on)\b/i, "unmute"],
  [/\b(mute|sound off|turn (the )?sound off|be quiet|voice off)\b/i, "mute"],
  [/\b(report|there'?s an? )\b/i, "report"],
  [/\b(other routes|routes|alternative|faster route)\b/i, "routes"],
  [/\b(search|find|fuel|petrol|gas station|food|coffee|parking|toilet)\b/i, "search"],
];

export function parseNavVoiceCommand(text: string): NavVoiceCommand | null {
  const t = text.trim();
  if (!t) return null;
  for (const [re, cmd] of RULES) if (re.test(t)) return cmd;
  return null;
}
