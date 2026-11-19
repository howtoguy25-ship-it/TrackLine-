import { featureOnNow } from "@/remote/useAppConfig";
import { auth } from "@/services/firebase";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAppOpenAd } from "react-native-google-mobile-ads";
import { env } from "@/config/env";
import { ensureAdsInitialized } from "@/services/ads";
import { shouldShowAppOpenAd, recordAppOpenAdShown } from "@/services/appOpenAdSchedule";
import { isNavigationActive } from "@/services/navState";
import { Sentry } from "@/services/sentry";

// Renders nothing -- loads and shows a full-screen App Open ad on real app-open events (cold
// start, and every background->foreground resume), up to 3 times per day: immediately on the
// first open, then only once at least 1h has passed since the 1st ad, then only once at least
// 3h total has passed since the 1st ad (see appOpenAdSchedule.ts for the exact gating -- those
// are real per-user-open, calendar-day-capped rules, not a background timer that fires
// regardless of whether the app is even open).
//
// Never shown while turn-by-turn navigation is active (isNavigationActive(), set by MapScreen)
// -- this is a driving app, and an ad popping up over an active route, including on a resume
// mid-navigation, would be a real safety problem, not just an annoyance.
export function AppOpenAdManager() {
  const { isLoaded, isShowing, load, show } = useAppOpenAd(env.ads.appOpenUnitId);
  // Real crash evidence (multiple .ips logs + a screen recording all showing the app
  // aborting within ~1-2s of a cold launch, before any UI is even usable) points at
  // show() firing before the app's native window is actually active -- a documented
  // AdMob App Open ad gotcha: presenting a full-screen ad before the root view controller
  // is key/active can crash natively. This component waits for AppState to actually report
  // "active" before ever calling show().
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === "active");
  // Set once shouldShowAppOpenAd() has said yes for the *current* open and cleared the
  // instant that ad is actually shown (or the open is superseded by a new one) -- this is
  // what the show-effect below waits on, separately from isLoaded, so a load that finishes
  // after the user has already moved on (e.g. backgrounded again) doesn't show a stale ad.
  const pendingShowRef = useRef(false);

  const evaluateOpen = useCallback(() => {
    pendingShowRef.current = false;
    if (isNavigationActive()) return;
    // Owner dashboard > App control > ads off: no ad at all.
    if (!featureOnNow("ads", auth.currentUser?.uid ?? null)) return;
    shouldShowAppOpenAd()
      .then((should) => {
        if (!should || isNavigationActive()) return;
        pendingShowRef.current = true;
        Sentry.logger.info("ads: calling app open ad load()");
        load();
      })
      .catch((err) => {
        Sentry.logger.error("ads: app open ad schedule check failed", { error: String(err) });
        console.warn("[ads] app open ad schedule check failed", err);
      });
  }, [load]);

  // ensureAdsInitialized() runs unconditionally on cold start -- BannerAdBar's native
  // <BannerAd> has no init call of its own and relies on this having already run, regardless
  // of whether today's App Open ad cap happens to be reached already. It's cached/idempotent
  // (see ads.ts), so evaluateOpen() below can also await it on every open with no extra cost.
  useEffect(() => {
    ensureAdsInitialized()
      .then(() => evaluateOpen())
      .catch((err) => {
        Sentry.logger.error("ads: Google Mobile Ads SDK failed to initialize", { error: String(err) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        setAppIsActive(true);
        // A real return-to-foreground counts as its own "app opened again" for the 3-per-day
        // cadence -- re-evaluate whether this is the 2nd/3rd ad's turn, or none at all yet.
        evaluateOpen();
      } else {
        setAppIsActive(false);
      }
    });
    return () => subscription.remove();
  }, [evaluateOpen]);

  useEffect(() => {
    if (isLoaded && appIsActive && !isShowing && pendingShowRef.current && !isNavigationActive()) {
      pendingShowRef.current = false;
      Sentry.logger.info("ads: calling app open ad show()");
      recordAppOpenAdShown().catch((err) => {
        Sentry.logger.error("ads: failed to record app open ad shown", { error: String(err) });
      });
      show();
    }
  }, [isLoaded, appIsActive, isShowing, show]);

  return null;
}
