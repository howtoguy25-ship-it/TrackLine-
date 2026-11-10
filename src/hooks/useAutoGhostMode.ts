import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useSettings } from "@/context/SettingsContext";
import type { VisibilityMode } from "@/services/settings";

const AUTO_GHOST_BACKGROUND_MS = 30 * 60 * 1000;

// Real, explicit request -- "Auto-ghost after >30min background or on arrival." This only ever
// flips a driver INTO ghost mode by itself, never back out of it -- same one-way-trigger
// convention this app already uses for the Spooky mood (auto-mood can land on it, nothing
// auto-clears it). A ref (not AsyncStorage) is enough for the background timer -- MapScreen,
// this hook's one real call site, stays mounted for the app's whole lifetime as the root screen
// of the stack, so a cold relaunch after being force-quit is a fresh background duration anyway.
export function useAutoGhostMode() {
  const { settings, updateSettings, loaded } = useSettings();
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        if (backgroundedAtRef.current === null) backgroundedAtRef.current = Date.now();
        return;
      }
      if (nextState !== "active") return;
      const backgroundedAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      if (!backgroundedAt || !loaded) return;
      if (Date.now() - backgroundedAt < AUTO_GHOST_BACKGROUND_MS) return;
      if (settings.visibility !== "ghost") updateSettings({ visibility: "ghost" });
    });
    return () => subscription.remove();
  }, [loaded, settings.visibility, updateSettings]);
}

// Real, explicit request -- the other auto-ghost trigger, "on arrival". Called directly from
// MapScreen's own exitNavigation (the real, single place a trip ends, whether via the manual
// Exit button or any future automatic arrival detection) rather than duplicating that logic here.
export function autoGhostOnArrival(
  currentVisibility: VisibilityMode,
  updateSettings: (patch: { visibility: VisibilityMode }) => void
) {
  if (currentVisibility !== "ghost") updateSettings({ visibility: "ghost" });
}
