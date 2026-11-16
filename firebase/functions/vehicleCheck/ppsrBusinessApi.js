// PPSR (finance owing) through BusinessAPI.com.au's PPSR Searches API -- the same create-then-
// poll flow the existing REV check (index.js runRevCheck) already uses, as an adapter here.
//   POST https://businessapi.com.au/api/v2/ppsr/searches  {vin}  -> {requestId}
//   GET  .../searches/{requestId} until status "completed" | "failed"
//   Bearer auth (businessapi.com.au/developers/authentication).
// Read from a completed search: data.registrations (security interests -- finance owing),
// data.certificates[0].downloadUrl (the official PPSR search certificate PDF), and
// data.nevdisData.vehicles[0].safetyRecalls (recalls, only when the provider returns them).
// PPSR searches by VIN only.

const { ProviderError } = require("./errors");

const BASE_URL = "https://businessapi.com.au/api/v2/ppsr/searches";
const NAME = "PPSR via BusinessAPI";

function createBusinessApiPpsr({ apiKey, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 2000, maxPolls = 15, now = () => new Date() } = {}) {
  const costs = [];
  return {
    name: NAME,
    costs,
    async ppsr(query) {
      if (!apiKey) throw new ProviderError("not_configured", "PPSR isn't connected (no PPSR_BUSINESSAPI_KEY).");
      if (!query.vin) throw new ProviderError("not_found", "PPSR needs the VIN, and the registry didn't give one.");
      const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
      let created;
      try {
        const resp = await fetchImpl(BASE_URL, { method: "POST", headers, body: JSON.stringify({ vin: query.vin }) });
        if (!resp.ok) throw new ProviderError(resp.status >= 500 ? "down" : "bad_response", `PPSR provider replied HTTP ${resp.status}.`);
        created = await resp.json();
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError("down", "Couldn't reach the PPSR provider.");
      }
      const requestId = created?.requestId;
      if (requestId === undefined || requestId === null) throw new ProviderError("bad_response", "PPSR provider didn't return a search ID.");
      for (let i = 0; i < maxPolls; i++) {
        await sleep(pollMs);
        let body;
        try {
          const resp = await fetchImpl(`${BASE_URL}/${requestId}`, { headers });
          if (!resp.ok) continue;
          body = await resp.json();
        } catch {
          continue;
        }
        if (body?.status === "failed") throw new ProviderError("down", "The PPSR search failed at the provider.");
        if (body?.status !== "completed") continue;
        // BusinessAPI doesn't state a per-search price in its API; the cost is logged as unknown
        // (null) until the account's price is put in config.
        costs.push({ provider: NAME, item: "ppsr_search", amount: null, currency: "AUD" });
        const data = body.data ?? {};
        const interests = Array.isArray(data.registrations) ? data.registrations : [];
        const recalls = data.nevdisData?.vehicles?.[0]?.safetyRecalls;
        return {
          source: NAME,
          asAt: now().toISOString().slice(0, 10),
          data: {
            // Only the count -- never the secured party's or grantor's details.
            securedInterests: interests.length,
            certificateUrl: data.certificates?.[0]?.downloadUrl ?? null,
          },
          recalls: Array.isArray(recalls) ? recalls : null,
        };
      }
      throw new ProviderError("down", "The PPSR search took too long.");
    },
  };
}

module.exports = { createBusinessApiPpsr, BASE_URL };
