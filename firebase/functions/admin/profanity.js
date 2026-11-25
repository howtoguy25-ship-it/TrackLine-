// Auto-flag for user text (Tracky names, map chats, report comments). Same word list the app's
// comment filter uses (web/src/utils/commentFilter.ts), whole words only.
const WORDS = ["fuck", "fucks", "fucking", "fucken", "fucker", "cunt", "cunts", "bitch", "bitches", "cockhead", "cockheads", "shit", "shits", "shitcunt", "shitcunts", "idiot", "idiots", "gronk", "gronks", "dog", "dogs", "pig", "pigs"];
const RE = new RegExp(`\\b(${WORDS.join("|")})\\b`, "i");

function flagText(text) {
  if (typeof text !== "string" || !text) return null;
  const m = text.match(RE);
  return m ? m[1].toLowerCase() : null;
}

module.exports = { flagText, WORDS };
