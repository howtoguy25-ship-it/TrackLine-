// The provider adapter registry, and whether the full check can be sold right now.
//
// Adapter interface (any subset; a section's configured adapter must have its method):
//   vehicleDetails(query) rego(query) stolen(query) writtenOff(query) ppsr(query) odometerHistory(query)
//   -> Promise<{ source: string, asAt: "YYYY-MM-DD", data: object, recalls?: array|null }>
//   throws ProviderError (errors.js). Each adapter also exposes `name` and `costs` (one entry per
//   paid call, logged to providerUsage).
//
// Keys are Firebase secrets, read only inside Cloud Functions (index.js passes them in).

const { createCarJamAu } = require("./carjamAu");
const { createBusinessApiPpsr } = require("./ppsrBusinessApi");
const { PROVIDERS: BUSINESS, createBusinessAdapter } = require("./businessAdapters");
const { SECTIONS } = require("./config");

// Values of a Firebase secret that mean "not set" (the deploy workflow creates "unset").
function realKey(value) {
  const v = typeof value === "string" ? value.trim() : "";
  return v && v !== "unset" && v !== "emulator-placeholder" ? v : "";
}

/** Provider name -> the Firebase secret that holds its key. */
const ADAPTER_KEYS = Object.freeze({
  carjam: "CARJAM_API_KEY",
  aucn: "AUCN_API_KEY",
  motorweb: "MOTORWEB_API_KEY",
  equifax: "EQUIFAX_API_KEY",
  ppsr: "PPSR_API_KEY",
  // An alternative PPSR route that is already integrated (the old REV check's provider).
  businessapi: "PPSR_BUSINESSAPI_KEY",
});

/** Which methods each provider covers. */
const COVERS = Object.freeze({
  carjam: ["vehicleDetails", "rego", "stolen", "writtenOff"],
  businessapi: ["ppsr"],
  ...Object.fromEntries(Object.entries(BUSINESS).map(([k, v]) => [k, v.covers])),
});

/** Adapters with a real integration (the rest answer BLOCKED until they're built). */
const IMPLEMENTED = Object.freeze(["carjam", "businessapi"]);

const ADAPTERS = {
  carjam: ({ keys, fetchImpl, now }) => createCarJamAu({ apiKey: realKey(keys.CARJAM_API_KEY), fetchImpl, now }),
  businessapi: ({ keys, fetchImpl, sleep, now }) => createBusinessApiPpsr({ apiKey: realKey(keys.PPSR_BUSINESSAPI_KEY), fetchImpl, sleep, now }),
  ...Object.fromEntries(Object.keys(BUSINESS).map((k) => [k, ({ keys }) => createBusinessAdapter(k, realKey(keys[ADAPTER_KEYS[k]]))])),
};

/** One instance per adapter name for one check (so CarJam's calls are shared across sections). */
function buildAdapters(config, deps) {
  const instances = {};
  const bySection = {};
  // Tests add in-memory adapters here; production passes none.
  const registry = { ...ADAPTERS, ...(deps.extraAdapters || {}) };
  for (const section of SECTIONS) {
    const name = config.providers[section.method];
    const factory = registry[name];
    if (!factory) {
      bySection[section.key] = null;
      continue;
    }
    instances[name] = instances[name] || factory(deps);
    bySection[section.key] = instances[name];
  }
  return { instances, bySection };
}

/** For each section: "ready", or why it's BLOCKED. */
function sectionReadiness(config, keys) {
  const out = {};
  for (const section of SECTIONS) {
    const name = config.providers[section.method];
    let status = "ready";
    if (!ADAPTERS[name]) status = `BLOCKED: unknown provider "${name}"`;
    else if (!COVERS[name]?.includes(section.method)) status = `BLOCKED: ${name} doesn't cover ${section.key}`;
    else if (!realKey(keys[ADAPTER_KEYS[name]])) status = `BLOCKED: ${ADAPTER_KEYS[name]} not set`;
    else if (!IMPLEMENTED.includes(name)) status = `BLOCKED: ${name} adapter not built yet (needs their API docs)`;
    out[section.key] = { provider: name, status };
  }
  return out;
}

/**
 * Is the full check on sale? Only when the owner has switched it on (config enabled: true) AND
 * every section's provider is real and keyed -- a buyer never pays $19.99 for a report with
 * BLOCKED holes. `missing` says what's still in the way.
 */
function availability(config, keys) {
  const sections = sectionReadiness(config, keys);
  const missing = Object.entries(sections)
    .filter(([, v]) => v.status !== "ready")
    .map(([k, v]) => `${k}: ${v.status.replace(/^BLOCKED: /, "")}`);
  if (!config.enabled) missing.unshift("switched off (config/vehicleCheck enabled is false)");
  return { available: missing.length === 0, missing, sections };
}

module.exports = { ADAPTERS, ADAPTER_KEYS, COVERS, IMPLEMENTED, buildAdapters, availability, sectionReadiness, realKey };
