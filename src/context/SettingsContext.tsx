import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  pushSettingsToProfile,
  pullSettingsFromProfile,
  type AppSettings,
  type SyncedVoice,
} from "@/services/settings";
import {
  getVoiceEnabled,
  setVoiceEnabled as persistVoiceEnabled,
  getVoiceVolume,
  setVoiceVolume as persistVoiceVolume,
  getVoiceIdentifier,
  setVoiceIdentifier as persistVoiceIdentifier,
  getStoredNavLanguage,
  setStoredNavLanguage,
} from "@/services/voice";
import { setDirectionsLanguage } from "@/services/directions";
import type { NavLanguage } from "@/services/navLanguage";
import { useAuth } from "@/context/AuthContext";
import { useLatest } from "@/hooks/useLatest";

interface SettingsContextValue {
  settings: AppSettings;
  loaded: boolean;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  voiceEnabled: boolean;
  toggleVoiceEnabled: () => Promise<void>;
  voiceVolume: number;
  setVoiceVolume: (value: number) => Promise<void>;
  voiceIdentifier: string | null;
  // The second argument is the language that voice speaks (services/navLanguage.ts). Left out,
  // it means English -- right for the phone's default voice, a recorded voice and the
  // character voices, which are all English.
  setVoiceIdentifier: (identifier: string | null, language?: NavLanguage) => Promise<void>;
  /** The language navigation speaks and requests turn instructions in. Follows the voice. */
  navLanguage: NavLanguage;
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
  navLanguage: "en",
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  // The settings as of the last write, updated the moment it's made (not on the next render), so
  // two changes in a row both survive -- each write starts from the one before it.
  const latest = useRef<AppSettings>(DEFAULT_SETTINGS);
  const setSettings = useCallback((next: AppSettings) => {
    latest.current = next;
    setSettingsState(next);
  }, []);
  const [voiceEnabled, setVoiceEnabledState] = useState(true);
  const [voiceVolume, setVoiceVolumeState] = useState(1);
  const [voiceIdentifier, setVoiceIdentifierState] = useState<string | null>(null);
  const [navLanguage, setNavLanguageState] = useState<NavLanguage>("en");
  const [loaded, setLoaded] = useState(false);
  const { user } = useAuth();
  // Real sign-in-to-sign-in dedup -- without this, this effect would re-run and re-pull on
  // every single AuthProvider `user` object change (a new User reference can come through
  // on claims refresh etc. without actually becoming a *different* uid), overwriting whatever
  // the driver just changed locally seconds after signing in. Only pulls once per genuinely
  // new real (non-anonymous) uid.
  const pulledForUid = useRef<string | null>(null);


  useEffect(() => {
    (async () => {
      const stored = await loadSettings();
      setSettings(stored);
      const voice = await getVoiceEnabled(stored.defaultVoiceEnabled);
      setVoiceEnabledState(voice);
      const volume = await getVoiceVolume(1);
      setVoiceVolumeState(volume);
      const identifier = await getVoiceIdentifier();
      setVoiceIdentifierState(identifier);
      const language = await getStoredNavLanguage();
      setNavLanguageState(language);
      // Route requests read this directly (see directions.ts) -- set before `loaded` flips so
      // the very first route of a session is already asked for in the right language.
      setDirectionsLanguage(language);
      setLoaded(true);
    })();
  }, [setSettings]);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...latest.current, ...patch };
      setSettings(next);
      await saveSettings(next);
      // Fire-and-forget, never awaited -- a toggle in Settings should never wait on a network
      // round-trip, and a failed push here just means the next real change (or next sign-in's
      // own pull) catches it up rather than losing it outright.
      if (user) {
        pushSettingsToProfile(user.uid, next).catch((err) =>
          console.warn("[settings] Firestore sync failed", err)
        );
      }
    },
    [setSettings, user]
  );

  const applyVoice = useCallback((v: SyncedVoice) => {
    setVoiceEnabledState(v.enabled);
    setVoiceVolumeState(v.volume);
    setVoiceIdentifierState(v.identifier);
    setNavLanguageState(v.language as NavLanguage);
    setDirectionsLanguage(v.language as NavLanguage);
    Promise.all([persistVoiceEnabled(v.enabled), persistVoiceVolume(v.volume), persistVoiceIdentifier(v.identifier), setStoredNavLanguage(v.language as NavLanguage)]).catch(() => {});
  }, []);

  // Fix pass 5 §9: Sound & voice changes go to the account like every other setting (they used
  // to stay on this phone only). Saved locally first; the push is fire-and-forget.
  const voiceRef = useLatest<SyncedVoice>({ enabled: voiceEnabled, volume: voiceVolume, identifier: voiceIdentifier, language: navLanguage });
  const syncVoice = useCallback(
    (patch: Partial<SyncedVoice>) => {
      const voice = { ...voiceRef.current, ...patch };
      const next = { ...latest.current, voice };
      setSettings(next);
      saveSettings(next).catch(() => {});
      if (user) pushSettingsToProfile(user.uid, next).catch((err) => console.warn("[settings] Firestore sync failed", err));
    },
    [user, setSettings, voiceRef]
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
    if (!loaded || !user) return;
    if (pulledForUid.current === user.uid) return;
    pulledForUid.current = user.uid;
    pullSettingsFromProfile(user.uid)
      .then((remote) => {
        if (!remote) return;
        const merged = { ...latest.current, ...remote };
        setSettings(merged);
        saveSettings(merged).catch(() => {});
        // Sound & voice from the account (fix pass 5 §9): into this phone's own voice store too.
        if (remote.voice) applyVoice(remote.voice);
      })
      .catch((err) => console.warn("[settings] Firestore pull failed", err));
  }, [loaded, user, applyVoice, setSettings]);

  const toggleVoiceEnabled = useCallback(async () => {
    const next = !voiceEnabled;
    setVoiceEnabledState(next);
    await persistVoiceEnabled(next);
    syncVoice({ enabled: next });
  }, [voiceEnabled, syncVoice]);

  const setVoiceVolume = useCallback(
    async (value: number) => {
      setVoiceVolumeState(value);
      await persistVoiceVolume(value);
      syncVoice({ volume: value });
    },
    [syncVoice]
  );

  const setVoiceIdentifier = useCallback(async (identifier: string | null, language: NavLanguage = "en") => {
    setVoiceIdentifierState(identifier);
    setNavLanguageState(language);
    setDirectionsLanguage(language);
    await Promise.all([persistVoiceIdentifier(identifier), setStoredNavLanguage(language)]);
    syncVoice({ identifier, language });
  }, [syncVoice]);

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
      navLanguage,
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
      navLanguage,
    ]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
