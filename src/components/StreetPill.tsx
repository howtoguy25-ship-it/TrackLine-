import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutUp } from "react-native-reanimated";
import { Text } from "@/components/AppText";
import { colors, shadow } from "@/theme/tokens";

// The pill under the driver's arrow on the home map.
//
// Normally it's the name of the street the driver is on, cross-fading when the name changes and
// disappearing when the street isn't known. After ten seconds without moving it slides over to
// "N reports around you" -- the real number of active reports within 10km -- and slides back to
// the street name the moment the car moves again. It never shows a count of zero, and never a
// number that wasn't counted.

interface Props {
  /** Null = the street isn't known; the pill hides. */
  streetName: string | null;
  /** Active reports within 10km, counted from the live alert list. */
  reportsAround: number;
  /** True once the driver has been stationary for 10 seconds. */
  stationary: boolean;
  /** Distance from the top of the screen to the pill's top edge. */
  top: number;
  scale: number;
}

/** A small original mark for the reports pill: a warning diamond, drawn from two views. */
function ReportsMark({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: size * 0.72,
          height: size * 0.72,
          borderRadius: size * 0.16,
          backgroundColor: colors.reportYellow,
          borderWidth: 1.5,
          borderColor: colors.text,
          transform: [{ rotate: "45deg" }],
        }}
      />
      <Text style={{ position: "absolute", fontSize: size * 0.5, fontWeight: "700", color: colors.text }}>!</Text>
    </View>
  );
}

export function StreetPill({ streetName, reportsAround, stationary, top, scale }: Props) {
  const showReports = stationary && reportsAround > 0;
  // Which pill is on screen is keyed, so React swaps one element for another and the
  // entering/exiting animations below run: a slide between the two modes, a cross-fade between
  // two street names.
  const mode = showReports ? "reports" : streetName ? `street:${streetName}` : "none";

  if (mode === "none") return null;

  const height = 48 * scale;
  const pillStyle = [styles.pill, { height, paddingHorizontal: 22 * scale, borderRadius: height / 2 }];
  const textStyle = [styles.text, { fontSize: 20 * scale }];

  return (
    <View pointerEvents="none" style={[styles.wrap, { top }]} accessibilityLiveRegion="polite">
      {showReports ? (
        <Animated.View
          key="reports"
          entering={SlideInDown.duration(260)}
          exiting={SlideOutUp.duration(220)}
          style={[pillStyle, styles.row]}
        >
          <ReportsMark size={26 * scale} />
          <Text style={textStyle} numberOfLines={1}>
            {reportsAround === 1 ? "1 report around you" : `${reportsAround} reports around you`}
          </Text>
        </Animated.View>
      ) : (
        <Animated.View
          key={mode}
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={pillStyle}
        >
          <Text style={textStyle} numberOfLines={1}>
            {streetName}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 24, right: 24, alignItems: "center" },
  pill: {
    maxWidth: "100%",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...shadow.floating,
  },
  row: { flexDirection: "row", gap: 8 },
  text: { color: colors.text, fontWeight: "600" },
});
