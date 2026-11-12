import React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import { useReduceMotion } from "@/hooks/useReduceMotion";

// How things arrive: a 180ms fade with an 8pt rise, no bounce. With Reduce Motion on, a plain
// fade. Used for cards and buttons that appear on top of the map.

export const APPEAR_MS = 180;
export const APPEAR_RISE = 8;

const EASE = Easing.out(Easing.cubic);

/** The entering / exiting animations, for an Animated.View that needs its own key. */
export function appearAnimations(reduceMotion: boolean) {
  return {
    entering: reduceMotion
      ? FadeIn.duration(APPEAR_MS)
      : FadeInDown.duration(APPEAR_MS).easing(EASE).withInitialValues({ transform: [{ translateY: APPEAR_RISE }] }),
    exiting: FadeOut.duration(APPEAR_MS),
  };
}

export function Appear({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReduceMotion();
  const { entering, exiting } = appearAnimations(reduceMotion);
  return (
    <Animated.View entering={entering} exiting={exiting} style={style}>
      {children}
    </Animated.View>
  );
}
