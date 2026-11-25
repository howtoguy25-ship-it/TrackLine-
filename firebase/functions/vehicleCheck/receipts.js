// Server-side purchase verification, done BEFORE any paid provider is called.
//
// iOS: the app sends StoreKit 2's signed transaction (react-native-iap's `purchaseToken` on iOS
// is the JWS). Apple's own library (@apple/app-store-server-library, SignedDataVerifier) checks
// the signature chain up to Apple Root CA - G3 (certs/AppleRootCA-G3.cer, from
// apple.com/certificateauthority; SHA-256 63:34:3A:BF:...:3E:91:79), the bundle ID and app ID.
// Production is tried first, then Sandbox (TestFlight).
//
// Android: the Play purchase token is checked with the Play Developer API
// (purchases.products.get) using the functions' own service account -- that account must be
// given "View financial data" access in Play Console (DEPLOY.md). purchaseState 0 = purchased.
//
// Either way the result names one purchase uniquely (`key`), which is what stops a purchase
// paying for two reports.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BUNDLE_ID = "com.trackline.navigate";
const ANDROID_PACKAGE = "com.trackline.navigate";
// App Store Connect app ID (Apple ID) of TrackLine.
const APP_APPLE_ID = 6790121934;

class ReceiptError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReceiptError";
  }
}

function appleRootCerts() {
  return [fs.readFileSync(path.join(__dirname, "..", "certs", "AppleRootCA-G3.cer"))];
}

async function verifyApple(signedTransaction, productIds) {
  const { SignedDataVerifier, Environment } = require("@apple/app-store-server-library");
  const roots = appleRootCerts();
  let payload = null;
  let sandbox = false;
  let lastErr = null;
  for (const env of [Environment.PRODUCTION, Environment.SANDBOX]) {
    try {
      const verifier = new SignedDataVerifier(roots, true, env, BUNDLE_ID, env === Environment.PRODUCTION ? APP_APPLE_ID : undefined);
      payload = await verifier.verifyAndDecodeTransaction(signedTransaction);
      sandbox = env !== Environment.PRODUCTION;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!payload) throw new ReceiptError(`Apple purchase couldn't be verified (${lastErr?.status ?? lastErr?.message ?? "invalid"}).`);
  if (payload.bundleId !== BUNDLE_ID) throw new ReceiptError("Purchase is for another app.");
  if (!productIds.includes(payload.productId)) throw new ReceiptError("Purchase is for another product.");
  if (payload.revocationDate) throw new ReceiptError("This purchase was refunded.");
  if (!payload.transactionId) throw new ReceiptError("Purchase has no transaction ID.");
  return { platform: "ios", key: `ios_${payload.transactionId}`, transactionId: payload.transactionId, productId: payload.productId, sandbox };
}

async function verifyGoogle(purchaseToken, productIds, productId) {
  // Play needs the product ID in the URL; the app says which one it bought.
  if (!productIds.includes(productId)) throw new ReceiptError("Purchase is for another product.");
  const { GoogleAuth } = require("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/androidpublisher"] });
  const client = await auth.getClient();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE}` +
    `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  let data;
  try {
    data = (await client.request({ url })).data;
  } catch (err) {
    throw new ReceiptError(`Google Play purchase couldn't be verified (${err?.response?.status ?? "error"}).`);
  }
  if (data.purchaseState !== 0) throw new ReceiptError("Google Play purchase isn't completed.");
  // purchaseType 0 = test purchase (license testers).
  const sandbox = data.purchaseType === 0;
  const id = data.orderId || crypto.createHash("sha256").update(purchaseToken).digest("hex").slice(0, 40);
  return { platform: "android", key: `android_${id}`, transactionId: id, productId, sandbox };
}

/** productIds: every product that pays for a full check. -> { platform, key, transactionId, productId, sandbox } or throws ReceiptError. */
async function verifyPurchase({ platform, token, productIds, productId }) {
  if (typeof token !== "string" || token.length < 10) throw new ReceiptError("No purchase token.");
  if (platform === "ios") return verifyApple(token, productIds);
  if (platform === "android") return verifyGoogle(token, productIds, productId);
  throw new ReceiptError("Unknown platform.");
}

module.exports = { verifyPurchase, ReceiptError, BUNDLE_ID, APP_APPLE_ID };
