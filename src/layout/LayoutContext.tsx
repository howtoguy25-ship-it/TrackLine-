// The window's layout (layout/screenLayout.ts) for everything drawn over the map: sheets read it
// to become the left panel on landscape phones, tablets and desktop. Default (no provider): the
// phone layout, so a sheet used anywhere else behaves exactly as before.
import React, { createContext, useContext, useMemo } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { screenLayout, sheetMargins, type ScreenLayout } from "./screenLayout";

const LayoutContext = createContext<ScreenLayout | null>(null);

export function ScreenLayoutProvider({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const value = useMemo(() => screenLayout(width, height, insets, Platform.OS), [width, height, insets]);
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

/** The current layout; the phone layout when no provider is above. */
export function useScreenLayout(): ScreenLayout {
  const { width, height } = useWindowDimensions();
  const ctx = useContext(LayoutContext);
  return ctx ?? screenLayout(width, height, undefined, undefined, "phone");
}

/** Style for a bottom-anchored sheet: full width on a phone, the left panel otherwise. */
export function useSheetPanelStyle(): { marginLeft: number; marginRight: number } {
  const l = useContext(LayoutContext);
  return l ? sheetMargins(l) : { marginLeft: 0, marginRight: 0 };
}
