import { useColorScheme } from "react-native";
import { useSettings } from "@/context/SettingsContext";
import { SETTINGS_SURFACES, type Scheme } from "@/theme/colors";

/** Light or dark for settings pages: the Appearance setting, or the phone's when it's Automatic. */
export function resolveSettingsScheme(appearance: "auto" | "light" | "dark" | undefined, system: string | null | undefined): Scheme {
  if (appearance === "light" || appearance === "dark") return appearance;
  return system === "dark" ? "dark" : "light";
}

export function useSettingsScheme(): Scheme {
  const { settings } = useSettings();
  return resolveSettingsScheme(settings.appearance, useColorScheme());
}

export function useSettingsColours() {
  return SETTINGS_SURFACES[useSettingsScheme()];
}

export type SettingsColours = (typeof SETTINGS_SURFACES)[Scheme];
