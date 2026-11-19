import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/services/firebase";
import { useAuth } from "@/context/AuthContext";
import { deviceRegion } from "@/schoolZones/regions";
import { EMPTY_CONFIG, isFeatureOn, normalise, type FeatureKey, type RemoteConfig } from "@/remote/appConfig";

const CACHE_KEY = "@trackline/appConfig";
let current: RemoteConfig = EMPTY_CONFIG;
const listeners = new Set<(c: RemoteConfig) => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  AsyncStorage.getItem(CACHE_KEY)
    .then((raw) => {
      if (raw && current === EMPTY_CONFIG) {
        current = normalise(JSON.parse(raw));
        listeners.forEach((l) => l(current));
      }
    })
    .catch(() => {});
  onSnapshot(
    doc(db, "appConfig", "current"),
    (snap) => {
      current = normalise(snap.exists() ? snap.data() : {});
      listeners.forEach((l) => l(current));
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(current)).catch(() => {});
    },
    () => {
      /* offline or not deployed yet: keep the cached / empty config (everything on) */
    }
  );
}

export function useAppConfig(): RemoteConfig {
  const [cfg, setCfg] = useState<RemoteConfig>(current);
  useEffect(() => {
    start();
    listeners.add(setCfg);
    return () => {
      listeners.delete(setCfg);
    };
  }, []);
  return cfg;
}

/** Is a dashboard-controlled feature on for this user right now? */
export function useFeature(key: FeatureKey): boolean {
  const cfg = useAppConfig();
  const { user } = useAuth();
  return isFeatureOn(cfg, key, { uid: user?.uid ?? null, country: deviceRegion() });
}

/** For non-React code (ads scheduler etc.). */
export function featureOnNow(key: FeatureKey, uid: string | null): boolean {
  start();
  return isFeatureOn(current, key, { uid, country: deviceRegion() });
}
