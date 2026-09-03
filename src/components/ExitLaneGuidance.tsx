import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, shadow, spacing } from "@/theme/tokens";

interface Props {
  // Real signal, not a guess -- derived straight from Google's own maneuver code
  // (ramp-left/ramp-right/fork-left/fork-right, see MapScreen's EXIT_MANEUVERS) by whichever
  // side of "left"/"right" is in that string. Classic Google Directions doesn't return real
  // per-lane-count data (no "use lane 2 of 4" here), so this only ever claims the one thing
  // that data genuinely supports: which SIDE of the road the exit peels off from -- the same
  // "Keep Right"/"Keep Left" language real highway exit signage itself uses.
  direction: "left" | "right";
  distanceMeters: number;
  instruction: string;
  bottom: number;
}

// Real highway exit sign green (matches AU/US/UK exit signage convention) -- a deliberately
// different color from the route line's blue and the top instruction card's own theme, so this
// reads immediately as "a distinct, urgent, this-moment-only" signal, not just a restyled
// version of the always-on turn card.
const EXIT_GREEN = "#15803D";

function formatDistance(meters: number): string {
  const rounded = Math.max(10, Math.round(meters / 10) * 10);
  return rounded < 1000 ? `${rounded} m` : `${(rounded / 1000).toFixed(1)} km`;
}

export function ExitLaneGuidance({ direction, distanceMeters, instruction, bottom }: Props) {
  const translateY = useRef(new Animated.Value(60)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 16, stiffness: 180, mass: 0.9 }),
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
    // Mount-once slide/fade in -- this component is only ever mounted while the exit-zoom
    // window is active (MapScreen conditionally renders it), so there's no later prop change
    // that should replay this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { bottom, transform: [{ translateY }], opacity }]}
    >
      <View style={styles.bar}>
        <View style={styles.chevronWrap}>
          <Ionicons name={direction === "left" ? "chevron-back" : "chevron-forward"} size={26} color="#FFFFFF" />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>KEEP {direction === "left" ? "LEFT" : "RIGHT"} FOR THE EXIT</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {instruction}
          </Text>
        </View>
        <View style={styles.distancePill}>
          <Text style={styles.distanceText}>{formatDistance(distanceMeters)}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    backgroundColor: EXIT_GREEN,
    borderRadius: radius.xl,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    ...shadow.high,
  },
  chevronWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  subtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 1,
  },
  distancePill: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  distanceText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
});
