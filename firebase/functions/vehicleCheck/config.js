// Vehicle full check: the one place its settings live.
//
// Everything here can be overridden WITHOUT a code change by the Firestore doc
// config/vehicleCheck (Firebase console -> Firestore -> config -> vehicleCheck), read by the
// functions on every call and merged over these defaults:
//
//   { "priceAud": 24.99,                       // the label the app shows before the store loads
//     "providers": { "ppsr": "aucn", "odometer": "motorweb" },
//     "cacheHours": 24, "allowSandboxForAdmins": true }
//
// The price actually charged is the App Store Connect / Play Console price for full_check: move
// both together (store price tier + priceAud here) when changing $19.99 -> $24.99.

const PRODUCT_ID = "full_check";

const DEFAULTS = Object.freeze({
  productId: PRODUCT_ID,
  priceAud: 19.99,
  // Which adapter answers each section. Names are keys of ADAPTERS (providers.js).
  providers: Object.freeze({
    vehicleDetails: "carjam",
    rego: "carjam",
    stolen: "carjam",
    writtenOff: "carjam",
    ppsr: "businessapi",
    odometerHistory: "aucn",
  }),
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
  const price = Number(o.priceAud);
  return {
    ...DEFAULTS,
    priceAud: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : DEFAULTS.priceAud,
    providers: { ...DEFAULTS.providers, ...(o.providers && typeof o.providers === "object" ? o.providers : {}) },
    cacheHours: Number.isFinite(Number(o.cacheHours)) && Number(o.cacheHours) > 0 ? Number(o.cacheHours) : DEFAULTS.cacheHours,
    allowSandboxForAdmins: typeof o.allowSandboxForAdmins === "boolean" ? o.allowSandboxForAdmins : DEFAULTS.allowSandboxForAdmins,
    maxSectionRetries: DEFAULTS.maxSectionRetries,
    decodeVin: typeof o.decodeVin === "boolean" ? o.decodeVin : DEFAULTS.decodeVin,
  };
}

module.exports = { PRODUCT_ID, DEFAULTS, SECTIONS, AU_STATES, mergeConfig };
