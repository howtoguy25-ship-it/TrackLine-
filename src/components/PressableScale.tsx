import React, { useCallback } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

// The app's standard press feedback: the control dips to 94% on a spring and gives a light
// haptic tap. Used by the floating map buttons and the primary action buttons, so pressing
// anything important feels the same everywhere.

const PRESSED_SCALE = 0.94;
const SPRING = { damping: 15, stiffness: 320, mass: 0.6 };

interface Props extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** Set false for controls where a buzz on every press would be too much. */
  haptic?: boolean;
  children?: React.ReactNode;
}

export function PressableScale({ style, haptic = true, onPressIn, onPressOut, children, ...rest }: Props) {
  const scale = useSharedValue(1);
  // .get()/.set() rather than .value: the same thing, in the form the React Compiler accepts.
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const handlePressIn = useCallback<NonNullable<PressableProps["onPressIn"]>>(
    (event) => {
      scale.set(withSpring(PRESSED_SCALE, SPRING));
      // Fire-and-forget: a phone with haptics off (or without them) just doesn't buzz.
      if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onPressIn?.(event);
    },
    [haptic, onPressIn, scale]
  );
  const handlePressOut = useCallback<NonNullable<PressableProps["onPressOut"]>>(
    (event) => {
      scale.set(withSpring(1, SPRING));
      onPressOut?.(event);
    },
    [onPressOut, scale]
  );

  return (
    <Animated.View style={[style, animatedStyle]}>
      <Pressable {...rest} onPressIn={handlePressIn} onPressOut={handlePressOut} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {children}
      </Pressable>
    </Animated.View>
  );
}
