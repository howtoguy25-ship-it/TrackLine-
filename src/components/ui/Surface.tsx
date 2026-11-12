import React, { useContext } from "react";
import {
  Pressable as RNPressable,
  StyleSheet,
  View as RNView,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { SurfaceScheme, SurfaceSchemeContext, darkSurfaceOverrides } from "@/components/ui/surfaceScheme";
import { useMapScheme } from "@/components/ui/uiScheme";

// Drop-in View and Pressable for components that sit on the map: inside a dark SurfaceScheme
// they swap their light backgrounds and borders for the dark ones (surfaceScheme.ts). Outside one
// they're exactly React Native's View and Pressable.

function dark(style: StyleProp<ViewStyle>): StyleProp<ViewStyle> {
  const extra = darkSurfaceOverrides(StyleSheet.flatten(style) as Record<string, unknown>);
  return extra ? [style, extra as ViewStyle] : style;
}

export const View = React.forwardRef<RNView, ViewProps>(function View({ style, ...rest }, ref) {
  const scheme = useContext(SurfaceSchemeContext);
  return <RNView ref={ref} {...rest} style={scheme === "dark" ? dark(style) : style} />;
});
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type View = RNView;

export const Pressable = React.forwardRef<RNView, PressableProps>(function Pressable({ style, ...rest }, ref) {
  const scheme = useContext(SurfaceSchemeContext);
  if (scheme !== "dark" || !style) return <RNPressable ref={ref} {...rest} style={style} />;
  const themed =
    typeof style === "function"
      ? (state: PressableStateCallbackType) => dark(style(state))
      : dark(style);
  return <RNPressable ref={ref} {...rest} style={themed} />;
});

/**
 * Wraps the sheets and cards that sit on the map: with the map in its Dark theme they go dark
 * with it (surfaceScheme.ts).
 */
export function MapSurface({ children }: { children: React.ReactNode }) {
  const scheme = useMapScheme();
  return <SurfaceScheme value={scheme}>{children}</SurfaceScheme>;
}
