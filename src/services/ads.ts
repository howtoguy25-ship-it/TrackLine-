import { Platform } from "react-native";
import mobileAds from "react-native-google-mobile-ads";
import { getTrackingPermissionsAsync, requestTrackingPermissionsAsync } from "expo-tracking-transparency";
import { Sentry } from "@/services/sentry";
import { askPermission, answered } from "@/services/permissionQueue";

// Kicks off the Google Mobile Ads SDK's own initialization exactly once, no matter how many
// call sites (App Open manager, banner, any future ad placement) ask for it -- every caller
// awaits the same in-flight/settled promise instead of re-initializing.
let initPromise: Promise<void> | null = null;

// Logged immediately before/after each native ad SDK call -- this crash class (native
// exception inside a TurboModule void method, on com.meta.react.turbomodulemanager.queue)
// happens beneath JS entirely, so a try/catch here can't catch it, but a log line right
// before the call means the NEXT crash log's last breadcrumb tells us definitively whether
// ads were the trigger.
export function ensureAdsInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = maybeRequestTrackingPermission()
      .then(() => {
        Sentry.logger.info("ads: calling mobileAds().initialize()");
        return mobileAds().initialize();
      })
      .then(() => {
        Sentry.logger.info("ads: mobileAds().initialize() resolved");
        return undefined;
      })
      .catch((err) => {
        Sentry.logger.error("ads: Google Mobile Ads SDK failed to initialize", { error: String(err) });
        console.warn("[ads] Google Mobile Ads SDK failed to initialize", err);
      });
  }
  return initPromise;
}

// Real App Tracking Transparency prompt -- this app's Info.plist already declares
// NSUserTrackingUsageDescription (via the react-native-google-mobile-ads plugin config in
// app.config.js), but declaring that string alone doesn't show the prompt; iOS requires an
// actual call to the ATT API before requesting IDFA-based (personalized) ads. Skipping this
// wasn't a hard App Review rejection, but it meant every ad silently fell back to non-
// personalized-only and left a declared-but-unused permission sitting in the app. Android has
// no ATT concept, so this is a no-op there.
async function maybeRequestTrackingPermission(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    Sentry.logger.info("ads: calling requestTrackingPermissionsAsync()");
    // Through the queue: last in line, never over another prompt (iOS silently drops the
    // tracking prompt if another alert is up when it's asked).
    await askPermission("tracking", () => requestTrackingPermissionsAsync(), {
      decided: async () => answered(await getTrackingPermissionsAsync()),
    });
    Sentry.logger.info("ads: requestTrackingPermissionsAsync() resolved");
  } catch (err) {
    Sentry.logger.error("ads: tracking permission request failed", { error: String(err) });
    console.warn("[ads] tracking permission request failed", err);
  }
}
