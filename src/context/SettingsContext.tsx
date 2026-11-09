import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  pushSettingsToProfile,
  pullSettingsFromProfile,
  type AppSettings,
} from "@/services/settings";
import {
  getVoiceEnabled,
  setVoiceEnabled as persistVoiceEnabled,
  getVoiceVolume,
  setVoiceVolume as persistVoiceVolume,
  getVoiceIdentifier,
  setVoiceIdentifier as persistVoiceIdentifier,
} from "@/services/voice";
import { useAuth } from "@/context/AuthContext";

interface SettingsContextValue {
  settings: AppSettings;
  loaded: boolean;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  voiceEnabled: boolean;
  toggleVoiceEnabled: () => Promise<void>;
  voiceVolume: number;
  setVoiceVolume: (value: number) => Promise<void>;
  voiceIdentifier: string | null;
  setVoiceIdentifier: (identifier: string | null) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  updateSettings: async () => {},
  voiceEnabled: true,
  toggleVoiceEnabled: async () => {},
  voiceVolume: 1,
  setVoiceVolume: async () => {},
  voiceIdentifier: null,
  setVoiceIdentifier: async () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [voiceEnabled, setVoiceEnabledState] = useState(true);
  const [voiceVolume, setVoiceVolumeState] = useState(1);
  const [voiceIdentifier, setVoiceIdentifierState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { user } = useAuth();
  // Real sign-in-to-sign-in dedup -- without this, this effect would re-run and re-pull on
  // every single AuthProvider `user` object change (a new User reference can come through
  // on claims refresh etc. without actually becoming a *different* uid), overwriting whatever
  // the driver just changed locally seconds after signing in. Only pulls once per genuinely
  // new real (non-anonymous) uid.
  const pulledForUid = useRef<string | null>(null);

  // DIAGNOSTIC BUILD -- see src/services/firebase.ts's DIAGNOSTIC_DISABLE_ASYNC_STORAGE_PERSISTENCE
  // for the full rationale. This is the other unconditional-on-every-launch AsyncStorage call
  // site (loadSettings/getVoiceEnabled, both backed by AsyncStorage.getItem), skipped here too
  // so this build isolates AsyncStorage as a whole, not just Firebase's use of it.
  const DIAGNOSTIC_DISABLE_ASYNC_STORAGE_SETTINGS = false;

  useEffect(() => {
    if (DIAGNOSTIC_DISABLE_ASYNC_STORAGE_SETTINGS) {
      setLoaded(true);
      return;
    }
    (async () => {
      const stored = await loadSettings();
      setSettings(stored);
      const voice = await getVoiceEnabled(stored.defaultVoiceEnabled);
      setVoiceEnabledState(voice);
      const volume = await getVoiceVolume(1);
      setVoiceVolumeState(volume);
      const identifier = await getVoiceIdentifier();
      setVoiceIdentifierState(identifier);
      setLoaded(true);
    })();
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      await saveSettings(next);
      // Fire-and-forget, never awaited -- a toggle in Settings should never wait on a network
      // round-trip, and a failed push here just means the next real change (or next sign-in's
      // own pull) catches it up rather than losing it outright.
      if (user && !user.isAnonymous) {
        pushSettingsToProfile(user.uid, next).catch((err) =>
          console.warn("[settings] Firestore sync failed", err)
        );
      }
    },
    [settings, user]
  );

  // Real cross-device sync -- the instant a driver actually signs in with a real (non-
  // anonymous) account on this device, pull whatever settings their account already has saved
  // (from any OTHER device that previously synced) and merge them on top of local defaults, same
  // merge shape loadSettings itself uses so a remote doc missing newer keys (e.g. an account that
  // last synced before showCompass existed) never wipes this device's own default for them.
  // Deliberately one-shot per sign-in, not a live listener -- this app doesn't need another
  // device's setting change to appear mid-session on this one, only to be picked up next time
  // this device itself signs in.
  useEffect(() => {
    if (!loaded || !user || user.isAnonymous) return;
    if (pulledForUid.current === user.uid) return;
    pulledForUid.current = user.uid;
    pullSettingsFromProfile(user.uid)
      .then((remote) => {
        if (!remote) return;
        setSettings((current) => {
          const merged = { ...current, ...remote };
          saveSettings(merged).catch(() => {});
          return merged;
        });
      })
      .catch((err) => console.warn("[settings] Firestore pull failed", err));
  }, [loaded, user]);

  const toggleVoiceEnabled = useCallback(async () => {
    const next = !voiceEnabled;
    setVoiceEnabledState(next);
    await persistVoiceEnabled(next);
  }, [voiceEnabled]);

  const setVoiceVolume = useCallback(async (value: number) => {
    setVoiceVolumeState(value);
    await persistVoiceVolume(value);
  }, []);

  const setVoiceIdentifier = useCallback(async (identifier: string | null) => {
    setVoiceIdentifierState(identifier);
    await persistVoiceIdentifier(identifier);
  }, []);

  // Without this, the object literal below was a brand-new reference on every single render of
  // this provider -- meaning every consumer (MapScreen chief among them, a very large component
  // with a native MapView and a lot of child markers/overlays) re-rendered on ANY change here,
  // including ones it doesn't even read, like dragging the volume slider or muting voice
  // guidance. Real, measurable extra work on every one of those interactions, not just a
  // theoretical concern -- this context wraps the entire app.
  const value = useMemo(
    () => ({
      settings,
      loaded,
      updateSettings,
      voiceEnabled,
      toggleVoiceEnabled,
      voiceVolume,
      setVoiceVolume,
      voiceIdentifier,
      setVoiceIdentifier,
    }),
    [
      settings,
      loaded,
      updateSettings,
      voiceEnabled,
      toggleVoiceEnabled,
      voiceVolume,
      setVoiceVolume,
      voiceIdentifier,
      setVoiceIdentifier,
    ]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
