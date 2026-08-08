import React from "react";
import { StatusBar } from "expo-status-bar";
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
