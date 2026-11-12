import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useTrackyMood } from "@/hooks/useTrackyMood";
import {
  getLocalAppearanceState,
  setLocalAppearanceState,
  subscribeAppearanceState,
  pushAppearanceToProfile,
  pullAppearanceFromProfile,
  type TrackyAppearanceState,
} from "@/services/trackyCustomization";
import { DEFAULT_CUSTOMIZATION, type TrackyCustomization } from "@/components/trackys/customization";
import type { TrackyMoodKey } from "@/components/trackys/moods";

export interface UseTrackyAppearanceResult {
  mode: "mood" | "custom";
  displayMood: TrackyMoodKey;
  customization: TrackyCustomization;
  loaded: boolean;
  drivingStreakDays: number;
  isBirthdayToday: boolean;
  setMode: (mode: "mood" | "custom") => void;
  // Saves a design AND makes it the active look in one write -- two separate setState-style
  // calls here would each spread the same stale `state` and the second would silently undo
  // the first.
  saveCustomization: (customization: TrackyCustomization) => void;
}

// Real, explicit request (ADD-ON Part A) -- the single place that resolves "what does MY Tracky
// actually look like right now": either the real auto/selected MOOD (useTrackyMood, unchanged
// default) or a saved custom design (trackyCustomization.ts), whichever `mode` is currently
// active. Every render site of the driver's OWN Tracky (menu header, profile screen, the
// customiser's own live preview, and -- see presence.ts -- their own presence marker on other
// drivers' maps) reads this one hook rather than re-deciding the mood-vs-custom switch itself.
export function useTrackyAppearance(isGhostMode = false): UseTrackyAppearanceResult {
  const { user } = useAuth();
  const mood = useTrackyMood(isGhostMode);
  const [state, setState] = useState<TrackyAppearanceState>({ mode: "mood", customization: DEFAULT_CUSTOMIZATION });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await getLocalAppearanceState();
      if (user && !user.isAnonymous) {
        const remote = await pullAppearanceFromProfile(user.uid).catch(() => null);
        if (remote && !cancelled) {
          setState(remote);
          setLoaded(true);
          return;
        }
      }
      if (!cancelled) {
        setState(local);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => subscribeAppearanceState(setState), []);

  const persist = useCallback(
    (next: TrackyAppearanceState) => {
      setLocalAppearanceState(next).catch(() => {});
      if (user && !user.isAnonymous) pushAppearanceToProfile(user.uid, next).catch(() => {});
    },
    [user]
  );

  const setMode = useCallback((nextMode: "mood" | "custom") => persist({ ...state, mode: nextMode }), [persist, state]);
  const saveCustomization = useCallback(
    (customization: TrackyCustomization) => persist({ mode: "custom", customization }),
    [persist]
  );

  return {
    mode: state.mode,
    displayMood: mood.displayMood,
    customization: state.customization,
    loaded: loaded && mood.loaded,
    drivingStreakDays: mood.drivingStreakDays,
    isBirthdayToday: mood.isBirthdayToday,
    setMode,
    saveCustomization,
  };
}
