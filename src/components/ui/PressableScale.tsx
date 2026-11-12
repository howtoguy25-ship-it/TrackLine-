import React, { useCallback } from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { PRESS_DARKEN } from "@/theme/colors";

// The app's one press feedback, used by every button in components/ui: while held the control
// shrinks to 96% and darkens by 6%, over 120ms, with a light haptic tap. No spring and no
// overshoot. With Reduce Motion on, it only darkens.

export const PRESS_SCALE = 0.96;
export const PRESS_MS = 120;
const TIMING = { duration: PRESS_MS, easing: Easing.out(Easing.quad) };

interface Props extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** Set false for controls where a buzz on every press would be too much. */
  haptic?: boolean;
  children?: React.ReactNode;
}

// The Pressable itself is the animated, sized element. (It used to be a flex:1 child of an
// Animated.View; with flex:1 a child gets no height of its own unless the wrapper has a fixed
// one, so a button styled by its padding could draw fine while its touchable area was zero.)
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({ style, haptic = true, onPressIn, onPressOut, children, ...rest }: Props) {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);
  // .get()/.set() rather than .value: the same thing, in the form the React Compiler accepts.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : 1 - (1 - PRESS_SCALE) * pressed.get() }],
  }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: PRESS_DARKEN * pressed.get() }));
  const radius = (StyleSheet.flatten(style)?.borderRadius as number | undefined) ?? 0;

  const handlePressIn = useCallback<NonNullable<PressableProps["onPressIn"]>>(
    (event) => {
      pressed.set(withTiming(1, TIMING));
      // Fire-and-forget: a phone with haptics off (or without them) just doesn't buzz.
      if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onPressIn?.(event);
    },
    [haptic, onPressIn, pressed]
  );
  const handlePressOut = useCallback<NonNullable<PressableProps["onPressOut"]>>(
    (event) => {
      pressed.set(withTiming(0, TIMING));
      onPressOut?.(event);
    },
    [onPressOut, pressed]
  );

  // onPress, onLongPress, disabled, accessibility props etc. all pass straight through in `rest`.
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.centered, style, animatedStyle]}
    >
      {children}
      {/* The 6% darken: black at 6% over the whole control, its own shape. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shade, { borderRadius: radius }, shadeStyle]} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
  shade: { backgroundColor: "#000000", opacity: 0 },
});
