// Build-time check for the Mapbox public token (used by app.config.js and its test).
// Build 202 shipped "***** (This is a sensitive env variable...)" as the token -- the EAS
// variable's value had been set to the text `eas env:list` prints for a hidden value.
const PLACEHOLDER_PATTERNS = [/\*/, /include-sensitive/i, /env variable/i, /YOUR[_ -]?TOKEN/i, /^pk\.\.\.$/, /<.*>/, /changeme/i, /placeholder/i];

/** null when the token can work, otherwise why not (never includes the value). */
function mapboxTokenProblem(token) {
  const t = (token || "").trim();
  if (!t) return "not set";
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(t))) return "placeholder text, not a token";
  if (t.startsWith("sk.")) return "a secret (sk.) token; the app needs the public pk. token";
  if (!/^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) return "not a Mapbox public token (should start with pk.)";
  return null;
}

module.exports = { mapboxTokenProblem };

// `node scripts/mapboxTokenCheck.js` checks the token in this shell's environment.
if (require.main === module) {
  const problem = mapboxTokenProblem(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || process.env.MAPBOX_PUBLIC_TOKEN);
  if (problem) {
    console.error(`MAPBOX_PUBLIC_TOKEN is ${problem}.`);
    process.exit(1);
  }
  console.log("MAPBOX_PUBLIC_TOKEN looks like a real public token.");
}
