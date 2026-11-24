const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const Stripe = require("stripe");
const {
  haversineMeters,
  sanitizeLook,
  isValidLatLng,
  roundCoord,
  bearingDegrees,
  timeAlongGeometry,
  downsample,
} = require("./presencePath");
const personaCore = require("./personaSpeechCore");
const trackysCore = require("./trackysCore");
const trafficCore = require("./trafficNswCore");
const schoolZonesCore = require("./schoolZonesCore");
const roadReportsCore = require("./roadReportsCore");
const reportsCore = require("./reports/core");
const { firestoreReportStore } = require("./reports/store");
const poiPopularity = require("./poiPopularity");
const crashRecords = require("./crashRecords");
const tfnswTrip = require("./tfnswTrip");
const plannedDrivesCore = require("./plannedDrivesCore");
const fuelCheckCore = require("./fuelCheckCore");
const nswPublicHolidays = require("./data/nswPublicHolidays.json");

initializeApp();

// Keep in sync with isAdmin() in firestore.rules and src/config/admin.ts /
// web/src/config/admin.ts -- Cloud Functions can't read firestore.rules directly, so this is
// the real, separate enforcement point for the owner-only calls below (broadcastNotification).
// request.auth.token.email is Firebase Auth's own verified ID token claim, not client-supplied
// data, so this can't be spoofed by a non-owner account.
const ADMIN_EMAILS = ["howtoguy25@gmail.com", "support@tracklinemaps.com"];
function isAdminRequest(request) {
  return !!request.auth && ADMIN_EMAILS.includes((request.auth.token.email || "").toLowerCase());
}

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
    snapshot.docs.forEach((doc) => {
      // A crash report another driver confirmed goes into crash history as it ends.
      const record = crashRecords.recordFromAlert(doc.id, doc.data(), Date.now());
      if (record) {
        const { id, atMs, expiresAtMs, ...rest } = record;
        batch.set(db.collection("crashRecords").doc(id), { ...rest, at: Timestamp.fromMillis(atMs), expiresAt: Timestamp.fromMillis(expiresAtMs) });
      }
      batch.delete(doc.ref);
    });
    await batch.commit();

    deletedTotal += snapshot.size;
    if (snapshot.size < BATCH_SIZE) break;
  }

  console.log(`cleanupExpiredAlerts: removed ${deletedTotal} expired alert(s)`);
});

// ---- Driver reports (police, crash, hazard ...) --------------------------------------------
// Every report goes through submitReport: anti-spam (within 1 km of the driver, 10 an hour, 30 a
// day, a burst blocks for 15 min then 24 h), duplicates merged into the report already on the
// map, low-trust reporters' reports flagged to need a confirmation. It's held for 3 s so Undo
// works (undoReport, at most 2 an hour), then publishPendingReport puts it on the map. Votes
// ("Still here" / "Not there") extend or remove it and move the reporter's trust
// (applyReportVote). Rules: reports/policy.json. Tests: firebase/tests/reports.test.js.
const reportStore = () => firestoreReportStore(getFirestore(), { FieldValue, Timestamp });

function reportHttpsError(err) {
  if (err instanceof reportsCore.ReportError) {
    const code = ["blocked", "hourly-limit", "daily-limit", "undo-limit"].includes(err.code) ? "resource-exhausted" : err.code === "not-found" ? "not-found" : "failed-precondition";
    return new HttpsError(code, err.message, { reason: err.code, ...(err.until ? { until: err.until } : {}) });
  }
  return err;
}

exports.submitReport = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const name = request.data && request.data.showName && typeof request.auth.token.name === "string" && request.auth.token.name.length <= 40 ? request.auth.token.name : null;
  try {
    return await reportsCore.submit(reportStore(), { uid: request.auth.uid, data: request.data, reporterName: name, nowMs: Date.now() });
  } catch (err) {
    throw reportHttpsError(err);
  }
});

exports.undoReport = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  try {
    return await reportsCore.undo(reportStore(), { uid: request.auth.uid, pendingId: request.data && request.data.pendingId, nowMs: Date.now() });
  } catch (err) {
    throw reportHttpsError(err);
  }
});

exports.publishPendingReport = onDocumentCreated("pendingReports/{id}", async (event) => {
  const data = event.data && event.data.data();
  if (!data) return;
  const wait = Math.max(0, Math.min(10_000, data.publishAtMs - Date.now())) + 250;
  await sleep(wait);
  await reportStore().publish(event.params.id);
});

// Admin: fixed cameras / road features waiting for approval (also confirmable by 3 drivers).
exports.moderationQueue = onCall(async (request) => {
  if (!isAdminRequest(request)) throw new HttpsError("permission-denied", "Admins only.");
  return { items: await reportStore().moderationQueue() };
});

exports.moderateReport = onCall(async (request) => {
  if (!isAdminRequest(request)) throw new HttpsError("permission-denied", "Admins only.");
  const { alertId, approve } = request.data || {};
  if (typeof alertId !== "string" || !alertId) throw new HttpsError("invalid-argument", "alertId required.");
  return { result: await reportStore().moderate(alertId, !!approve, request.auth.uid, Date.now()) };
});

exports.applyReportVote = onDocumentCreated("alerts/{alertId}/votes/{uid}", async (event) => {
  const data = event.data && event.data.data();
  if (!data || (data.vote !== "confirm" && data.vote !== "deny")) return;
  await reportStore().applyVote(event.params.alertId, event.params.uid, data.vote, Date.now());
});

// ---- Badge popularity (src/map/poiRanking.ts) ----------------------------------------------
const GOOGLE_PLACES_SERVER_KEY = defineSecret("GOOGLE_PLACES_SERVER_KEY");

function poiStore(db) {
  return {
    async getCached(ids) {
      if (!ids.length) return {};
      const snaps = await db.getAll(...ids.map((id) => db.collection("poiPopularity").doc(id)));
      return Object.fromEntries(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));
    },
    async putCached(id, value) {
      await db.collection("poiPopularity").doc(id).set(value);
    },
    async getArrivals(ids) {
      if (!ids.length) return {};
      const snaps = await db.getAll(...ids.map((id) => db.collection("poiArrivals").doc(id)));
      return Object.fromEntries(snaps.filter((s) => s.exists).map((s) => [s.id, s.data().count || 0]));
    },
    async takeFetchBudget(uid, n, nowMs) {
      const day = new Date(nowMs).toISOString().slice(0, 10);
      const ref = db.collection("poiLookupBudget").doc(`${uid}_${day}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const used = snap.exists ? snap.data().used || 0 : 0;
        const allowed = Math.max(0, Math.min(n, poiPopularity.MAX_FETCHES_PER_USER_PER_DAY - used));
        tx.set(ref, { used: used + allowed, day });
        return allowed;
      });
    },
    async countArrivalOnce(id, mark, nowMs) {
      const markRef = db.collection("poiArrivalMarks").doc(mark);
      const countRef = db.collection("poiArrivals").doc(id);
      return db.runTransaction(async (tx) => {
        if ((await tx.get(markRef)).exists) return false;
        tx.set(markRef, { at: Timestamp.fromMillis(nowMs), expiresAt: Timestamp.fromMillis(nowMs + 2 * 86_400_000) });
        tx.set(countRef, { count: FieldValue.increment(1) }, { merge: true });
        return true;
      });
    },
  };
}

exports.poiPopularity = onCall({ secrets: [GOOGLE_PLACES_SERVER_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return poiPopularity.lookup({
    uid: request.auth.uid,
    places: request.data && request.data.places,
    store: poiStore(getFirestore()),
    apiKey: GOOGLE_PLACES_SERVER_KEY.value(),
    fetchImpl: fetch,
    nowMs: Date.now(),
  });
});

// Only called by the app when the driver has switched on "Share arrivals" (Settings > Privacy).
exports.recordArrival = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return poiPopularity.recordArrival({ uid: request.auth.uid, place: request.data && request.data.place, store: poiStore(getFirestore()), nowMs: Date.now() });
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

// Real, cloud OCR alternative to VehicleDetectionScreen's own on-device plate reader (rn-mlkit-
// ocr, see plateOcr.ts), per explicit request to use Plate Recognizer (platerecognizer.com)
// specifically. Only ever called when the client's own subscribePlateRecognizerProviderStatus
// says a real provider is connected -- unconfigured, the app falls back to the existing
// on-device path unchanged (see plateRecognizer.ts's own comment on the client side for why that
// fallback matters: it means this feature is never a hard requirement for plate reading to work
// at all). A real, confirmed real endpoint/auth contract (api.platerecognizer.com/v1/plate-
// reader/, Authorization: Token <key>, multipart `upload` field) -- not guessed.
const PLATE_RECOGNIZER_URL = "https://api.platerecognizer.com/v1/plate-reader/";

exports.recognizePlate = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const imageBase64 = typeof request.data?.imageBase64 === "string" ? request.data.imageBase64 : "";
  if (!imageBase64) {
    return { outcome: "error", message: "No plate image was provided." };
  }

  const db = getFirestore();
  const providerSnap = await db.doc("config/plateRecognizerProvider").get();
  const apiKey = (providerSnap.exists ? providerSnap.data().apiKey : "")?.trim();
  if (!apiKey) {
    return { outcome: "not_connected", message: "No plate recognition provider connected yet." };
  }

  try {
    const imageBuffer = Buffer.from(imageBase64, "base64");
    const form = new FormData();
    form.append("upload", new Blob([imageBuffer], { type: "image/jpeg" }), "plate.jpg");

    const res = await fetch(PLATE_RECOGNIZER_URL, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        outcome: "error",
        message: `Plate Recognizer rejected the request (HTTP ${res.status}).${body ? ` ${body.slice(0, 200)}` : ""}`,
      };
    }
    const data = await res.json();
    const best = Array.isArray(data.results) && data.results.length > 0 ? data.results[0] : null;
    return {
      outcome: "success",
      // No candidate found in this crop -- an honest null, not an error (the exact same "OCR
      // ran but found nothing plate-shaped" outcome plateOcr.ts's on-device path already
      // returns), so the caller's own confirm-after-2-reads logic treats it identically either
      // way.
      plate: best ? String(best.plate).toUpperCase() : null,
      confidence: best ? best.score : null,
    };
  } catch (err) {
    console.error("recognizePlate: request failed", err);
    return {
      outcome: "error",
      message: `Couldn't reach the plate recognition provider: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
});

// Real push-notification broadcast for the mobile Owner Dashboard's "Send to all users" button.
// Reads every real device's Expo push token from deviceSessions (see src/services/
// deviceSession.ts -- written by every install, anonymous sessions included, not just real
// sign-ins) and sends through Expo's own push service, which then relays to APNs/FCM as
// appropriate for each device -- no separate Apple/Google server credentials needed here.
// Owner-only: an actual send to every installed device is real, user-facing, and irreversible
// once sent, so this checks isAdminRequest before doing anything, same trust boundary as the
// provider-key config docs above.
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo's own documented cap per request -- https://docs.expo.dev/push-notifications/sending-
// notifications/#request-limits. Chunking client-side (well, server-side here) is required
// past this, not an arbitrary choice.
const EXPO_PUSH_CHUNK_SIZE = 100;

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

exports.broadcastNotification = onCall(async (request) => {
  if (!isAdminRequest(request)) {
    throw new HttpsError("permission-denied", "Only the app owner can send a broadcast notification.");
  }

  const title = typeof request.data?.title === "string" ? request.data.title.trim() : "";
  const body = typeof request.data?.body === "string" ? request.data.body.trim() : "";
  if (!title || !body) {
    return { outcome: "error", message: "Enter both a title and a message before sending." };
  }

  const db = getFirestore();
  const tokensSnap = await db.collection("deviceSessions").where("expoPushToken", "!=", null).get();

  // A device that has never granted notification permission (or hasn't opened the app since
  // this feature shipped) simply has no token yet -- excluded here rather than sent a
  // guaranteed-to-fail push, same "only ever act on real, present data" principle as every
  // other provider integration in this file.
  const tokens = tokensSnap.docs
    .map((d) => d.data().expoPushToken)
    .filter((t) => typeof t === "string" && t.startsWith("ExponentPushToken"));

  if (tokens.length === 0) {
    return { outcome: "error", message: "No devices have a registered push token yet." };
  }

  const messages = tokens.map((to) => ({ to, title, body, sound: "default" }));
  const batches = chunk(messages, EXPO_PUSH_CHUNK_SIZE);

  let sent = 0;
  let failed = 0;
  for (const batch of batches) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });
      const json = await res.json().catch(() => null);
      const tickets = Array.isArray(json?.data) ? json.data : [];
      for (const ticket of tickets) {
        if (ticket?.status === "ok") sent++;
        else failed++;
      }
      // A malformed/empty response from Expo for this whole batch (rather than a per-message
      // ticket) -- count every message in it as failed rather than silently dropping it from
      // the total.
      if (tickets.length !== batch.length) failed += batch.length - tickets.length;
    } catch (err) {
      console.error("broadcastNotification: Expo push request failed", err);
      failed += batch.length;
    }
  }

  await db.collection("broadcasts").add({
    title,
    body,
    sentBy: request.auth.token.email || request.auth.uid,
    sentAt: FieldValue.serverTimestamp(),
    recipientCount: tokens.length,
    sentCount: sent,
    failedCount: failed,
  });

  return {
    outcome: sent > 0 ? "success" : "error",
    message:
      sent > 0
        ? `Sent to ${sent} device${sent === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}.`
        : "The push service rejected every device -- try again shortly.",
    sentCount: sent,
    failedCount: failed,
  };
});

// =====================================================================
// Presence system (Tracky mood characters + Ghost mode, Part 3) -- real, explicit request: show
// other visible+driving users on the map via a `presence/{uid}` doc written ONLY through this
// server, snapped to the road network via a real third-party map-matching call (the user's own
// explicit choice: Mapbox Map Matching API, not Google Roads), published only after a
// server-enforced 60s privacy delay (ADD-ON Part B replaced Part 3's ~150m grid rounding with
// this -- grid-snapped points can't follow a road), and never containing raw GPS history -- this collection holds exactly one doc per user (the
// user's own CURRENT state, overwritten every call), never an append-only log, which is what
// actually makes "no uid-history queries" true: there's no history collection to query in the
// first place. See firestore.rules' own `match /presence/{uid}` block for the client-facing
// read/write rules this pairs with.
//
// This secret holds a real Mapbox access token (Map Matching works with a normal public-scope
// token -- it does NOT need to be the app's own client-side MAPBOX_PUBLIC_TOKEN, since EAS
// build-time secrets never reach this separate Cloud Functions runtime). Set once with
// `firebase functions:secrets:set MAPBOX_SERVER_TOKEN` -- see DEPLOY.md's own step for this.
const MAPBOX_SERVER_TOKEN = defineSecret("MAPBOX_SERVER_TOKEN");
/** The server Mapbox token, or null while it's the deploy's "unset" placeholder (or empty). */
function mapboxServerToken() {
  const v = String(MAPBOX_SERVER_TOKEN.value() || "").trim();
  return v && v !== "unset" ? v : null;
}
exports._mapboxServerTokenForTest = mapboxServerToken;

// Real, explicit request -- "only visible+driving... speed>15km/h."
const PRESENCE_MIN_SPEED_KMH = 15;
// "Never shown within 400 m of Home / Work / trip start / destination" (startup §3; it was 500 m).
// Also the night zone for drivers with no Home saved (trackysCore.shouldSetNightZone).
const PRESENCE_EXCLUSION_RADIUS_METERS = trackysCore.PRIVACY_ZONE_M;
// "Auto-deletes 2min after last update" -- both a real Firestore TTL field (see DEPLOY.md's own
// one-time `gcloud firestore fields ttl-policies create` step -- TTL policies aren't something
// firestore.rules/firebase.json can declare) AND the belt-and-suspenders cleanupExpiredPresence
// scheduled function below, same double-coverage convention as cleanupExpiredAlerts already
// uses for the `alerts` collection.
const PRESENCE_TTL_MS = 2 * 60 * 1000;
// Real, explicit request (ADD-ON Part B -- "60s privacy delay"). Enforced HERE, on the server,
// not left to each viewer's client to honour: a point is held in presencePending/{uid} (which no
// client can read at all, see firestore.rules) and only copied into the readable presence/{uid}
// doc once it is at least this old. A modified client reading presence/{uid} directly still
// can't learn where a driver is right now -- only where they were at least a minute ago. It
// also means the final minute before a driver stops is never published at all.
const PRESENCE_PRIVACY_DELAY_MS = 60 * 1000;
// How much already-published path a presence doc keeps -- enough for a viewer to keep animating
// smoothly across two consecutive one-minute batches, never a longer history than that.
const PRESENCE_PATH_KEEP_MS = 4 * 60 * 1000;
const PRESENCE_MAX_PATH_POINTS = 60;
const PRESENCE_MAX_POINTS_PER_BATCH = 24;
// The client samples its own GPS every 15s (see MapScreen.tsx); only used to space out a batch
// that arrives without per-sample ages.
const PRESENCE_SAMPLE_SPACING_MS = 15 * 1000;
const PRESENCE_MAX_SAMPLE_AGE_MS = 5 * 60 * 1000;

// Keep in sync with src/components/trackys/moods.ts's own TRACKY_MOOD_ORDER -- duplicated for
// the same cross-runtime reason as ADMIN_EMAILS above. Anything outside this whitelist is
// replaced with "happy" rather than rejecting the whole presence write over a cosmetic field.
const VALID_MOOD_KEYS = new Set([
  "happy", "chill", "excited", "sleepy", "hungry", "party", "focused", "lovestruck", "grumpy",
  "cool", "nerd", "spooky", "sporty", "musical", "rainy", "sunny", "aussieArvo", "birthday",
]);

async function deletePresenceDoc(db, uid) {
  await Promise.all([
    db.doc(`presence/${uid}`).delete().catch(() => {}),
    db.doc(`presencePending/${uid}`).delete().catch(() => {}),
  ]);
}

// Real, explicit request -- "Position written to Firestore presence/{uid} via Cloud Function
// ONLY", extended by ADD-ON Part B into a short, delayed, road-following PATH rather than one
// point. The client calls this about once a minute while driving and visible, with the GPS
// samples it took every 15s since its last call (each with how many ms ago it was taken, so
// nothing here depends on the phone's clock agreeing with the server's). This function:
//   1. map-matches the batch (Mapbox Map Matching matches a TRACE against the road network --
//      it has no single-point "nearest road" lookup) and keeps the matched road shape;
//   2. drops/withdraws anything near Home/Work/trip start/destination;
//   3. parks the new points in presencePending/{uid} and publishes only the ones already older
//      than PRESENCE_PRIVACY_DELAY_MS.
// One doc per uid, overwritten each call and trimmed to a few minutes -- still no history.
exports.updatePresence = onCall({ secrets: [MAPBOX_SERVER_TOKEN] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const uid = request.auth.uid;
  const db = getFirestore();
  const data = request.data || {};
  const now = Date.now();

  const rawSamples = (Array.isArray(data.samples) ? data.samples : []).filter((p) => p && isValidLatLng(p.lat, p.lng));
  if (rawSamples.length < 2) {
    throw new HttpsError("invalid-argument", "samples needs at least 2 real GPS points.");
  }
  const samples = rawSamples
    .map((p, i) => {
      const fallbackAge = (rawSamples.length - 1 - i) * PRESENCE_SAMPLE_SPACING_MS;
      const ageMs = typeof p.ageMs === "number" && Number.isFinite(p.ageMs) ? p.ageMs : fallbackAge;
      return { lat: p.lat, lng: p.lng, t: now - Math.min(Math.max(ageMs, 0), PRESENCE_MAX_SAMPLE_AGE_MS) };
    })
    .sort((a, b) => a.t - b.t);

  const speedKmh = typeof data.speedKmh === "number" ? data.speedKmh : 0;
  if (speedKmh < PRESENCE_MIN_SPEED_KMH) {
    // Not currently "driving" per the spec's own threshold -- withdraw any stale presence
    // rather than leave a last-known position showing a stopped/parked driver as still live.
    await deletePresenceDoc(db, uid);
    return { outcome: "not_driving" };
  }

  // Real, explicit request -- "never within 500m of Home/Work/trip start/destination." Home/
  // Work only exist server-side for a real signed-in (non-anonymous) account that has actually
  // synced them (see savedPlaces.ts's own pushSavedPlacesToProfile) -- an anonymous session's
  // Home/Work live only in that device's own AsyncStorage, which this server has no access to,
  // so this exclusion is honestly best-effort for anonymous users, not something faked here.
  const exclusionPoints = [];
  if (!request.auth.token.firebase?.sign_in_provider || request.auth.token.firebase.sign_in_provider !== "anonymous") {
    const userSnap = await db.doc(`users/${uid}`).get();
    const savedPlaces = userSnap.exists ? userSnap.data()?.savedPlaces : null;
    if (savedPlaces?.home?.location) exclusionPoints.push(savedPlaces.home.location);
    if (savedPlaces?.work?.location) exclusionPoints.push(savedPlaces.work.location);
  }
  // No Home saved: tonight's first stationary place is private too (set by noteActive).
  const zoneSnap = await db.doc(`privateZones/${uid}`).get();
  const nightZone = zoneSnap.exists ? zoneSnap.data()?.night : null;
  if (nightZone && typeof nightZone.latitude === "number" && typeof nightZone.longitude === "number") exclusionPoints.push(nightZone);
  const tripContext = data.tripContext || {};
  if (typeof tripContext.sourceLat === "number" && typeof tripContext.sourceLng === "number") {
    exclusionPoints.push({ latitude: tripContext.sourceLat, longitude: tripContext.sourceLng });
  }
  if (typeof tripContext.destLat === "number" && typeof tripContext.destLng === "number") {
    exclusionPoints.push({ latitude: tripContext.destLat, longitude: tripContext.destLng });
  }
  const isNearSensitiveLocation = (lat, lng) =>
    exclusionPoints.some(
      (p) =>
        typeof p.latitude === "number" &&
        typeof p.longitude === "number" &&
        haversineMeters(lat, lng, p.latitude, p.longitude) < PRESENCE_EXCLUSION_RADIUS_METERS
    );

  // The driver is inside an exclusion zone RIGHT NOW -- withdraw everything, including the
  // not-yet-published pending points that led here, rather than letting the approach play out.
  const current = samples[samples.length - 1];
  if (isNearSensitiveLocation(current.lat, current.lng)) {
    await deletePresenceDoc(db, uid);
    return { outcome: "suppressed_near_sensitive_location" };
  }

  let batch = samples;
  // No server token yet (the deploy creates an "unset" placeholder so everything else can go
  // live): skip the road-snapping and use the real fixes as they are.
  const mapboxToken = mapboxServerToken();
  if (mapboxToken) try {
    const coordinates = samples.map((p) => `${p.lng},${p.lat}`).join(";");
    const url =
      `https://api.mapbox.com/matching/v5/mapbox/driving/${coordinates}` +
      `?geometries=geojson&overview=full&access_token=${mapboxToken}`;
    const res = await fetch(url);
    const json = await res.json();
    const matchedCoords = json?.matchings?.[0]?.geometry?.coordinates;
    if (
      Array.isArray(matchedCoords) &&
      matchedCoords.length >= 2 &&
      matchedCoords.every((c) => Array.isArray(c) && isValidLatLng(c[1], c[0]))
    ) {
      batch = timeAlongGeometry(matchedCoords, samples[0].t, current.t);
    }
  } catch (err) {
    // A failed map-match is never a reason to refuse presence outright -- fall back to the raw
    // samples (straight lines between real fixes instead of the road shape), same
    // honest-degradation convention as this app's other optional third-party calls.
    console.warn("updatePresence: Mapbox Map Matching request failed", err);
  }

  const newPoints = downsample(batch, PRESENCE_MAX_POINTS_PER_BATCH)
    .filter((p) => !isNearSensitiveLocation(p.lat, p.lng))
    .map((p) => ({ lat: roundCoord(p.lat), lng: roundCoord(p.lng), t: Math.round(p.t) }));

  const pendingRef = db.doc(`presencePending/${uid}`);
  const presenceRef = db.doc(`presence/${uid}`);
  const [pendingSnap, presenceSnap] = await Promise.all([pendingRef.get(), presenceRef.get()]);

  const isFreshPoint = (p) => p && isValidLatLng(p.lat, p.lng) && typeof p.t === "number" && p.t >= now - PRESENCE_PATH_KEEP_MS;
  const previousPending = (pendingSnap.exists && Array.isArray(pendingSnap.data().points) ? pendingSnap.data().points : []).filter(isFreshPoint);
  const lastPendingT = previousPending.length > 0 ? previousPending[previousPending.length - 1].t : -Infinity;
  const allPending = [...previousPending, ...newPoints.filter((p) => p.t > lastPendingT)];

  const releaseBefore = now - PRESENCE_PRIVACY_DELAY_MS;
  const publishable = allPending.filter((p) => p.t <= releaseBefore);
  const stillPending = allPending.filter((p) => p.t > releaseBefore);

  await pendingRef.set({
    points: stillPending,
    expireAt: Timestamp.fromMillis(now + PRESENCE_TTL_MS),
  });

  const previousPath = (presenceSnap.exists && Array.isArray(presenceSnap.data().path) ? presenceSnap.data().path : []).filter(isFreshPoint);
  const lastPublishedT = previousPath.length > 0 ? previousPath[previousPath.length - 1].t : -Infinity;
  const path = [...previousPath, ...publishable.filter((p) => p.t > lastPublishedT)].slice(-PRESENCE_MAX_PATH_POINTS);

  if (path.length === 0) {
    // Nothing is old enough to show yet (the first minute of a trip) -- a real, expected state.
    return { outcome: "buffering" };
  }

  const last = path[path.length - 1];
  // Heading comes from the PUBLISHED path, never from the phone's live compass -- the live
  // heading is "right now" information, exactly what the privacy delay exists to withhold.
  let headingDeg = null;
  for (let i = path.length - 2; i >= 0; i--) {
    if (haversineMeters(path[i].lat, path[i].lng, last.lat, last.lng) > 3) {
      headingDeg = Math.round(bearingDegrees(path[i].lat, path[i].lng, last.lat, last.lng));
      break;
    }
  }

  const presenceDoc = {
    lat: last.lat,
    lng: last.lng,
    // For viewport queries (the map loads the Trackys in view by geohash cell).
    geohash: require("./reports/core").encodeGeohash(last.lat, last.lng, trackysCore.PRESENCE_GEOHASH_PRECISION),
    headingDeg,
    mood: VALID_MOOD_KEYS.has(data.mood) ? data.mood : "happy",
    path,
    // Server clock, ms -- viewers time their playback off this plus their own locally-measured
    // elapsed time since the doc arrived, so no two devices' clocks ever need to agree.
    w: now,
    updatedAt: FieldValue.serverTimestamp(),
    // Real Firestore TTL field -- see this section's own header comment for why the policy
    // itself is a one-time manual gcloud step rather than something deployed from this repo.
    expireAt: Timestamp.fromMillis(now + PRESENCE_TTL_MS),
  };
  const look = sanitizeLook(data.look);
  if (look) presenceDoc.look = look;
  // Only ever included when the driver has explicitly opted in (settings.showNameOnReports) AND
  // a real verified name actually exists on their Firebase Auth token -- omitted entirely
  // (never an empty string) otherwise, so a client reading this doc can't tell the difference
  // between "chose to stay anonymous" and "has no name on file".
  if (data.allowName === true && typeof request.auth.token.name === "string" && request.auth.token.name.trim()) {
    presenceDoc.displayName = request.auth.token.name.trim();
  }

  await presenceRef.set(presenceDoc);
  return { outcome: "success" };
});

// Real, explicit request -- the other half of "auto-deletes... immediately on arrival/ghost
// mode." Called directly by the client the instant a trip ends or Ghost mode turns on, rather
// than waiting out the TTL/scheduled cleanup below for what's really an immediate, deliberate
// withdrawal. Also discards the not-yet-published pending points.
exports.clearPresence = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  await deletePresenceDoc(getFirestore(), request.auth.uid);
  return { outcome: "success" };
});

/**
 * Belt-and-suspenders cleanup alongside the real Firestore TTL policy on expireAt -- same
 * batched-delete pattern as cleanupExpiredAlerts above, for both the published docs and the
 * private pending buffer. A driver who force-quits mid-trip (no clearPresence call, no further
 * updatePresence calls either) is exactly the real case this covers.
 */
exports.cleanupExpiredPresence = onSchedule("every 2 minutes", async () => {
  const db = getFirestore();
  const now = Timestamp.now();

  let deletedTotal = 0;
  for (const collectionName of ["presence", "presencePending"]) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const snapshot = await db.collection(collectionName).where("expireAt", "<=", now).limit(BATCH_SIZE).get();
      if (snapshot.empty) break;

      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      deletedTotal += snapshot.size;
      if (snapshot.size < BATCH_SIZE) break;
    }
  }

  console.log(`cleanupExpiredPresence: removed ${deletedTotal} expired presence doc(s)`);
});

// Real, explicit request -- "[Wave 👋] rate-limited 1/10min/blockable." Server-enforced (a
// client-only cooldown could just be bypassed by reinstalling or clearing app storage) via a
// real per-sender-per-target rate-limit doc, and a real check of the TARGET's own block list
// before ever attempting delivery -- a blocked sender gets the same "success" outcome a
// delivered wave would (see this function's own comment below for why that's a deliberate
// privacy choice, not an oversight).
const WAVE_COOLDOWN_MS = 10 * 60 * 1000;

exports.sendWave = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const selfUid = request.auth.uid;
  const targetUid = typeof request.data?.targetUid === "string" ? request.data.targetUid : "";
  if (!targetUid || targetUid === selfUid) {
    throw new HttpsError("invalid-argument", "targetUid must be a different real uid.");
  }

  const db = getFirestore();

  const cooldownRef = db.doc(`waves/${selfUid}_${targetUid}`);
  const cooldownSnap = await cooldownRef.get();
  const lastSentAt = cooldownSnap.exists ? cooldownSnap.data()?.lastSentAt?.toMillis?.() : null;
  if (typeof lastSentAt === "number" && Date.now() - lastSentAt < WAVE_COOLDOWN_MS) {
    return { outcome: "rate_limited" };
  }

  // The target must still have a live presence doc -- waving at a driver who's since gone
  // ghost/stopped driving/force-quit the app would otherwise silently reach a push token for
  // someone no longer actually shown on anyone's map.
  const presenceSnap = await db.doc(`presence/${targetUid}`).get();
  if (!presenceSnap.exists) {
    return { outcome: "target_not_visible" };
  }

  // Always record the attempt (so the rate limit holds even against a blocked/no-token target
  // -- otherwise a sender could keep retrying a blocked wave at full speed) before checking the
  // block list, which is checked last and deliberately never distinguished in the response from
  // a real delivery, so the sender can never use this call to confirm they've been blocked.
  await cooldownRef.set({ lastSentAt: FieldValue.serverTimestamp() });

  const blockSnap = await db.doc(`blocks/${targetUid}`).get();
  const blockedUids = blockSnap.exists ? blockSnap.data()?.blockedUids : null;
  if (Array.isArray(blockedUids) && blockedUids.includes(selfUid)) {
    return { outcome: "success" };
  }

  const deviceSnap = await db.doc(`deviceSessions/${targetUid}`).get();
  const token = deviceSnap.exists ? deviceSnap.data()?.expoPushToken : null;
  if (typeof token !== "string" || !token.startsWith("ExponentPushToken")) {
    return { outcome: "no_token" };
  }

  try {
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify([{ to: token, title: "👋", body: "A nearby driver waved at you!", sound: "default" }]),
    });
  } catch (err) {
    console.error("sendWave: Expo push request failed", err);
    return { outcome: "error" };
  }

  return { outcome: "success" };
});

// ------------------------------------------------------------------------------------------
// Character voices ("Matilda", "Aussie Footy Fan", "Sarcastic Co-pilot", "Dry Wit").
//
// The app sends one navigation sentence and a character; this returns that sentence as audio,
// synthesized by ElevenLabs. Each sentence is synthesized ONCE and kept in Cloud Storage, shared
// by every driver -- "turn left onto George Street" costs the first person to hear it and
// nobody after. The app also keeps its own copy (src/services/personaSpeech.ts).
//
// The ElevenLabs key is a Cloud Functions secret and never leaves the server. Until it's set
// (it may hold the deploy workflow's "unset" placeholder -- see personaCore.secretIsSet) both
// functions say so plainly and the app keeps these voices locked.
const ELEVENLABS_API_KEY = defineSecret("ELEVENLABS_API_KEY");
const ELEVENLABS_MODEL = defineString("ELEVENLABS_MODEL", { default: "eleven_multilingual_v2" });
// Which ElevenLabs voice each character speaks with. The defaults are ElevenLabs' own stock
// voices, chosen by ear from their public library -- NOT verified against a live account from
// this codebase, because no key has ever been available here. If one is wrong ElevenLabs
// rejects the request, the function reports "failed", and the app falls back to the phone's
// voice. Override any of them (e.g. with a voice from your own ElevenLabs library) in
// firebase/functions/.env -- see DEPLOY.md.
const PERSONA_ELEVENLABS_VOICE = {
  matilda: defineString("ELEVENLABS_VOICE_MATILDA", { default: "XrExE9yKIg1WjnnlVkGX" }),
  footy_fan: defineString("ELEVENLABS_VOICE_FOOTY_FAN", { default: "IKne3meq5aSn9XLyUdCD" }),
  sarcastic_copilot: defineString("ELEVENLABS_VOICE_SARCASTIC_COPILOT", { default: "onwK4e9ZLuTAKqWW03F9" }),
  dry_wit: defineString("ELEVENLABS_VOICE_DRY_WIT", { default: "JBFqnCBsd6RMkjVDRZzb" }),
};

exports.personaVoicesStatus = onCall({ secrets: [ELEVENLABS_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return { available: personaCore.secretIsSet(ELEVENLABS_API_KEY.value()) };
});

exports.synthesizePersonaSpeech = onCall({ secrets: [ELEVENLABS_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const valid = personaCore.validateRequest(request.data);
  if (!valid) {
    throw new HttpsError("invalid-argument", "A known personaId and a short plain-text sentence are required.");
  }
  const apiKey = ELEVENLABS_API_KEY.value();
  if (!personaCore.secretIsSet(apiKey)) {
    return { status: "not_configured" };
  }

  const { personaId, text } = valid;
  const voiceId = PERSONA_ELEVENLABS_VOICE[personaId].value();
  const modelId = ELEVENLABS_MODEL.value();
  const path = personaCore.cachePath(personaId, voiceId, modelId, text);

  // Shared cache first. A cache problem must never stop a sentence being spoken, so any error
  // here just falls through to synthesizing it.
  let cacheFile = null;
  try {
    cacheFile = getStorage().bucket().file(path);
    const [exists] = await cacheFile.exists();
    if (exists) {
      const [bytes] = await cacheFile.download();
      return { status: "ok", audioBase64: bytes.toString("base64"), cached: true };
    }
  } catch (err) {
    console.warn("[persona] cache read failed", String(err));
    cacheFile = null;
  }

  // A new sentence costs money, so it counts against this driver's daily allowance.
  const db = getFirestore();
  const usageRef = db.doc(`personaUsage/${request.auth.uid}`);
  const now = Date.now();
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const used = personaCore.usageToday(snap.exists ? snap.data() : null, now);
    if (used >= personaCore.DAILY_NEW_SENTENCE_LIMIT) return false;
    tx.set(usageRef, { day: personaCore.utcDayKey(now), count: used + 1 });
    return true;
  });
  if (!allowed) {
    return { status: "limit_reached" };
  }

  let audio;
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: modelId }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      // The status alone -- never the response body or anything derived from the key.
      console.warn("[persona] ElevenLabs request failed", response.status);
      return { status: "failed" };
    }
    audio = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.warn("[persona] ElevenLabs request errored", err && err.name);
    return { status: "failed" };
  }

  if (cacheFile) {
    cacheFile
      .save(audio, { contentType: "audio/mpeg", resumable: false })
      .catch((err) => console.warn("[persona] cache write failed", String(err)));
  }
  return { status: "ok", audioBase64: audio.toString("base64"), cached: false };
});

// ------------------------------------------------------------------------------------------
// Live Traffic NSW.
//
// Every five minutes this fetches Transport for NSW's live hazard feeds (crashes, heavy
// traffic, breakdowns, roadworks, major events, floods, fires) and writes them as ONE document,
// trafficNsw/current, which every phone reads. Fetching here rather than on each phone means
// the API key never ships in the app, and a thousand drivers cost the same handful of TfNSW
// calls as one.
//
// Until the key is set (it may hold the deploy workflow's "unset" placeholder) the document
// just says { configured: false }, and the app shows the layer as not set up.
const TFNSW_API_KEY = defineSecret("TFNSW_API_KEY");
const TRAFFIC_NSW_DOC = "trafficNsw/current";

async function refreshNswTrafficSnapshot() {
  const db = getFirestore();
  const ref = db.doc(TRAFFIC_NSW_DOC);
  const apiKey = TFNSW_API_KEY.value();

  if (!personaCore.secretIsSet(apiKey)) {
    const existing = await ref.get();
    // Written once, not every five minutes: nothing changes until a key is added.
    if (!existing.exists || existing.data().configured !== false) {
      await ref.set({ configured: false, checkedAt: Date.now(), incidents: [] });
    }
    return { configured: false, count: 0, failedKinds: [] };
  }

  const results = await Promise.all(
    trafficCore.FEEDS.map(async (feed) => {
      try {
        const response = await fetch(trafficCore.feedUrl(feed.path), {
          headers: { Authorization: `apikey ${apiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) {
          // The status alone -- never the response body or anything derived from the key.
          console.warn("[trafficNsw] feed failed", feed.kind, response.status);
          return { kind: feed.kind, ok: false, incidents: [] };
        }
        return { kind: feed.kind, ok: true, incidents: trafficCore.parseFeed(await response.json(), feed.kind) };
      } catch (err) {
        console.warn("[trafficNsw] feed errored", feed.kind, err && err.name);
        return { kind: feed.kind, ok: false, incidents: [] };
      }
    })
  );

  const previousSnap = await ref.get();
  const snapshot = trafficCore.buildSnapshot(results, previousSnap.exists ? previousSnap.data() : null, Date.now());
  await ref.set(snapshot);
  // Crash history: each official crash incident recorded once (same id = same doc).
  const records = crashRecords.recordsFromIncidents(snapshot.incidents, Date.now());
  for (let i = 0; i < records.length; i += 400) {
    const batch = db.batch();
    for (const r of records.slice(i, i + 400)) {
      const { id, atMs, expiresAtMs, ...rest } = r;
      batch.set(db.collection("crashRecords").doc(id), { ...rest, at: Timestamp.fromMillis(atMs), expiresAt: Timestamp.fromMillis(expiresAtMs) }, { merge: true });
    }
    await batch.commit();
  }
  return { configured: true, count: snapshot.incidents.length, failedKinds: snapshot.failedKinds };
}

// Live/late for the transit rides the app shows (functions/tfnswTrip.js). Each ride is looked up
// with its own origin/destination stop and departure time; results are only ever TfNSW's.
exports.transitRealtime = onCall({ secrets: [TFNSW_API_KEY], timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const apiKey = TFNSW_API_KEY.value();
  if (!personaCore.secretIsSet(apiKey)) return { configured: false, realtime: [] };
  const rides = tfnswTrip.cleanRides(request.data && request.data.rides);
  const realtime = await Promise.all(
    rides.map(async (r) => {
      if (![r.from.lat, r.from.lng, r.to.lat, r.to.lng, r.departureTimeMs].every(Number.isFinite)) return null;
      try {
        const res = await fetch(tfnswTrip.tripUrl({ from: r.from, to: r.to, departMs: r.departureTimeMs - 5 * 60_000 }), {
          headers: { Authorization: `apikey ${apiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return null;
        return tfnswTrip.matchRealtime(tfnswTrip.parseLegs(await res.json()), [r])[0];
      } catch {
        return null;
      }
    })
  );
  return { configured: true, realtime };
});

exports.refreshNswTraffic = onSchedule(
  { schedule: "every 5 minutes", secrets: [TFNSW_API_KEY], timeoutSeconds: 60 },
  async () => {
    await refreshNswTrafficSnapshot();
  }
);

// The same refresh, on demand, for the project owner only -- so that after adding the key
// there's a way to see it work straight away instead of waiting for the next scheduled run.
// Returns counts and which feeds failed; never the key or any response body.
exports.refreshNswTrafficNow = onCall({ secrets: [TFNSW_API_KEY] }, async (request) => {
  if (!isAdminRequest(request)) {
    throw new HttpsError("permission-denied", "Owner only.");
  }
  return refreshNswTrafficSnapshot();
});


// ---- NSW FuelCheck live prices (petrol stations sheet) ----
// The app asks for prices near a point for one fuel type; the keys stay here. Signed-in users
// only, and answers are cached for 5 minutes per rounded area + fuel type to stay well inside
// the API's limits. "unset" placeholder keys answer { configured: false } so the app can say
// prices aren't available rather than showing nothing.
const FUELCHECK_API_KEY = defineSecret("FUELCHECK_API_KEY");
const FUELCHECK_API_SECRET = defineSecret("FUELCHECK_API_SECRET");
const fuelPriceCache = new Map();

exports.fuelPricesNearby = onCall({ secrets: [FUELCHECK_API_KEY, FUELCHECK_API_SECRET], timeoutSeconds: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const key = FUELCHECK_API_KEY.value();
  const secret = FUELCHECK_API_SECRET.value();
  if (!fuelCheckCore.isConfigured(key, secret)) return { configured: false, stations: [] };
  const req = fuelCheckCore.parseRequest(request.data);
  if (req.error) return { configured: true, stations: [], error: req.error };
  const cacheKey = `${req.lat.toFixed(2)},${req.lng.toFixed(2)},${req.radiusKm},${req.fuelType}`;
  const hit = fuelPriceCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 5 * 60_000) return { configured: true, stations: hit.stations };
  try {
    const stations = await fuelCheckCore.fetchNearbyPrices({ key, secret, request: req, fetchImpl: fetch, nowMs: Date.now(), uuid: require("crypto").randomUUID() });
    fuelPriceCache.set(cacheKey, { at: Date.now(), stations });
    return { configured: true, stations };
  } catch (err) {
    console.warn("fuelPricesNearby: lookup failed", err && err.message);
    return { configured: true, stations: [], error: err && err.message ? err.message : "FuelCheck didn't answer" };
  }
});

// ---- Driver-reported fuel prices (gap item 18) ----
// A driver at a station reports what the sign says. Shown in the app only once 3 different drivers
// agree within 2 cents in 24 h (fuelUserPricesCore.js). Only this function writes fuelUserPrices.
const fuelUserPricesCore = require("./fuelUserPricesCore");
exports.reportFuelPrice = onCall({ timeoutSeconds: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const r = fuelUserPricesCore.parseReport(request.data);
  if (r.error) throw new HttpsError("invalid-argument", r.error);
  const ref = getFirestore().collection("fuelUserPrices").doc(fuelUserPricesCore.docId(r.placeId, r.fuelType));
  try {
    const out = await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = fuelUserPricesCore.applyReport(snap.exists ? snap.data() : null, { uid: request.auth.uid, cents: r.cents }, Date.now());
      tx.set(ref, { ...next, placeId: r.placeId, fuelType: r.fuelType, name: r.name, lat: r.stationLat, lng: r.stationLng });
      return next;
    });
    return { confirmed: out.confirmed, reports: out.reports.length, needed: fuelUserPricesCore.CONFIRMATIONS };
  } catch (err) {
    if (err && err.code === "resource-exhausted") throw new HttpsError("resource-exhausted", err.message);
    throw err;
  }
});

// ---- Smart exit gates (fix pass 7 §1) ----
// "Is the exit on <road> open?": a driver's answer, anonymous (hashed), building each exit's
// pattern by time of day (siteExitsCore.js). Clients can read siteExits but never write it.
const siteExitsCore = require("./siteExitsCore");

exports.answerSiteExit = onCall({ timeoutSeconds: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const a = siteExitsCore.parseAnswer(request.data);
  if (a.error) throw new HttpsError("invalid-argument", a.error);
  const ref = getFirestore().collection("siteExits").doc(a.gateId);
  const voter = siteExitsCore.voterKey(request.auth.uid, a.gateId);
  const out = await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = siteExitsCore.applyAnswer(snap.exists ? snap.data() : null, { ...a, voter }, Date.now());
    tx.set(ref, next);
    return next;
  });
  return { pattern: out.patterns[a.bucket] || null, summary: out.summary, answers: out.answers.length };
});

// The dashboard's list of exits and opening hours: the adminModeration section (admin/moderation.js).

// ---- Planned drives (Plan a drive) ----
// Every 5 minutes: drives due within 30 minutes that haven't had their reminder get one traffic
// re-check (Google Routes API, the same server key as badge popularity) and one push with the
// up-to-date leave time. If the re-check fails, the reminder still goes, with the planned times
// and saying traffic couldn't be refreshed.
exports.refreshPlannedDrives = onSchedule(
  { schedule: "every 5 minutes", secrets: [GOOGLE_PLACES_SERVER_KEY], timeoutSeconds: 120 },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    const snap = await db
      .collectionGroup("plannedDrives")
      .where("reminded", "==", false)
      .where("leaveAtMs", "<=", now + plannedDrivesCore.RECHECK_LEAD_MS)
      .limit(200)
      .get();
    for (const docSnap of snap.docs) {
      const drive = docSnap.data();
      if (!plannedDrivesCore.isDue(drive, now)) {
        // Too late to be useful: mark it so it isn't picked up again.
        await docSnap.ref.update({ reminded: true });
        continue;
      }
      const predict = plannedDrivesCore.routesPredictor(GOOGLE_PLACES_SERVER_KEY.value(), fetch, now, drive);
      const { message, update } = await plannedDrivesCore.handleDrive(drive, now, predict);
      await docSnap.ref.update(update);
      const uid = docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : null;
      if (!uid) continue;
      // "Tell me when to leave" off: times are still refreshed, but no push.
      const profile = await db.doc(`users/${uid}`).get();
      if (profile.exists && profile.data()?.plannedDriveReminders === false) continue;
      const device = await db.doc(`deviceSessions/${uid}`).get();
      const token = device.exists ? device.data()?.expoPushToken : null;
      if (typeof token !== "string" || !token.startsWith("ExponentPushToken")) continue;
      try {
        await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify([{ to: token, title: message.title, body: message.body, sound: "default", data: { kind: "plannedDrive", driveId: docSnap.id } }]),
        });
      } catch (err) {
        console.error("refreshPlannedDrives: push failed", err && err.message);
      }
    }
  }
);

// ---- School zones (official data) ----
// Every Monday: Transport for NSW's School Zones data (CC BY 4.0, regenerated weekly) ->
// schoolZoneTiles/{tile} (0.1 degree tiles, polygons as encoded polylines) and the NSW calendar
// -> schoolCalendars/AU-NSW (terms from the same data + the official NSW public holidays).
// Phones read the tiles around them and cache them (src/schoolZones/zoneStore.ts). A failed
// download changes nothing: the last good data stays (phones re-check it within 30 days).
const NSW_SCHOOL_ZONES_ZIP =
  "https://opendata.transport.nsw.gov.au/data/dataset/4253a054-b377-4b5b-83d1-71385bb6ff33/resource/b6d7d02c-5625-461c-8b44-bba1a6ef3e0f/download/schoolzones.zip";

async function refreshNswSchoolZones() {
  const { unzipSync, strFromU8 } = require("fflate");
  const response = await fetch(NSW_SCHOOL_ZONES_ZIP, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`school zones download: ${response.status}`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const name = Object.keys(files).find((f) => /schoolzones\.json$/i.test(f));
  if (!name) throw new Error("school zones: SchoolZones.json not in the archive");
  const built = schoolZonesCore.buildTiles(JSON.parse(strFromU8(files[name])));
  if (built.count < 1000) throw new Error(`school zones: only ${built.count} zones read -- not replacing good data`);

  const db = getFirestore();
  const updatedAt = Date.now();
  const meta = { region: "AU-NSW", source: schoolZonesCore.SOURCE, sourceUrl: schoolZonesCore.SOURCE_URL, generated: built.generated, updatedAt };
  const keys = Object.keys(built.tiles);
  for (let i = 0; i < keys.length; i += 400) {
    const batch = db.batch();
    for (const k of keys.slice(i, i + 400)) batch.set(db.doc(`schoolZoneTiles/${k}`), { ...meta, tile: k, zones: built.tiles[k] });
    await batch.commit();
  }
  // Tiles that no longer have a zone (a zone removed from the official data) are emptied.
  // One range filter only (single-field index, which Firestore has automatically); the region
  // is checked here. Equality + range on two fields would need a composite index.
  const staleSnap = await db.collection("schoolZoneTiles").where("updatedAt", "<", updatedAt).get();
  const stale = staleSnap.docs.filter((d) => d.get("region") === "AU-NSW");
  for (let i = 0; i < stale.length; i += 400) {
    const batch = db.batch();
    for (const d of stale.slice(i, i + 400)) batch.set(d.ref, { ...meta, tile: d.id, zones: [] });
    await batch.commit();
  }
  const calendar = schoolZonesCore.nswCalendar(built.terms, built.lateTerms, nswPublicHolidays);
  if (calendar) await db.doc("schoolCalendars/AU-NSW").set({ ...calendar, updatedAt });
  await db.doc("dataSources/schoolZones-AU-NSW").set({ ...meta, zones: built.count, skipped: built.skipped, tiles: keys.length, calendarValidTo: calendar ? calendar.validTo : null });
  return { zones: built.count, skipped: built.skipped, tiles: keys.length };
}

exports.refreshSchoolZones = onSchedule({ schedule: "every monday 03:17", timeZone: "Australia/Sydney", timeoutSeconds: 540, memory: "1GiB" }, async () => {
  const result = await refreshNswSchoolZones();
  console.log("[schoolZones] NSW refreshed", result);
});

// ---- Driver reports: missing / wrong school zones and wrong speed limits (roadReportsCore.js) ----
// A confirmation from another driver: recount, and go live at 3. Admin approval/rejection is an
// update to the report itself (Firebase console), handled by syncRoadReport below.
exports.confirmRoadReport = onDocumentCreated("roadFeatureReports/{reportId}/confirmations/{uid}", async (event) => {
  const db = getFirestore();
  const reportRef = db.doc(`roadFeatureReports/${event.params.reportId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reportRef);
    if (!snap.exists) return;
    const report = snap.data();
    const confirmations = await tx.get(reportRef.collection("confirmations"));
    const uids = confirmations.docs.map((d) => d.id);
    const status = roadReportsCore.nextStatus(report, uids);
    const confirmCount = roadReportsCore.countConfirmations(report.reportedBy, uids);
    tx.update(reportRef, { confirmCount, status, ...(status !== report.status ? { statusChangedAt: FieldValue.serverTimestamp() } : {}) });
  });
});

// Keep the public communityRoadFeatures record in step with the report's status: written when a
// missing-zone report is live/approved, removed when it's rejected or deleted.
exports.syncRoadReport = onDocumentWritten("roadFeatureReports/{reportId}", async (event) => {
  const id = event.params.reportId;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  const feature = after ? roadReportsCore.toCommunityFeature(id, after) : null;
  const ref = getFirestore().doc(`communityRoadFeatures/${id}`);
  if (feature) await ref.set({ ...feature, updatedAt: FieldValue.serverTimestamp() });
  else await ref.delete().catch(() => {});
});

// ---------------------------------------------------------------------------------------------
// Vehicle full check (one paid product, "full_check"). All logic is in vehicleCheck/ -- these
// are the three callables the app uses. Keys only as Firebase secrets; the deploy workflow
// creates "unset" placeholders, and while any provider is a stub or unkeyed the check is not
// sold (getVehicleCheckInfo.available = false and the app hides it in production).
const vehicleCheckCore = require("./vehicleCheck/core");
const vehicleCheckProviders = require("./vehicleCheck/providers");
const vehicleCheckConfig = require("./vehicleCheck/config");
const { firestoreStore: vehicleCheckStore } = require("./vehicleCheck/store");
const { verifyPurchase: verifyVehiclePurchase } = require("./vehicleCheck/receipts");
// Provider keys: Firebase secrets only, read only here (see PROVIDERS.md / DEPLOY.md).
const VEHICLE_CHECK_SECRET_NAMES = ["CARJAM_API_KEY", "AUCN_API_KEY", "MOTORWEB_API_KEY", "EQUIFAX_API_KEY", "PPSR_API_KEY", "PPSR_BUSINESSAPI_KEY"];
const VEHICLE_CHECK_SECRETS = VEHICLE_CHECK_SECRET_NAMES.map((n) => defineSecret(n));

async function vehicleCheckDeps() {
  const db = getFirestore();
  const snap = await db.doc("config/vehicleCheck").get().catch(() => null);
  return {
    store: vehicleCheckStore(db, FieldValue),
    configOverride: snap && snap.exists ? snap.data() : null,
    keys: Object.fromEntries(VEHICLE_CHECK_SECRET_NAMES.map((n, i) => [n, VEHICLE_CHECK_SECRETS[i].value()])),
    fetchImpl: fetch,
    verifyPurchase: verifyVehiclePurchase,
    sleep,
  };
}

// Whether it's on sale, the price label, and how many free re-checks this user has.
exports.getVehicleCheckInfo = onCall({ secrets: VEHICLE_CHECK_SECRETS }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const deps = await vehicleCheckDeps();
  const config = vehicleCheckConfig.mergeConfig(deps.configOverride);
  const { available, missing, sections } = vehicleCheckProviders.availability(config, deps.keys);
  const owner = isAdminRequest(request);
  return {
    available,
    // Only the owner sees what's missing and each section's provider status.
    missing: owner ? missing : undefined,
    sections: owner ? sections : undefined,
    enabled: config.enabled,
    productId: config.productId,
    priceAud: config.priceAud,
    countries: ["AU"],
    credits: await deps.store.getCredits(request.auth.uid),
  };
});

exports.runVehicleCheck = onCall(
  { secrets: VEHICLE_CHECK_SECRETS, timeoutSeconds: 180, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const deps = await vehicleCheckDeps();
    const config = vehicleCheckConfig.mergeConfig(deps.configOverride);
    if (!vehicleCheckProviders.availability(config, deps.keys).available) {
      return { outcome: "not_available", message: "The full check isn't available yet." };
    }
    const data = request.data || {};
    return vehicleCheckCore.runFullCheck(
      {
        uid: request.auth.uid,
        isAdmin: isAdminRequest(request),
        input: { country: data.country, plate: data.plate, state: data.state, vin: data.vin },
        payment: data.useCredit ? { type: "credit" } : { type: "purchase", platform: data.platform, token: data.purchaseToken, productId: data.productId },
        requestId: data.requestId,
      },
      deps
    );
  }
);

exports.retryVehicleCheckSection = onCall(
  { secrets: VEHICLE_CHECK_SECRETS, timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const deps = await vehicleCheckDeps();
    const data = request.data || {};
    if (!vehicleCheckCore.REPORT_ID_RE.test(String(data.reportId || ""))) return { outcome: "invalid", reason: "bad_report_id" };
    return vehicleCheckCore.retrySection({ uid: request.auth.uid, reportId: data.reportId, section: String(data.section || "") }, deps);
  }
);

// ---- Owner dashboard, account recovery, guest data (firebase/functions/admin/, ADMIN.md) ----
// Every dashboard call is a section callable that checks the caller's role claim per operation,
// requires a second factor, and writes the append-only audit log.
Object.assign(
  exports,
  require("./admin").register({
    onCall,
    onSchedule,
    onDocumentCreated,
    HttpsError,
    getFirestore,
    getAuth: () => require("firebase-admin/auth").getAuth(),
    FieldValue,
    defineSecret,
    reportStore,
    POLICY: reportsCore.POLICY,
    TFNSW_API_KEY,
    jobs: { refreshSchoolZones: refreshNswSchoolZones, resyncHazards: refreshNswTrafficSnapshot },
    authV1: require("firebase-functions/v1").auth,
  })
);


// =====================================================================
// "N Trackys around you" (startup §2) + tonight's private zone (startup §3).
//
// noteActive: the app says "I'm using TrackLine" on open, on coming back, and every 5 min while
// open. Stored in activity/{uid} (no client can read it) with the position rounded to ~1 km,
// for counting only -- ghost-mode users too, as a number. It expires after 15 min. With no Home
// saved, the first stationary place tonight becomes a private zone (privateZones/{uid}).
exports.noteActive = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = request.auth.uid;
  const d = request.data || {};
  if (!trackysCore.isCoord(d.lat, d.lng)) throw new HttpsError("invalid-argument", "lat/lng required.");
  const db = getFirestore();
  const now = Date.now();
  await db.doc(`activity/${uid}`).set({
    ...trackysCore.activityDoc({ lat: d.lat, lng: d.lng, ghost: d.ghost === true, now }),
    expireAt: Timestamp.fromMillis(now + trackysCore.ACTIVE_WINDOW_MS),
  });
  let nightZoneSet = false;
  const localHour = typeof d.localHour === "number" ? d.localHour : null;
  const key = trackysCore.nightKey(d.localDate, localHour);
  if (key && trackysCore.isNightHour(localHour) && d.stationary === true) {
    let hasHome = false;
    if (request.auth.token.firebase?.sign_in_provider !== "anonymous") {
      const userSnap = await db.doc(`users/${uid}`).get();
      hasHome = !!(userSnap.exists && userSnap.data()?.savedPlaces?.home?.location);
    }
    const zoneRef = db.doc(`privateZones/${uid}`);
    const zone = await zoneRef.get();
    if (trackysCore.shouldSetNightZone({ hasHome, localHour, stationary: true, dayKey: key, existingDayKey: zone.exists ? zone.data()?.nightKey : null })) {
      await zoneRef.set({ night: { latitude: d.lat, longitude: d.lng }, nightKey: key, setAt: now });
      nightZoneSet = true;
    }
  }
  return { ok: true, nightZoneSet };
});

// trackysAround: the rounded count around a point, computed here from geohash cells (never by
// the app downloading anyone's position), cached 60 s per ~1 km cell.
exports.trackysAround = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const d = request.data || {};
  if (!trackysCore.isCoord(d.lat, d.lng)) throw new HttpsError("invalid-argument", "lat/lng required.");
  const db = getFirestore();
  const now = Date.now();
  const cacheKey = require("./reports/core").encodeGeohash(d.lat, d.lng, 6);
  const cacheRef = db.doc(`trackysCountCache/${cacheKey}`);
  const cached = await cacheRef.get();
  if (cached.exists && now - (cached.data().computedAt ?? 0) < trackysCore.COUNT_CACHE_MS) {
    return { ...cached.data().result, cached: true };
  }
  // Smallest area first, widening only when it has too few people (10 km on geohash-4 cells,
  // 25/50 km on geohash-3, the region on geohash-2): a busy city never reads the whole state.
  let result = null;
  for (const precision of [4, 3, 2]) {
    const field = `gh${precision}`;
    const cells = trackysCore.cellAndNeighbours(d.lat, d.lng, precision);
    const people = [];
    for (let i = 0; i < cells.length; i += 10) {
      const snap = await db
        .collection("activity")
        .where(field, "in", cells.slice(i, i + 10))
        .where("lastActive", ">=", now - trackysCore.ACTIVE_WINDOW_MS)
        .select("lat", "lng", "lastActive")
        .get();
      snap.forEach((doc) => people.push({ uid: doc.id, ...doc.data() }));
    }
    const steps = trackysCore.AREA_STEPS_KM.filter((km) => trackysCore.STEP_PRECISION[km] === precision);
    const counts = trackysCore.countSteps({ lat: d.lat, lng: d.lng }, people, now, request.auth.uid);
    const enough = steps.find((km) => counts[km] >= trackysCore.MIN_USERS_FOR_AREA);
    const last = precision === 2;
    if (enough || last) {
      const km = enough ?? steps[steps.length - 1];
      result = { ...trackysCore.roundCount(counts[km]), radiusKm: km };
      break;
    }
  }
  await cacheRef.set({ computedAt: now, result, expireAt: Timestamp.fromMillis(now + 10 * 60 * 1000) });
  return { ...result, cached: false };
});
