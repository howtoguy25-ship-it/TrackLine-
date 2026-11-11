const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
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

// Real, explicit request -- "only visible+driving... speed>15km/h."
const PRESENCE_MIN_SPEED_KMH = 15;
// "Never shown within 500m of Home/Work/trip start/destination."
const PRESENCE_EXCLUSION_RADIUS_METERS = 500;
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
  try {
    const coordinates = samples.map((p) => `${p.lng},${p.lat}`).join(";");
    const url =
      `https://api.mapbox.com/matching/v5/mapbox/driving/${coordinates}` +
      `?geometries=geojson&overview=full&access_token=${MAPBOX_SERVER_TOKEN.value()}`;
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
