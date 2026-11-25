// Adapters for the business-account providers (see PROVIDERS.md): AUCN, MotorWeb, Equifax
// CarHistory and the PPSR (B2G). Same interface as carjamAu.js. None has published API docs we
// could build against, so every section they cover answers BLOCKED -- with the reason (no key
// yet, or key present but the adapter still needs the provider's API docs) -- and never data.
//
// To finish one: replace its section functions with real calls returning
// { source, asAt: "YYYY-MM-DD", data } in the shapes carjamAu.js / ppsrBusinessApi.js return
// (odometerHistory: { readings: [{ date, km, source? }] }), add it to IMPLEMENTED in
// providers.js, record fixtures, and switch config/vehicleCheck to it.

const { ProviderError } = require("./errors");

function businessAdapter({ name, secret, covers, apiKey }) {
  const adapter = { name, costs: [], covers, implemented: false };
  for (const method of covers) {
    adapter[method] = async () => {
      if (!apiKey) throw new ProviderError("blocked", `Waiting for ${name}: ${secret} isn't set.`);
      throw new ProviderError("blocked", `${name} key is set, but the ${name} adapter still needs their API docs to be built.`);
    };
  }
  return adapter;
}

const PROVIDERS = Object.freeze({
  aucn: { name: "AUCN", secret: "AUCN_API_KEY", covers: ["ppsr", "writtenOff", "stolen", "odometerHistory"] },
  motorweb: { name: "MotorWeb", secret: "MOTORWEB_API_KEY", covers: ["rego", "stolen", "writtenOff"] },
  equifax: { name: "Equifax CarHistory", secret: "EQUIFAX_API_KEY", covers: ["odometerHistory", "writtenOff", "stolen"] },
  ppsr: { name: "PPSR", secret: "PPSR_API_KEY", covers: ["ppsr"] },
});

function createBusinessAdapter(key, apiKey) {
  return businessAdapter({ ...PROVIDERS[key], apiKey });
}

module.exports = { PROVIDERS, createBusinessAdapter };
