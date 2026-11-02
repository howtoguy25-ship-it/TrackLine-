import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { haversineMeters } from "@/services/places";
import { isGpsReplayActive, subscribeGpsReplay, subscribeGpsReplayActiveChange, type ReplayFix } from "@/dev/gpsReplay";

// Real, explicit request -- a dedicated GPS watch for the live speedometer, separate from
// LocationContext's own shared watchPositionAsync (timeInterval 2000ms, distanceInterval 5m,
// used for the map puck/alerts/etc). That cadence is too slow for "update the UI at least once
// per second" -- a 1000ms/0m watch is requested here instead, scoped to exactly when this hook
// is mounted (the map screen, where the speedometer shows), so the rest of the app's location
// consumers are never affected by it.
const SPEED_WATCH_INTERVAL_MS = 1000;
const SPEED_WATCH_DISTANCE_INTERVAL_M = 0;

// Real, explicit spec values.
const EMA_ALPHA = 0.35;
const MAX_FIX_ACCURACY_M = 25;
const STATIONARY_THRESHOLD_KMH = 3;
const STATIONARY_HOLD_MS = 3000;

export interface LiveSpeedState {
  // Smoothed, rounded km/h shown in the UI -- 0 once genuinely stationary for 3+ seconds (see
  // STATIONARY_HOLD_MS), never negative, never null while a GPS fix exists (a brand-new fix with
  // no speed data yet reads as 0 until the first real delta can be computed).
  speedKmh: number;
  // The exact same value this hook already computed for its own real `speedKmh` field --
  // exposed separately only so a caller can tell "genuinely no GPS fix yet" (null) apart from
  // "stationary" (0), which speedKmh alone can't distinguish.
  hasFix: boolean;
  accuracyM: number | null;
}

/** Real, smoothed live ground speed, dedicated to the Home-map-view + navigation speedometer --
 *  see this file's own header for why it runs its own GPS watch rather than reusing
 *  LocationContext's. Real primary source: expo-location's own coords.speed (m/s -> km/h).
 *  Real fallback when that's null/negative (a real, documented possibility on some devices/
 *  fixes): haversine distance between the last two accepted fixes / the real elapsed time between
 *  them -- never a guessed or interpolated number. Fixes with reported accuracy worse than 25m
 *  are ignored entirely (neither displayed nor fed into the EMA/fallback) since a bad fix would
 *  otherwise visibly jump the readout. */
export function useLiveSpeed(active: boolean): LiveSpeedState {
  const [speedKmh, setSpeedKmh] = useState(0);
  const [hasFix, setHasFix] = useState(false);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);

  const emaRef = useRef<number | null>(null);
  const lastFixRef = useRef<{ latitude: number; longitude: number; timestamp: number } | null>(null);
  const belowThresholdSinceRef = useRef<number | null>(null);

  // Real, explicit request -- dev-only GPS replay support, same real __DEV__-gated pattern as
  // LocationContext.tsx (see its own comment / src/dev/gpsReplay.ts's header for why no bundled
  // sample drive ships with this).
  const [replayActive, setReplayActive] = useState(__DEV__ && isGpsReplayActive());
  useEffect(() => {
    if (!__DEV__) return;
    return subscribeGpsReplayActiveChange(setReplayActive);
  }, []);

  useEffect(() => {
    if (!active) {
      // Reset so re-enabling (e.g. re-opening the map screen) starts clean rather than smoothing
      // against a stale speed from a previous session.
      emaRef.current = null;
      lastFixRef.current = null;
      belowThresholdSinceRef.current = null;
      setSpeedKmh(0);
      setHasFix(false);
      setAccuracyM(null);
      return;
    }

    // Shared by both the real GPS subscription below and the dev GPS-replay feed -- identical
    // EMA/fallback/accuracy-filter/stationary-hold handling regardless of which one a given fix
    // came from, so a replay genuinely exercises the exact same smoothing logic a real drive
    // would.
    function handleFix(coords: Location.LocationObjectCoords, timestamp: number) {
      if (coords.accuracy != null && coords.accuracy > MAX_FIX_ACCURACY_M) return;

      setAccuracyM(coords.accuracy ?? null);
      setHasFix(true);

      let rawKmh: number;
      if (coords.speed != null && coords.speed >= 0) {
        rawKmh = coords.speed * 3.6;
      } else {
        // Real haversine-distance-over-time fallback, per spec -- only when the OS genuinely
        // didn't give a speed for this fix, never used to override a real one.
        const last = lastFixRef.current;
        if (last) {
          const dtSeconds = (timestamp - last.timestamp) / 1000;
          rawKmh =
            dtSeconds > 0
              ? (haversineMeters(last, { latitude: coords.latitude, longitude: coords.longitude }) / dtSeconds) * 3.6
              : 0;
        } else {
          rawKmh = 0;
        }
      }
      lastFixRef.current = { latitude: coords.latitude, longitude: coords.longitude, timestamp };

      emaRef.current = emaRef.current == null ? rawKmh : EMA_ALPHA * rawKmh + (1 - EMA_ALPHA) * emaRef.current;
      const smoothed = Math.max(0, emaRef.current);

      const now = Date.now();
      if (smoothed < STATIONARY_THRESHOLD_KMH) {
        if (belowThresholdSinceRef.current == null) belowThresholdSinceRef.current = now;
        if (now - belowThresholdSinceRef.current >= STATIONARY_HOLD_MS) {
          setSpeedKmh(0);
          return;
        }
      } else {
        belowThresholdSinceRef.current = null;
      }
      setSpeedKmh(Math.round(smoothed));
    }

    if (__DEV__ && replayActive) {
      return subscribeGpsReplay((fix: ReplayFix) => handleFix(fix.coords, fix.timestamp));
    }

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || cancelled) return;

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: SPEED_WATCH_INTERVAL_MS,
          distanceInterval: SPEED_WATCH_DISTANCE_INTERVAL_M,
        },
        (loc) => handleFix(loc.coords, loc.timestamp)
      );
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [active, replayActive]);

  return { speedKmh, hasFix, accuracyM };
}
