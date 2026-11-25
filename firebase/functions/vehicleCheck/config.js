// Vehicle full check: the one place its settings live.
//
// Provider routing and the on/off switch are the Firestore doc config/vehicleCheck (Firebase
// console -> Firestore -> config -> vehicleCheck; admin-only write, see firestore.rules), read on
// every call and merged over these defaults -- no new build needed to change any of it:
//
//   { "details": "carjam", "rego": "carjam", "stolen": "carjam", "writtenOff": "carjam",
//     "ppsr": "aucn", "odometer": "aucn", "priceTier": "19.99", "enabled": false }
//
//   details/rego/stolen/writtenOff/ppsr/odometer -> any provider name in providers.js ADAPTERS
//   priceTier "19.99" -> product full_check;  "24.99" -> product full_check_2499
//   enabled false -> not sold and the screen is hidden in production (always visible in dev builds)
//
// Optional extras: cacheHours (24), allowSandboxForAdmins (true), decodeVin (true).

/** One consumable product per price tier, each created in App Store Connect + Play Console. */
const PRICE_TIERS = Object.freeze({
  "19.99": Object.freeze({ productId: "full_check", priceAud: 19.99 }),
  "24.99": Object.freeze({ productId: "full_check_2499", priceAud: 24.99 }),
});
const PRODUCT_IDS = Object.freeze(Object.values(PRICE_TIERS).map((t) => t.productId));
const PRODUCT_ID = PRICE_TIERS["19.99"].productId;

/** Config key -> adapter method. */
const ROUTING_KEYS = Object.freeze({
  details: "vehicleDetails",
  rego: "rego",
  stolen: "stolen",
  writtenOff: "writtenOff",
  ppsr: "ppsr",
  odometer: "odometerHistory",
});

const DEFAULT_ROUTING = Object.freeze({
  details: "carjam",
  rego: "carjam",
  stolen: "carjam",
  writtenOff: "carjam",
  ppsr: "aucn",
  odometer: "aucn",
});

const DEFAULTS = Object.freeze({
  enabled: false,
  priceTier: "19.99",
  cacheHours: 24,
  // Sandbox (TestFlight / Play test track) receipts cost nothing, but the provider calls behind
  // them are real money -- so only the owner's admin accounts may use one.
  allowSandboxForAdmins: true,
  // Free retries of one failed section on a report.
  maxSectionRetries: 3,
  // A second CarJam call that decodes the VIN for engine size, fuel and transmission.
  decodeVin: true,
});

/** The sections, in report order. "core" sections decide whether a report exists at all. */
const SECTIONS = Object.freeze([
  { key: "vehicle", method: "vehicleDetails", core: true, label: "Vehicle" },
  { key: "registration", method: "rego", core: true, label: "Registration" },
  { key: "writtenOff", method: "writtenOff", core: false, label: "Written off" },
  { key: "stolen", method: "stolen", core: false, label: "Stolen" },
  { key: "ppsr", method: "ppsr", core: false, label: "Finance owing (PPSR)" },
  { key: "odometer", method: "odometerHistory", core: false, label: "Odometer history" },
]);

const AU_STATES = Object.freeze(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);

function mergeConfig(override) {
  const o = override && typeof override === "object" ? override : {};
  // Routing: the flat keys above; an older nested { providers: { method: name } } still works.
  const providers = {};
  for (const [key, method] of Object.entries(ROUTING_KEYS)) {
    const nested = o.providers && typeof o.providers === "object" ? o.providers[method] : undefined;
    const value = typeof o[key] === "string" ? o[key] : typeof nested === "string" ? nested : DEFAULT_ROUTING[key];
    providers[method] = value.trim().toLowerCase();
  }
  const tierKey = PRICE_TIERS[String(o.priceTier ?? "")] ? String(o.priceTier) : DEFAULTS.priceTier;
  const tier = PRICE_TIERS[tierKey];
  const hours = Number(o.cacheHours);
  return {
    enabled: o.enabled === true,
    priceTier: tierKey,
    productId: tier.productId,
    priceAud: tier.priceAud,
    providers,
    cacheHours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULTS.cacheHours,
    allowSandboxForAdmins: typeof o.allowSandboxForAdmins === "boolean" ? o.allowSandboxForAdmins : DEFAULTS.allowSandboxForAdmins,
    maxSectionRetries: DEFAULTS.maxSectionRetries,
    decodeVin: typeof o.decodeVin === "boolean" ? o.decodeVin : DEFAULTS.decodeVin,
  };
}

module.exports = { PRODUCT_ID, PRODUCT_IDS, PRICE_TIERS, ROUTING_KEYS, DEFAULT_ROUTING, DEFAULTS, SECTIONS, AU_STATES, mergeConfig };
