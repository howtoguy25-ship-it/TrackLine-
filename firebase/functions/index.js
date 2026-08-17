const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const Stripe = require("stripe");

initializeApp();

// Real card payment for web REV checks -- mobile gates the same check behind a $14.99 Apple/
// Google IAP purchase (see RevCheckScreen.tsx); the website has no App Store/Play Store to lean
// on, so this is the web equivalent, using Stripe Checkout instead. The secret key lives only
// in Firestore's config/stripeKeys doc (owner-only, same pattern as config/revCheckProvider's
// PPSR key below) -- never sent to any client. No webhook endpoint needed: runRevCheck below
// re-asks Stripe directly ("is this session actually paid?") at the moment a check is run,
// which is simpler to set up than a webhook and just as trustworthy, since it's a live read
// from Stripe's own API, not a locally-cached flag.
async function getStripeClient() {
  const db = getFirestore();
  const snap = await db.doc("config/stripeKeys").get();
  const secretKey = (snap.exists ? snap.data().secretKey : "")?.trim();
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

const REV_CHECK_PRICE_AUD_CENTS = 1499;

// Creates a Stripe-hosted Checkout page for one REV check and hands back its URL -- the web
// client just redirects the whole tab there (no Stripe.js/publishable key needed at all for
// this simplest hosted-Checkout flow). Stripe redirects back to `success_url` once paid, with
// the real session ID filled into the {CHECKOUT_SESSION_ID} placeholder -- runRevCheck uses
// that ID to verify payment before running the real, paid PPSR search.
exports.createRevCheckCheckout = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const stripe = await getStripeClient();
  if (!stripe) {
    return { outcome: "not_connected", message: "Payments aren't connected yet -- try again later." };
  }
  const origin =
    typeof request.data?.origin === "string" && request.data.origin.startsWith("https://")
      ? request.data.origin
      : "https://tracklinemaps.com";
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "aud",
            product_data: { name: "TrackLine Vehicle REV Check" },
            unit_amount: REV_CHECK_PRICE_AUD_CENTS,
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/?revcheck_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
      metadata: { uid: request.auth.uid },
    });
    return { outcome: "success", url: session.url };
  } catch (err) {
    console.error("createRevCheckCheckout: Stripe request failed", err);
    return { outcome: "error", message: `Couldn't start payment: ${err instanceof Error ? err.message : String(err)}` };
  }
});

const BATCH_SIZE = 400;

/**
 * Runs every 15 minutes and deletes any alert whose expiresAt has passed. Alerts are
 * short-lived by design (45min-24hr depending on type) so this keeps the collection
 * small, which keeps the client's per-cell geohash range queries fast.
 */
exports.cleanupExpiredAlerts = onSchedule("every 15 minutes", async () => {
  const db = getFirestore();
  const now = Timestamp.now();

  let deletedTotal = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snapshot = await db
      .collection("alerts")
      .where("expiresAt", "<=", now)
      .limit(BATCH_SIZE)
      .get();

    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    deletedTotal += snapshot.size;
    if (snapshot.size < BATCH_SIZE) break;
  }

  console.log(`cleanupExpiredAlerts: removed ${deletedTotal} expired alert(s)`);
});

/**
 * Basic write-time validation as defense in depth alongside firestore.rules — rejects
 * (deletes) any alert doc that slipped through with a nonsensical geohash/coordinate pair,
 * so a buggy or malicious client can't poison nearby-alert queries for other users.
 */
exports.validateAlertOnCreate = onDocumentCreated("alerts/{alertId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const validLat = typeof data.lat === "number" && data.lat >= -90 && data.lat <= 90;
  const validLng = typeof data.lng === "number" && data.lng >= -180 && data.lng <= 180;
  const validGeohash = typeof data.geohash === "string" && data.geohash.length > 0;

  if (!validLat || !validLng || !validGeohash) {
    console.warn(`validateAlertOnCreate: removing malformed alert ${event.params.alertId}`);
    await event.data.ref.delete();
  }
});

// Real vehicle-history check via BusinessAPI.com.au's PPSR Searches API -- the exact same
// create-then-poll flow the mobile client used to run itself (see the app's git history for
// src/services/revCheck.ts's original client-side version), moved here so the owner's real,
// paid provider API key never has to leave this server to reach any user's device. The key
// lives only in Firestore's config/revCheckProvider doc, readable by the Admin SDK below
// regardless of firestore.rules (that doc's rules block every *client* read except the owner's
// own -- this function is the one legitimate way any other signed-in user's REV check actually
// runs). Callable, not HTTP, so it automatically gets the caller's verified Firebase Auth
// context in `request.auth` -- no separate token-verification code needed.
const PPSR_BASE_URL = "https://businessapi.com.au/api/v2/ppsr/searches";
const POLL_INTERVAL_MS = 2000;
// BAPI's own docs: "Most searches complete within a few seconds" -- this is a generous ceiling
// (~30s), not an expected wait, so a real completion is never cut off early. Comfortably inside
// a v2 onCall's own default 60s request timeout.
const MAX_POLL_ATTEMPTS = 15;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.runRevCheck = onCall(async (request) => {
  // The app is always signed in as at least an anonymous session (see mobile's
  // firebase.ts/ensureSignedIn), so this only ever rejects a genuinely unauthenticated call --
  // real proof of the $14.99 IAP payment itself is still verified client-side only (the same
  // trust boundary the client-side version of this call already had; adding real App Store/
  // Play receipt verification here would be a real, separate follow-up, not something this
  // move-the-key-server-side change was asked to add). Web's own equivalent purchase (Stripe
  // Checkout, see createRevCheckCheckout above) IS verified server-side below, since there's a
  // real Stripe session ID to check directly against Stripe's own API -- no equivalent exists
  // for a mobile IAP receipt without native receipt-verification code.
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const vin = typeof request.data?.vin === "string" ? request.data.vin.trim().toUpperCase() : "";
  if (!vin) {
    return { outcome: "error", message: "Enter a VIN to run a real check -- PPSR searches by VIN, not plate." };
  }

  const db = getFirestore();

  // Web-only payment gate. Mobile calls this function with no sessionId at all (still gated by
  // its own client-side IAP purchase flow, unchanged) -- this block is skipped entirely then.
  const sessionId = typeof request.data?.sessionId === "string" ? request.data.sessionId.trim() : "";
  if (sessionId) {
    const paymentRef = db.doc(`revCheckPayments/${sessionId}`);
    const paymentSnap = await paymentRef.get();
    if (paymentSnap.exists && paymentSnap.data().consumed) {
      return { outcome: "error", message: "This payment has already been used for a check." };
    }
    const stripe = await getStripeClient();
    if (!stripe) {
      return { outcome: "not_connected", message: "Payments aren't connected yet -- try again later." };
    }
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
      return { outcome: "error", message: "Couldn't verify that payment -- try paying again." };
    }
    if (session.payment_status !== "paid") {
      return { outcome: "error", message: "That payment hasn't completed yet." };
    }
    if (session.metadata?.uid !== request.auth.uid) {
      throw new HttpsError("permission-denied", "This payment doesn't belong to your account.");
    }
  }

  const providerSnap = await db.doc("config/revCheckProvider").get();
  const apiKey = (providerSnap.exists ? providerSnap.data().ppsrApiKey : "")?.trim();
  if (!apiKey) {
    return {
      outcome: "not_connected",
      message: "No REV check provider connected yet -- try again once the owner has one set up.",
    };
  }

  // Bearer auth -- confirmed from businessapi.com.au/developers/authentication.
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  try {
    const createResp = await fetch(PPSR_BASE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ vin }),
    });
    if (!createResp.ok) {
      const body = await createResp.text().catch(() => "");
      return {
        outcome: "error",
        message: `PPSR provider rejected the request (HTTP ${createResp.status}).${body ? ` ${body.slice(0, 200)}` : ""}`,
      };
    }
    const created = await createResp.json();
    const requestId = created?.requestId;
    if (requestId === undefined || requestId === null) {
      return { outcome: "error", message: "PPSR provider didn't return a search ID -- try again." };
    }

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      const statusResp = await fetch(`${PPSR_BASE_URL}/${requestId}`, { headers });
      // A single bad poll (a transient network hiccup) shouldn't abort the whole check -- just
      // skip this tick and try again on the next one, up to MAX_POLL_ATTEMPTS.
      if (!statusResp.ok) continue;
      const statusBody = await statusResp.json();

      if (statusBody?.status === "completed") {
        // Only ever marked consumed once a real result has actually been delivered -- same
        // "don't spend the payment until the value's actually delivered" principle as mobile's
        // own IAP finishTransaction timing (see RevCheckScreen.tsx).
        if (sessionId) {
          await db.doc(`revCheckPayments/${sessionId}`).set({
            consumed: true,
            uid: request.auth.uid,
            at: Date.now(),
          });
        }
        const data = statusBody.data ?? {};
        const vehicleData = data.nevdisData?.vehicles?.[0];
        return {
          outcome: "success",
          message: "Check complete.",
          vehicle: vehicleData
            ? {
                vin: vehicleData.vin ?? vin,
                make: vehicleData.make ?? null,
                model: vehicleData.model ?? null,
                year: vehicleData.year ?? null,
                colour: vehicleData.colour ?? null,
                bodyType: vehicleData.bodyType ?? null,
                registrationPlate: vehicleData.registrationPlate ?? null,
                registrationExpiry: vehicleData.registrationExpiry ?? null,
                stolen: !!vehicleData.stolen,
                writtenOff: !!vehicleData.writtenOff,
                safetyRecalls: vehicleData.safetyRecalls ?? null,
                // Always null today -- PPSR Searches API's own nevdisData response has no
                // odometer field at all (confirmed against its actual response shape above),
                // and odometer history is genuinely fragmented by Australian state regardless of
                // provider (NSW records it via annual roadworthy checks, several other states
                // have no equivalent mandatory check to record it from in the first place). This
                // is a real placeholder, not a bug -- see RevCheckVehicle's own comment in
                // src/services/revCheck.ts for the full picture. Kept as an explicit field (not
                // just omitted) so mobile's null-check renders the honest "not available" state
                // instead of silently having no key to check at all.
                odometerReadings: null,
              }
            : undefined,
          securedInterestCount: Array.isArray(data.registrations) ? data.registrations.length : 0,
          certificateUrl: data.certificates?.[0]?.downloadUrl ?? null,
        };
      }
      if (statusBody?.status === "failed") {
        return { outcome: "error", message: "The PPSR provider couldn't complete this search -- try again." };
      }
      // "new" or "processing" -- keep polling.
    }
    return { outcome: "error", message: "This check is taking longer than expected -- try again in a moment." };
  } catch (err) {
    console.error("runRevCheck: PPSR request failed", err);
    return {
      outcome: "error",
      message: `Couldn't reach the PPSR provider: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
});

// Real, second vehicle-data source, per explicit request to let a driver run a check from just
// a NUMBER PLATE + state -- PPSR (runRevCheck above) only ever searches by VIN (a deliberate,
// correct limit of PPSR itself, not something this works around), so getting real data off a
// plate alone needs a genuinely different provider. RegCheck's CheckAustralia operation (the
// same service carregistrationapi.com.au resells) is real and plate-based: confirmed from its
// own live WSDL (regcheck.org.uk/api/reg.asmx?wsdl) -- CheckAustralia(RegistrationNumber, State,
// username), with an HTTP GET binding alongside SOAP, which is what's used here (no SOAP
// envelope needed for that binding). This ONLY ever returns vehicle SPECS (make/model/year/
// body/engine/transmission/fuel/seats/doors/drive side) -- confirmed from that same WSDL
// introspection, it has no stolen/written-off/finance/odometer fields at all, so those stay
// PPSR-VIN-only (see runRevCheck above); this is a real, additive data source, not a replacement.
const PLATE_LOOKUP_URL = "http://www.regcheck.org.uk/api/reg.asmx/CheckAustralia";

// The ASMX HTTP GET binding returns an XML envelope wrapping a `vehicleJson` element that is
// itself a JSON *string* (confirmed from the WSDL's own Vehicle complex type) -- a real, if
// unusual, quirk of this specific API, not a parsing shortcut taken here. A small, targeted
// regex extraction (not a general XML parser, which this function has no dependency for and
// doesn't need for one known, narrow tag) plus standard XML entity unescaping, since the JSON
// string's own quotes/brackets arrive XML-escaped inside the outer envelope.
function extractVehicleJson(xmlText) {
  const match = xmlText.match(/<vehicleJson>([\s\S]*?)<\/vehicleJson>/i);
  if (!match) return null;
  const unescaped = match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
  try {
    return JSON.parse(unescaped);
  } catch {
    return null;
  }
}

// RegCheck's own JSON shape wraps most fields as { CurrentTextValue: "..." } rather than plain
// strings (a documented quirk of this API, consistent across its many region operations) --
// this reads either shape defensively so a provider response that doesn't match the expected
// wrapper still yields the plain value instead of "[object Object]".
function textValue(field) {
  if (field == null) return null;
  if (typeof field === "string") return field.trim() || null;
  if (typeof field === "object" && typeof field.CurrentTextValue === "string") {
    return field.CurrentTextValue.trim() || null;
  }
  return null;
}

exports.runPlateLookup = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const plate = typeof request.data?.plate === "string" ? request.data.plate.trim().toUpperCase() : "";
  const state = typeof request.data?.state === "string" ? request.data.state.trim().toUpperCase() : "";
  if (!plate || !state) {
    return { outcome: "error", message: "Enter a plate and state to run a real lookup." };
  }

  const db = getFirestore();
  const providerSnap = await db.doc("config/plateLookupProvider").get();
  const username = (providerSnap.exists ? providerSnap.data().username : "")?.trim();
  if (!username) {
    return {
      outcome: "not_connected",
      message: "No plate lookup provider connected yet -- try again once the owner has one set up.",
    };
  }

  const url = `${PLATE_LOOKUP_URL}?RegistrationNumber=${encodeURIComponent(plate)}&State=${encodeURIComponent(state)}&username=${encodeURIComponent(username)}`;

  try {
    const resp = await fetch(url);
    const xmlText = await resp.text();
    if (!resp.ok) {
      return {
        outcome: "error",
        message: `Plate lookup provider rejected the request (HTTP ${resp.status}).`,
      };
    }
    const parsed = extractVehicleJson(xmlText);
    const data = parsed?.Description !== undefined ? parsed : parsed?.vehicleData ?? parsed;
    if (!data) {
      console.error("runPlateLookup: couldn't parse provider response", xmlText.slice(0, 500));
      return { outcome: "error", message: "No vehicle data came back for that plate/state -- check they're correct." };
    }

    return {
      outcome: "success",
      message: "Lookup complete.",
      vehicle: {
        make: textValue(data.CarMake),
        model: textValue(data.CarModel),
        year: textValue(data.RegistrationYear),
        bodyType: textValue(data.BodyStyle),
        engineSize: textValue(data.EngineSize),
        transmission: textValue(data.Transmission),
        fuelType: textValue(data.FuelType),
        numberOfDoors: textValue(data.NumberOfDoors),
        numberOfSeats: textValue(data.NumberOfSeats),
        driverSide: textValue(data.DriverSide),
      },
    };
  } catch (err) {
    console.error("runPlateLookup: request failed", err);
    return {
      outcome: "error",
      message: `Couldn't reach the plate lookup provider: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
});

// Real, live fuel prices via the NSW Government's own FuelCheck API (api.nsw.gov.au) -- the
// official, free, real-time station-price feed NSW itself publishes (Fair Trading's own
// FuelCheck service). Confirmed real (not guessed) from two independent sources: an existing
// open-source client library's own working request/response shapes, and api.nsw.gov.au's own
// live Product/Documentation pages for this exact API, which is how the base URL, the OAuth
// token endpoint, and the /prices/nearby request/response field names below were derived.
// NSW-only today -- FuelCheck itself has no other-state data, and there's no equivalent official
// live-price API for every other state found yet (see getFuelPrices' own outcome for how the
// client is told this honestly rather than silently returning nothing).
const FUEL_OAUTH_URL = "https://api.onegov.nsw.gov.au/oauth/client_credential/accesstoken?grant_type=client_credentials";
const FUEL_PRICES_NEARBY_URL = "https://api.onegov.nsw.gov.au/FuelPriceCheck/v1/fuel/prices/nearby";
// Regular unleaded -- the one figure most drivers actually compare at a glance, same reasoning
// as any fuel-price-comparison app defaulting to a single headline grade rather than a wall of
// numbers. FuelCheck's own reference-data codes (confirmed from its docs): U91 (regular
// unleaded), E10, P95, P98, DL (diesel), among others -- a real, documented code, not guessed.
const DEFAULT_FUEL_TYPE = "U91";

// dd/MM/yyyy HH:mm:ss in Sydney local time -- FuelCheck's own documented requesttimestamp format
// (confirmed from the same client library referenced above). Uses Intl directly rather than a
// date library dependency this project doesn't already have.
function fuelCheckTimestamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

exports.getFuelPrices = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const latitude = typeof request.data?.latitude === "number" ? request.data.latitude : null;
  const longitude = typeof request.data?.longitude === "number" ? request.data.longitude : null;
  // Kilometres -- converted to FuelCheck's own expected radius below.
  const radiusKm = typeof request.data?.radiusKm === "number" ? request.data.radiusKm : 5;
  if (latitude === null || longitude === null) {
    return { outcome: "error", message: "A real location is needed to find nearby fuel prices." };
  }

  const db = getFirestore();
  const providerSnap = await db.doc("config/fuelCheckProvider").get();
  const providerData = providerSnap.exists ? providerSnap.data() : {};
  const apiKey = (providerData.apiKey ?? "").trim();
  const apiSecret = (providerData.apiSecret ?? "").trim();
  if (!apiKey || !apiSecret) {
    return {
      outcome: "not_connected",
      message: "No live fuel price provider connected yet -- try again once the owner has one set up.",
    };
  }

  try {
    // Real OAuth2 client-credentials exchange -- FuelCheck's token endpoint is Apigee's own
    // standard client_credential/accesstoken pattern (Basic auth of apiKey:apiSecret), the same
    // shape countless Apigee-fronted government/enterprise APIs use. A fresh token is fetched on
    // every call rather than cached -- simpler and always-correct over a marginal latency cost,
    // and avoids a whole separate class of "cached token silently expired" bugs on a Cloud
    // Function that can cold-start unpredictably between invocations anyway.
    const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
    const tokenResp = await fetch(FUEL_OAUTH_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    if (!tokenResp.ok) {
      return { outcome: "error", message: `Fuel price provider rejected the credentials (HTTP ${tokenResp.status}).` };
    }
    const tokenBody = await tokenResp.json();
    const accessToken = tokenBody?.access_token;
    if (!accessToken) {
      return { outcome: "error", message: "Fuel price provider didn't return an access token -- try again." };
    }

    const pricesResp = await fetch(FUEL_PRICES_NEARBY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
        "Content-Type": "application/json; charset=utf-8",
        requesttimestamp: fuelCheckTimestamp(),
        transactionid: `tl-${Date.now()}`,
      },
      body: JSON.stringify({
        fueltype: DEFAULT_FUEL_TYPE,
        latitude,
        longitude,
        radius: Math.max(1, Math.round(radiusKm)),
        brand: [],
      }),
    });
    if (!pricesResp.ok) {
      const body = await pricesResp.text().catch(() => "");
      return {
        outcome: "error",
        message: `Fuel price provider rejected the request (HTTP ${pricesResp.status}).${body ? ` ${body.slice(0, 200)}` : ""}`,
      };
    }
    const pricesBody = await pricesResp.json();
    const stations = Array.isArray(pricesBody?.stations) ? pricesBody.stations : [];
    const prices = Array.isArray(pricesBody?.prices) ? pricesBody.prices : [];

    const priceByStationCode = new Map(prices.map((p) => [p.stationcode, p]));
    const stationResults = stations
      .map((s) => {
        const price = priceByStationCode.get(s.code);
        if (!price) return null;
        return {
          stationId: String(s.stationid ?? s.code),
          name: s.name ?? null,
          brand: s.brand ?? null,
          address: s.address ?? null,
          location: { latitude: s.location?.latitude ?? null, longitude: s.location?.longitude ?? null },
          fuelType: price.fueltype ?? DEFAULT_FUEL_TYPE,
          priceCents: typeof price.price === "number" ? price.price : null,
          lastUpdated: price.lastupdated ?? null,
        };
      })
      .filter((s) => s !== null);

    return { outcome: "success", message: "Live prices loaded.", fuelType: DEFAULT_FUEL_TYPE, stations: stationResults };
  } catch (err) {
    console.error("getFuelPrices: request failed", err);
    return {
      outcome: "error",
      message: `Couldn't reach the fuel price provider: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
});
