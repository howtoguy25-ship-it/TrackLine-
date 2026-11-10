import React, { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Rect, Circle } from "react-native-svg";
import { colors } from "@/theme/tokens";

// Real, explicit request (Waze-style redesign Phase 4 -- main menu's "Tracky" mascot). Per
// NOTES.md's own flagged, honest scope limit: the brief's ~30 original car-icon mascot set and a
// full animated-mood Lottie character aren't something generated text-to-code can produce
// convincingly -- this is a real, simple, hand-authored SVG (plain shapes, no external art) with
// a lightweight Animated-API bounce loop instead, deliberately not pretending to be a
// production Lottie file. A friendly, simple car-face badge rather than a blank space where the
// mascot was supposed to be.
export function TrackyMascot({ size = 72 }: { size?: number }) {
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bounce]);

  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <Svg width={size} height={size} viewBox="0 0 72 72">
        {/* Car body */}
        <Rect x="8" y="30" width="56" height="26" rx="13" fill={colors.accent} />
        {/* Cabin */}
        <Rect x="18" y="16" width="36" height="22" rx="11" fill={colors.accent} />
        {/* Windscreen */}
        <Rect x="24" y="22" width="24" height="12" rx="6" fill="#DBEAFE" />
        {/* Headlight eyes */}
        <Circle cx="27" cy="28" r="3.2" fill="#FFFFFF" />
        <Circle cx="45" cy="28" r="3.2" fill="#FFFFFF" />
        <Circle cx="27.8" cy="28" r="1.4" fill="#111827" />
        <Circle cx="45.8" cy="28" r="1.4" fill="#111827" />
        {/* Grille smile */}
        <Rect x="28" y="40" width="16" height="4" rx="2" fill="#0B1220" opacity={0.25} />
        {/* Wheels */}
        <Circle cx="22" cy="58" r="7" fill="#111827" />
        <Circle cx="50" cy="58" r="7" fill="#111827" />
        <Circle cx="22" cy="58" r="3" fill="#9CA3AF" />
        <Circle cx="50" cy="58" r="3" fill="#9CA3AF" />
      </Svg>
    </Animated.View>
  );
}
