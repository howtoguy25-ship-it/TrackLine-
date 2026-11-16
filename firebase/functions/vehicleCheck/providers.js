// The provider adapter registry, and whether the full check can be sold right now.
//
// Adapter interface (any subset; a section's configured adapter must have its method):
//   vehicleDetails(query) rego(query) stolen(query) writtenOff(query) ppsr(query) odometerHistory(query)
//   -> Promise<{ source: string, asAt: "YYYY-MM-DD", data: object, recalls?: array|null }>
//   throws ProviderError (errors.js). Each adapter also exposes `name` and `costs` (one entry per
//   paid call, logged to providerUsage).

const { createCarJamAu } = require("./carjamAu");
const { createBusinessApiPpsr } = require("./ppsrBusinessApi");
const { createAucn, createMotorWeb, createEquifax } = require("./stubAdapters");
const { SECTIONS } = require("./config");

// Values of a Firebase secret that mean "not set" (the deploy workflow creates "unset").
function realKey(value) {
  const v = typeof value === "string" ? value.trim() : "";
  return v && v !== "unset" && v !== "emulator-placeholder" ? v : "";
}

const ADAPTERS = {
  carjam: ({ keys, fetchImpl, now }) => createCarJamAu({ apiKey: realKey(keys.CARJAM_API_KEY), fetchImpl, now }),
  businessapi: ({ keys, fetchImpl, sleep, now }) => createBusinessApiPpsr({ apiKey: realKey(keys.PPSR_BUSINESSAPI_KEY), fetchImpl, sleep, now }),
  aucn: () => createAucn(),
  motorweb: () => createMotorWeb(),
  equifax: () => createEquifax(),
};

/** Which secret each adapter needs; stubs need nothing but can never be "ready". */
const ADAPTER_KEYS = { carjam: "CARJAM_API_KEY", businessapi: "PPSR_BUSINESSAPI_KEY" };

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

/**
 * Can the full check be sold? Only when every section's provider is a real adapter with its key
 * set -- otherwise a buyer would pay $19.99 for a report with holes. Returns the reasons it can't.
 */
function availability(config, keys) {
  const missing = [];
  for (const section of SECTIONS) {
    const name = config.providers[section.method];
    if (!ADAPTERS[name]) missing.push(`${section.key}: unknown provider "${name}"`);
    else if (!ADAPTER_KEYS[name]) missing.push(`${section.key}: ${name} adapter is a stub (no real integration yet)`);
    else if (!realKey(keys[ADAPTER_KEYS[name]])) missing.push(`${section.key}: ${ADAPTER_KEYS[name]} not set`);
  }
  return { available: missing.length === 0, missing: Array.from(new Set(missing)) };
}

module.exports = { ADAPTERS, ADAPTER_KEYS, buildAdapters, availability, realKey };
