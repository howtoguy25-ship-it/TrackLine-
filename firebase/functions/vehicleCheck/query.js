// What a driver asks for: an Australian plate + state, or a 17-character VIN. Validated here on
// the server whatever the app sent. Australia only -- a foreign plate is refused, never looked
// up against Australian registers.

const { AU_STATES } = require("./config");

// ISO 3779: 17 characters, digits and capitals, never I, O or Q.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
// Australian plates: letters and digits, 1-9 characters once spaces and dashes are removed.
const PLATE_RE = /^[A-Z0-9]{1,9}$/;

function normaliseVin(vin) {
  return String(vin || "").replace(/[\s-]/g, "").toUpperCase();
}

function normalisePlate(plate) {
  return String(plate || "").replace(/[\s.-]/g, "").toUpperCase();
}

/**
 * -> { ok: true, query: { kind, plate?, state?, vin?, key } } or { ok: false, reason }.
 * `country` is where the driver is (ISO 3166-1 alpha-2, from the app).
 */
function parseQuery(input) {
  const country = String(input?.country || "").toUpperCase();
  if (country !== "AU") return { ok: false, reason: "not_available_in_country" };
  if (input?.vin) {
    const vin = normaliseVin(input.vin);
    if (!VIN_RE.test(vin)) return { ok: false, reason: "invalid_vin" };
    return { ok: true, query: { kind: "vin", vin, key: `AU:vin:${vin}` } };
  }
  const plate = normalisePlate(input?.plate);
  const state = String(input?.state || "").toUpperCase();
  if (!AU_STATES.includes(state)) return { ok: false, reason: "invalid_state" };
  if (!PLATE_RE.test(plate)) return { ok: false, reason: "invalid_plate" };
  return { ok: true, query: { kind: "plate", plate, state, key: `AU:plate:${state}:${plate}` } };
}

module.exports = { VIN_RE, parseQuery, normaliseVin, normalisePlate };
