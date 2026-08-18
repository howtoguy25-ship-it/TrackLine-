import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import * as ScreenOrientation from "expo-screen-orientation";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/context/AuthContext";
import { LocationProvider } from "@/context/LocationContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { RootNavigator } from "@/navigation/RootNavigator";
import { AppOpenAdManager } from "@/components/AppOpenAdManager";
import { AdsErrorBoundary } from "@/components/AdsErrorBoundary";
import { installCrashReporter } from "@/services/crashReporter";
import { initSentry, Sentry } from "@/services/sentry";

// Installed at module scope so it's active as early as this file is ever imported/evaluated
// -- before any provider or component below even mounts. See crashReporter.ts for why this
// exists: Apple's own .ips crash reports only ever show the generic RN bridge frames for a
// fatal JS error (RCTExceptionsManager reportFatal:), never the actual message/stack, which
// is exactly the wall this app hit investigating real TestFlight crashes this session.
//
// initSentry() must run second -- see sentry.ts for why the order matters.
installCrashReporter();
initSentry();

// DIAGNOSTIC: AppOpenAdManager fully removed for this build. Sentry's native layer was
// already ruled out (build 23, fully disabled, still crashed with the identical signature).
// This is the next candidate with actual structural evidence: appOpenLoad is a `void`-
// returning native TurboModule method (confirmed in
// node_modules/react-native-google-mobile-ads/src/specs/modules/NativeAppOpenModule.ts),
// an exact type match for the crash's technical signature (performVoidMethodInvocation), and
// it fires unconditionally on every single cold launch with zero user interaction -- matching
// every timing observation so far. Removing it entirely isolates whether it's the cause the
// same clean way the Sentry test did: if this build doesn't crash, it's confirmed; if it still
// crashes, this is ruled out too and the search moves on with real evidence either way.
const DIAGNOSTIC_DISABLE_APP_OPEN_AD = false;

function App() {
  // Portrait everywhere in the app by default -- app.config.js's own `orientation` had to move
  // from a hard "portrait" to "default" so the AI Detection screen can rotate at all (see its
  // own comment), which means the native layer alone no longer keeps every OTHER screen locked
  // to portrait -- this JS-side lock is what does that now. VehicleDetectionScreen unlocks on
  // its own mount and re-locks back to this on unmount, so this effect only ever needs to run
  // once here, not on every screen change.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // Real, confirmed gap: expo-updates' own default behavior only ever fetches a newly
  // published OTA update in the background on a cold launch -- it does NOT apply it to the
  // launch that just fetched it, only to the NEXT cold launch after that. With nothing here
  // ever calling reloadAsync(), every OTA publish this app ships needed two full quit-and-
  // reopens before a real device actually ran the new code, not one -- explaining reports of a
  // fix "still not working" immediately after a single reopen, when the fix itself was fine.
  // isEnabled is false in Expo Go/dev builds (no embedded update channel at all) -- skipped
  // there rather than throwing. Best-effort: any failure (offline, no update published yet)
  // just leaves the app running its current bundle, exactly like before this existed.
  useEffect(() => {
    if (!Updates.isEnabled) return;
    Updates.checkForUpdateAsync()
      .then((result) => (result.isAvailable ? Updates.fetchUpdateAsync() : null))
      .then((fetched) => (fetched ? Updates.reloadAsync() : null))
      .catch((err) => {
        Sentry.logger.error("ota-update: check/fetch/reload failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <SettingsProvider>
            <LocationProvider>
              <StatusBar style="dark" />
              {!DIAGNOSTIC_DISABLE_APP_OPEN_AD && (
                <AdsErrorBoundary>
                  <AppOpenAdManager />
                </AdsErrorBoundary>
              )}
              <RootNavigator />
            </LocationProvider>
          </SettingsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap is a no-op passthrough when initSentry() above skipped (no DSN set) -- safe to
// always include. Adds automatic screen/breadcrumb tracking and catches render-phase errors
// Sentry's own way when a DSN is configured.
export default Sentry.wrap(App);
