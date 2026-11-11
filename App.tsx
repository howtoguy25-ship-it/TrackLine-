import React, { useEffect, useState } from "react";
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
import { loadBoxedTFLiteModel } from "@/services/tfliteVehicleModel";
import { useFonts } from "expo-font";
import { Rubik_400Regular } from "@expo-google-fonts/rubik/400Regular";
import { Rubik_500Medium } from "@expo-google-fonts/rubik/500Medium";
import { Rubik_600SemiBold } from "@expo-google-fonts/rubik/600SemiBold";
import { Rubik_700Bold } from "@expo-google-fonts/rubik/700Bold";
import { setRubikReady } from "@/theme/typography";
import * as SplashScreen from "expo-splash-screen";

// Installed at module scope so it's active as early as this file is ever imported/evaluated
// -- before any provider or component below even mounts. See crashReporter.ts for why this
// exists: Apple's own .ips crash reports only ever show the generic RN bridge frames for a
// fatal JS error (RCTExceptionsManager reportFatal:), never the actual message/stack, which
// is exactly the wall this app hit investigating real TestFlight crashes this session.
//
// initSentry() must run second -- see sentry.ts for why the order matters.
installCrashReporter();
initSentry();

// Keep the splash screen up until the app's font has loaded (see the useFonts call in App),
// instead of letting it drop to a blank frame for that moment.
SplashScreen.preventAutoHideAsync().catch(() => {});

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

  // Rubik, the app's typeface (theme/typography.ts). The four files are bundled with the app,
  // so this resolves from disk in a moment; the splash screen stays up until it does, so no
  // screen is ever drawn once in the system font and then again in Rubik. If loading fails the
  // app carries on in the system font rather than refusing to start.
  const [fontsLoaded, fontError] = useFonts({ Rubik_400Regular, Rubik_500Medium, Rubik_600SemiBold, Rubik_700Bold });
  // A font that hasn't reported back within three seconds isn't going to; the app must never
  // sit on its splash screen waiting for one.
  const [fontWaitExpired, setFontWaitExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFontWaitExpired(true), 3000);
    return () => clearTimeout(timer);
  }, []);
  const fontsSettled = fontsLoaded || !!fontError || fontWaitExpired;
  setRubikReady(fontsLoaded);
  useEffect(() => {
    if (fontsSettled) SplashScreen.hideAsync().catch(() => {});
  }, [fontsSettled]);

  // Real, explicit request: AI vehicle detection should start the instant that screen opens,
  // not after a visible load delay. loadBoxedTFLiteModel() caches its result in a module-level
  // promise (see tfliteVehicleModel.ts's own comment), so kicking it off here -- once, in the
  // background, at app launch, well before the driver ever taps into detection -- means the
  // model is very likely already loaded (or already most of the way through loading) by the
  // time VehicleDetectionScreen mounts and calls the exact same function: that call just awaits
  // this same in-flight/already-resolved promise instead of starting the real disk-read +
  // interpreter-init work from zero. Errors are swallowed here on purpose -- VehicleDetectionScreen's
  // own load effect already has a real, user-facing auto-retry loop for a genuine failure; this
  // is purely a head start, never the only place this gets attempted.
  useEffect(() => {
    loadBoxedTFLiteModel().catch(() => {});
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

  if (!fontsSettled) return null;

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
