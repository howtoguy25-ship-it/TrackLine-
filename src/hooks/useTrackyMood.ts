import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "@/context/LocationContext";
import {
  getLocalMoodState,
  setLocalMoodState,
  pushMoodToProfile,
  pullMoodFromProfile,
  getUserBirthday,
  isBirthdayToday,
  getDrivingStreakDays,
  isRainingAt,
  resolveAutoMood,
  type TrackyMoodState,
} from "@/services/trackyMood";
import type { TrackyMoodKey } from "@/components/trackys/moods";

export interface UseTrackyMoodResult {
  // The real mood to actually render right now -- already resolved from "auto" if that's the
  // current selection, never "auto" itself (nothing renders an "auto" face).
  displayMood: TrackyMoodKey;
  // The raw stored selection -- a real mood key, or "auto".
  selected: TrackyMoodKey | "auto";
  loaded: boolean;
  drivingStreakDays: number;
  setMood: (mood: TrackyMoodKey) => void;
  setAuto: () => void;
}

// Real, explicit request -- Ghost mode's own Spooky mood is the one case the auto-mood engine
// needs to know about from outside this hook (see trackyMood.ts's resolveAutoMood); Part 2's
// own ghost-mode state isn't built yet at the point this hook was written, so this takes it as
// a plain optional param (defaulting false) rather than reaching into a settings field that
// doesn't exist yet -- wire the real value through once Part 2 lands.
export function useTrackyMood(isGhostMode = false): UseTrackyMoodResult {
  const { user } = useAuth();
  const { location } = useLocation();
  const [state, setState] = useState<TrackyMoodState>({ selected: "auto" });
  const [loaded, setLoaded] = useState(false);
  const [resolvedAuto, setResolvedAuto] = useState<TrackyMoodKey>("happy");
  const [drivingStreakDays, setDrivingStreakDays] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await getLocalMoodState();
      if (user && !user.isAnonymous) {
        const remote = await pullMoodFromProfile(user.uid).catch(() => null);
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
    // Re-pull once per real sign-in change only -- not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const streakDays = await getDrivingStreakDays();
      if (cancelled) return;
      setDrivingStreakDays(streakDays);

      const birthdayMonthDay = user && !user.isAnonymous ? await getUserBirthday(user.uid).catch(() => null) : null;
      const isRaining = location ? await isRainingAt(location.coords).catch(() => false) : false;
      if (cancelled) return;

      setResolvedAuto(
        resolveAutoMood({
          drivingStreakDays: streakDays,
          isRaining,
          isBirthdayToday: isBirthdayToday(birthdayMonthDay),
          isGhostMode,
        })
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, location?.coords.latitude, location?.coords.longitude, isGhostMode]);

  const persist = useCallback(
    (next: TrackyMoodState) => {
      setState(next);
      setLocalMoodState(next).catch(() => {});
      if (user && !user.isAnonymous) pushMoodToProfile(user.uid, next).catch(() => {});
    },
    [user]
  );

  const setMood = useCallback((mood: TrackyMoodKey) => persist({ selected: mood }), [persist]);
  const setAuto = useCallback(() => persist({ selected: "auto" }), [persist]);

  return {
    displayMood: state.selected === "auto" ? resolvedAuto : state.selected,
    selected: state.selected,
    loaded,
    drivingStreakDays,
    setMood,
    setAuto,
  };
}
