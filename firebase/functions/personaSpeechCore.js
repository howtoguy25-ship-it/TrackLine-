// Pure helpers for the character voices (synthesizePersonaSpeech in index.js). No Firebase or
// network in here, so every rule is unit-tested directly -- see
// firebase/tests/personaSpeechCore.test.js.

const crypto = require("crypto");

// Keep in step with PERSONA_VOICES in src/services/personaVoices.ts.
const PERSONA_IDS = ["matilda", "footy_fan", "sarcastic_copilot", "dry_wit"];

// Longer than anything navigation says. Keep in step with PERSONA_MAX_TEXT_LENGTH in
// src/services/personaSpeech.ts.
const MAX_TEXT_LENGTH = 220;

// New sentences one driver may have synthesized per day. Sentences already in the shared cache
// don't count -- they cost nothing. A long day's driving with frequent re-routes is a few
// hundred sentences; this stops a runaway or abusive client spending the ElevenLabs quota.
const DAILY_NEW_SENTENCE_LIMIT = 400;

/**
 * A secret counts as set only if it holds a real value. The deploy workflow creates a
 * placeholder ("unset") for optional keys that haven't been provided, so that deploying never
 * fails just because a key is missing -- and that placeholder must never be mistaken for a key.
 */
function secretIsSet(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 && trimmed.toLowerCase() !== "unset";
}

function normalizeText(text) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

/** Returns { personaId, text } or null if the request isn't one this function should serve. */
function validateRequest(data) {
  const personaId = data && typeof data.personaId === "string" ? data.personaId : "";
  if (!PERSONA_IDS.includes(personaId)) return null;
  const text = normalizeText(data.text);
  if (!text || text.length > MAX_TEXT_LENGTH) return null;
  // Navigation sentences are words, numbers and ordinary punctuation. Anything with markup or
  // control characters isn't one, and is refused rather than sent on to be synthesized.
  // eslint-disable-next-line no-control-regex
  if (/[<>{}\u0000-\u001f]/.test(text)) return null;
  return { personaId, text };
}

/** Where one sentence in one voice lives in the shared cache. The voice id is part of the key
 *  so changing which ElevenLabs voice a character uses doesn't serve the old voice's audio. */
function cachePath(personaId, elevenLabsVoiceId, modelId, text) {
  const hash = crypto.createHash("sha256").update(`${elevenLabsVoiceId}|${modelId}|${text}`).digest("hex");
  return `personaSpeech/${personaId}/${hash}.mp3`;
}

function utcDayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Given a driver's stored usage and today's date, the count so far today. */
function usageToday(usageDoc, nowMs) {
  if (!usageDoc || usageDoc.day !== utcDayKey(nowMs)) return 0;
  return Number.isFinite(usageDoc.count) ? usageDoc.count : 0;
}

module.exports = {
  PERSONA_IDS,
  MAX_TEXT_LENGTH,
  DAILY_NEW_SENTENCE_LIMIT,
  secretIsSet,
  normalizeText,
  validateRequest,
  cachePath,
  utcDayKey,
  usageToday,
};
