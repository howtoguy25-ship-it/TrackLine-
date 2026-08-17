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
