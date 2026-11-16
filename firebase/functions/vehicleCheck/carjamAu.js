// CarJam Australia adapter: vehicle details, registration, stolen and written-off.
//
// Built only on CarJam's published reference (carjam.co.nz/dev:page?t=australian-vehicles,
// read 2026-11-16):
//   GET https://www.carjam.co.nz/api/car-au/   (test: https://test.carjam.co.nz/api/car-au/)
//   key=<API key>, query_type=..., and either vin=, chassis= (pre-1989) or plate= + state=
//   query_type VDRSBC = details + registration status + build/compliance; SC = stolen;
//   WO = damage/write-off; VIND = VIN decoder (VIN only).
//   Responses: XML by default (`<message><vehicles __array="true">...`). The JSON layout isn't
//   documented, so this asks for the documented XML and parses that.
//   A call that returns an error is free (pricing page).
//
// Field names used below are exactly the documented ones: vin, registration/plate,
// registration/state, registration/status, registration/expiry_date, make, model, colour,
// body_type, vehicle_type, year_of_manufacture; stolen[]: type, jurisdiction, reported_date;
// written_off[]: incident_code (e.g. "Statutory Write-off"), type_code (e.g. "Storm, Flood,
// Other Write-off"), incident_recorded_date, jurisdiction, damage_codes; VIND: build_year,
// model_year, body_style, fuel/type, engine/cylinders, engine/size_litres, transmission/type.
//
// Not shown on purpose: engine_number, chassis and the stolen record's police reference
// (`summary`) -- identifiers, not something a buyer needs.

const { XMLParser } = require("fast-xml-parser");
const { ProviderError } = require("./errors");

const PROD_URL = "https://www.carjam.co.nz/api/car-au/";
const TEST_URL = "https://test.carjam.co.nz/api/car-au/";
const NAME = "CarJam";

// Documented per-lookup prices (NZD ex GST, "Consumer resale" column -- we pass the data on to
// app users) from carjam.co.nz/dev:page?t=api-pricing, 2026-11-16. Logged per check.
const PRICE_NZD = { VDRSBC: 5.35, SC: 3.41, WO: 3.41, VIND: 2.64 };

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

function asArray(x) {
  if (x === undefined || x === null || x === "") return [];
  return Array.isArray(x) ? x : [x];
}

/** Records that actually have content (an empty `<stolen __array="true"/>` parses to ""). */
function records(x) {
  return asArray(x).filter((r) => r && typeof r === "object" && Object.keys(r).length > 0);
}

function text(x) {
  if (x === undefined || x === null) return null;
  const s = String(typeof x === "object" ? "" : x).trim();
  return s ? s : null;
}

function parseCarJamXml(xml) {
  let doc;
  try {
    doc = parser.parse(String(xml));
  } catch (err) {
    throw new ProviderError("bad_response", "CarJam sent a reply we couldn't read.");
  }
  if (doc?.error) {
    const message = text(doc.error.message) || "CarJam returned an error.";
    // CarJam's NZ reference documents "Requires an API key" as an error message.
    if (/api key/i.test(message)) throw new ProviderError("not_configured", message);
    throw new ProviderError("bad_response", message, { code: text(doc.error.code) });
  }
  const vehicles = records(doc?.message?.vehicles);
  if (vehicles.length === 0) throw new ProviderError("not_found", "No vehicle found on the register.");
  return vehicles[0];
}

/** "Statutory Write-off" -> statutory; "Repairable ..." -> repairable; else unknown. */
function writeOffCategory(incidentCode) {
  const s = String(incidentCode || "").toLowerCase();
  if (s.includes("statutory")) return "statutory";
  if (s.includes("repairable")) return "repairable";
  return "unknown";
}

function createCarJamAu({ apiKey, fetchImpl = fetch, test = false, now = () => new Date() } = {}) {
  const baseUrl = test ? TEST_URL : PROD_URL;
  const memo = new Map();
  const costs = [];

  async function call(queryType, query) {
    if (!apiKey) throw new ProviderError("not_configured", "CarJam isn't connected (no CARJAM_API_KEY).");
    const params = new URLSearchParams({ key: apiKey, query_type: queryType });
    if (query.vin) params.set("vin", query.vin);
    else {
      params.set("plate", query.plate);
      params.set("state", query.state);
    }
    const memoKey = `${queryType}|${query.vin || `${query.state}:${query.plate}`}`;
    if (memo.has(memoKey)) return memo.get(memoKey);
    const promise = (async () => {
      let resp;
      try {
        resp = await fetchImpl(`${baseUrl}?${params.toString()}`, { method: "GET" });
      } catch (err) {
        throw new ProviderError("down", "Couldn't reach CarJam.");
      }
      if (resp.status === 429) throw new ProviderError("down", "CarJam is busy (rate limited).");
      if (!resp.ok) throw new ProviderError("down", `CarJam replied HTTP ${resp.status}.`);
      const vehicle = parseCarJamXml(await resp.text());
      costs.push({ provider: NAME, item: `au_${queryType.toLowerCase()}`, amount: PRICE_NZD[queryType] ?? null, currency: "NZD" });
      return vehicle;
    })();
    memo.set(memoKey, promise);
    // A temporary failure is retried fresh; a definite answer ("not found") is kept.
    promise.catch((err) => {
      if (!(err instanceof ProviderError) || err.retryable) memo.delete(memoKey);
    });
    return promise;
  }

  const asAt = () => now().toISOString().slice(0, 10);

  return {
    name: NAME,
    costs,
    async vehicleDetails(query) {
      const v = await call("VDRSBC", query);
      const vin = text(v.vin);
      let decoded = null;
      if (vin && query.decodeVin !== false) {
        // The VIN decoder adds engine size, fuel and transmission; optional -- the section still
        // stands without it.
        decoded = await call("VIND", { vin }).catch(() => null);
      }
      const cylinders = text(decoded?.engine?.cylinders);
      const litres = text(decoded?.engine?.size_litres);
      return {
        source: NAME,
        asAt: asAt(),
        data: {
          make: text(v.make),
          model: text(v.model),
          year: text(v.year_of_manufacture) || text(decoded?.build_year),
          body: text(v.body_type) || text(decoded?.body_style),
          colour: text(v.colour),
          engine: litres || cylinders ? [litres ? `${litres} L` : null, cylinders ? `${cylinders} cyl` : null].filter(Boolean).join(", ") : null,
          fuel: text(decoded?.fuel?.type),
          transmission: text(decoded?.transmission?.type),
          vehicleType: text(v.vehicle_type),
          vin,
        },
      };
    },
    async rego(query) {
      const v = await call("VDRSBC", query);
      return {
        source: NAME,
        asAt: asAt(),
        data: {
          plate: text(v.registration?.plate),
          state: text(v.registration?.state),
          status: text(v.registration?.status),
          expiry: text(v.registration?.expiry_date),
        },
      };
    },
    async stolen(query) {
      const v = await call("SC", query);
      const list = records(v.stolen).map((r) => ({
        type: text(r.type),
        jurisdiction: text(r.jurisdiction),
        reportedDate: text(r.reported_date),
      }));
      return { source: NAME, asAt: asAt(), data: { stolen: list.length > 0, records: list } };
    },
    async writtenOff(query) {
      const v = await call("WO", query);
      const list = records(v.written_off).map((r) => ({
        category: writeOffCategory(r.incident_code),
        incident: text(r.incident_code),
        reason: text(r.type_code),
        date: text(r.incident_recorded_date),
        jurisdiction: text(r.jurisdiction),
        damageCodes: text(r.damage_codes),
      }));
      return { source: NAME, asAt: asAt(), data: { writtenOff: list.length > 0, records: list } };
    },
  };
}

module.exports = { createCarJamAu, parseCarJamXml, writeOffCategory, PRICE_NZD, PROD_URL, TEST_URL };
