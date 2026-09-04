import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
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
    },
    [settings]
  );

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
