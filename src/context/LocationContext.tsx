import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as Location from "expo-location";
import { isGpsReplayActive, subscribeGpsReplay, subscribeGpsReplayActiveChange, type ReplayFix } from "@/dev/gpsReplay";

interface LocationContextValue {
  location: Location.LocationObject | null;
  errorMsg: string | null;
  permissionGranted: boolean;
  // Real, explicit request -- previously nothing in the app ever reacted to a denied/undetermined
  // permission at all, so a fresh install (or a real denial) silently left the map on its
  // mount-time placeholder coordinate forever with no indication it wasn't the user's real
  // location. These let a screen build a real "we need your location" prompt instead.
  //
  // null until the very first real permission check resolves (never claim a definite yes/no
  // before actually asking) -- false once denied. iOS only ever offers the native permission
  // dialog once; after a real denial, canAskAgain (from expo-location's own real
  // PermissionResponse) tells a caller whether requestPermission() below can show that dialog
  // again or whether the only real path left is the system Settings app.
  permissionDenied: boolean;
  canAskAgain: boolean;
  // Re-runs the real permission request (and starts the watch on success) -- lets a "Try again"
  // button actually retry instead of only ever asking once on mount.
  requestPermission: () => void;
}

const LocationContext = createContext<LocationContextValue>({
  location: null,
  errorMsg: null,
  permissionGranted: false,
  permissionDenied: false,
  canAskAgain: true,
  requestPermission: () => {},
});

// DIAGNOSTIC BUILD -- Sentry native, the entire ad SDK, and AsyncStorage (Firebase persistence
// + Settings load) are now ALL conclusively ruled out (build 26: everything from all three off
// simultaneously, identical crash persisted). This isolates the next unconditional-on-launch
// native surface: expo-location's requestForegroundPermissionsAsync/watchPositionAsync, run
// together with MapScreen's DIAGNOSTIC_DISABLE_MAPVIEW (see MapScreen.tsx) so this build tests
// both remaining candidates -- location and the native MapView itself -- at once, the same
// combined-isolation approach build 25 used for Sentry+ads.
const DIAGNOSTIC_DISABLE_LOCATION_WATCH = false;

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);
  // Bumped by requestPermission() below to re-run the request effect on demand (a real "Try
  // again" retry), not just once on mount.
  const [retryTick, setRetryTick] = useState(0);
  const requestPermission = useCallback(() => setRetryTick((t) => t + 1), []);
  // Real, explicit request -- dev-only GPS replay. Tracked as state (not just read once) so
  // starting/stopping a replay AFTER this provider has already mounted (the realistic case --
  // the app launches normally first) actually switches the live GPS source, not just on the
  // next app restart. __DEV__-gated: this subscription is simply never created in production.
  const [replayActive, setReplayActive] = useState(__DEV__ && isGpsReplayActive());
  useEffect(() => {
    if (!__DEV__) return;
    return subscribeGpsReplayActiveChange(setReplayActive);
  }, []);

  useEffect(() => {
    if (DIAGNOSTIC_DISABLE_LOCATION_WATCH) return;

    if (__DEV__ && replayActive) {
      setPermissionGranted(true);
      setPermissionDenied(false);
      const unsubscribe = subscribeGpsReplay((fix: ReplayFix) => setLocation(fix));
      return unsubscribe;
    }

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const { status, canAskAgain: realCanAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== "granted") {
        setErrorMsg("Location permission is required for navigation and nearby alerts.");
        setPermissionDenied(true);
        setCanAskAgain(realCanAskAgain);
        return;
      }
      setPermissionGranted(true);
      setPermissionDenied(false);
      setErrorMsg(null);

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (loc) => setLocation(loc)
      );
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [replayActive, retryTick]);

  return (
    <LocationContext.Provider
      value={{ location, errorMsg, permissionGranted, permissionDenied, canAskAgain, requestPermission }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation(): LocationContextValue {
  return useContext(LocationContext);
}
