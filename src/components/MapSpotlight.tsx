import React from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { SPOTLIGHT_DIAMETER, SPOTLIGHT_DIM } from "@/map/alertCard";

// Dims the map to 45% black everywhere except a soft, feathered circle (~140pt) around the
// tapped pin -- the "spotlight" behind the alert card on the home map. One full-screen radial
// gradient: clear in the middle, easing out to the dim over the feather, flat dim beyond it.
// Tapping anywhere on it dismisses the card (the "tap the map" dismiss).

interface Props {
  width: number;
  height: number;
  /** Where the pin sits on screen. */
  centre: { x: number; y: number };
  onPress: () => void;
}

/** The clear core as a share of the gradient's radius; the rest is the feather. */
const CLEAR_CORE = 0.55;
/** The feather runs a little past the circle's nominal edge so it reads soft, not as a ring. */
const FEATHER_SCALE = 1.3;

export function MapSpotlight({ width, height, centre, onPress }: Props) {
  const r = (SPOTLIGHT_DIAMETER / 2) * FEATHER_SCALE;
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(200)}
      style={StyleSheet.absoluteFill}
      testID="map-spotlight"
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onPress} accessibilityRole="button" accessibilityLabel="Close the alert">
        <Svg width={width} height={height} pointerEvents="none">
          <Defs>
            <RadialGradient id="spot" cx={centre.x} cy={centre.y} r={r} fx={centre.x} fy={centre.y} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#000000" stopOpacity={0} />
              <Stop offset={CLEAR_CORE} stopColor="#000000" stopOpacity={0} />
              <Stop offset="1" stopColor="#000000" stopOpacity={SPOTLIGHT_DIM} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill="url(#spot)" />
        </Svg>
      </Pressable>
    </Animated.View>
  );
}
