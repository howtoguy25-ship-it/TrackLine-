import React from "react";
import { StyleSheet } from "react-native";
import { View } from "@/components/ui/Surface";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Text } from "@/components/AppText";
import { colors, pillShadow } from "@/theme/tokens";
import { STREET_PILL_FONT, STREET_PILL_HEIGHT } from "@/map/homeMapLogic";

// The pill under the driver's arrow on the home map, riding the top of the "Where to?" sheet on
// the same baseline as the report button (HomeMapControls places it).
//
// Normally it's the name of the street the driver is on, cross-fading (200 ms) when the name
// changes and hidden when the street isn't known -- never a placeholder. After ten seconds
// without moving it changes to "N reports around you" -- the real number of active reports
// within 10 km -- and back to the street name the moment the car moves again. It never shows a
// count of zero, and never a number that wasn't counted. Hidden during navigation (MapScreen only
// shows HomeMapControls on the idle home map), like the reference.

interface Props {
  /** Null = the street isn't known; the pill hides. */
  streetName: string | null;
  /** Active reports within 10km, counted from the live alert list. */
  reportsAround: number;
  /** True once the driver has been stationary for 10 seconds. */
  stationary: boolean;
  /** Never wider than this (keeps it clear of the report button). */
  maxWidth: number;
  scale: number;
}

const PILL_TEXT = "#1F2125";
const CROSS_FADE_MS = 200;

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
          borderColor: PILL_TEXT,
          transform: [{ rotate: "45deg" }],
        }}
      />
      <Text style={{ position: "absolute", fontSize: size * 0.5, fontWeight: "700", color: PILL_TEXT }}>!</Text>
    </View>
  );
}

/** What the pill says right now, or null when it should be hidden. */
export function streetPillText(streetName: string | null, reportsAround: number, stationary: boolean): string | null {
  if (stationary && reportsAround > 0) return reportsAround === 1 ? "1 report around you" : `${reportsAround} reports around you`;
  const name = streetName?.trim();
  return name ? name : null;
}

export function StreetPill({ streetName, reportsAround, stationary, maxWidth, scale }: Props) {
  const text = streetPillText(streetName, reportsAround, stationary);
  if (!text) return null;
  const showReports = stationary && reportsAround > 0;

  const height = STREET_PILL_HEIGHT * scale;
  const pillStyle = [styles.pill, { height, maxWidth, paddingHorizontal: 24 * scale, borderRadius: height / 2 }];

  return (
    <View pointerEvents="none" style={[styles.wrap, { height }]} accessibilityLiveRegion="polite" testID="street-pill">
      {/* Keyed by what it says, so a change cross-fades the old pill out and the new one in. */}
      <Animated.View
        key={text}
        entering={FadeIn.duration(CROSS_FADE_MS)}
        exiting={FadeOut.duration(CROSS_FADE_MS)}
        style={[pillStyle, showReports && styles.row]}
      >
        {showReports && <ReportsMark size={26 * scale} />}
        <Text
          style={[styles.text, { fontSize: STREET_PILL_FONT.size * scale }]}
          numberOfLines={1}
          ellipsizeMode="tail"
          adjustsFontSizeToFit
          minimumFontScale={STREET_PILL_FONT.min / STREET_PILL_FONT.size}
          testID="street-pill-text"
        >
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Both the outgoing and incoming pill sit in the same spot while they cross-fade.
  wrap: { alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  pill: {
    position: "absolute",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...pillShadow,
  },
  row: { flexDirection: "row", gap: 8 },
  text: { color: PILL_TEXT, fontWeight: "700", flexShrink: 1 },
});
