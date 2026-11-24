import { LaneStrip } from "@/components/nav/LaneStrip";
import type { Lane } from "@/nav/lanes";
import React from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { View, StyleSheet, Pressable, type LayoutChangeEvent } from "react-native";
import { Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { ManeuverIcon } from "@/components/icons/RoundaboutIcon";
import type { RouteStep } from "@/services/directions";
import type { NavCardThemeKey } from "@/utils/navCardTheme";
import { GREEN_TEXT } from "@/theme/colors";
import { formatDistance, extractRoundaboutExitNumber, type DistanceUnit } from "@/utils/navFormat";
import { barStreetName, splitRouteShield } from "@/components/navBarText";

// Real, confirmed fix for "generic arrow for every turn shape" -- Google's own MaterialIcons
// font (bundled via @expo/vector-icons, verified directly against its installed glyphmap, not
// guessed) ships a dedicated set of navigation icons whose names already match Google
// Directions' own maneuver vocabulary almost verbatim ("turn-slight-left", "roundabout-right",
// "fork-left", etc. are real glyphs, not just real maneuver strings) -- each one is drawn as the
// actual real turn shape (a slight bend vs. a sharp right-angle vs. a full U, a real roundabout
// loop, a real fork/ramp split), not one straight arrow reused at a different rotation. The only
// real spelling mismatch is Google's "uturn-left"/"uturn-right" (no hyphen before "turn") vs. the
// icon font's "u-turn-left"/"u-turn-right" (hyphenated) -- mapped explicitly below for exactly
// that reason.
export const MANEUVER_ICONS: Record<string, IconName> = {
  "turn-left": "turn-left",
  "turn-right": "turn-right",
  "turn-slight-left": "turn-slight-left",
  "turn-slight-right": "turn-slight-right",
  "turn-sharp-left": "turn-sharp-left",
  "turn-sharp-right": "turn-sharp-right",
  "uturn-left": "u-turn-left",
  "uturn-right": "u-turn-right",
  merge: "merge",
  "roundabout-left": "roundabout-left",
  "roundabout-right": "roundabout-right",
  "fork-left": "fork-left",
  "fork-right": "fork-right",
  "ramp-left": "ramp-left",
  "ramp-right": "ramp-right",
  straight: "straight",
};

interface Props {
  step: RouteStep | null;
  /** The road the driver is on now (unused in the bar; kept for callers). */
  roadName: string | null;
  themeKey: NavCardThemeKey;
  /** Kept for callers; ending the drive lives in the bottom ETA sheet now. */
  onExit?: () => void;
  /** Tapping the bar opens the full list of directions. */
  onExpandDirections: () => void;
  /** The bar's real height, so controls below it are placed under it. */
  onHeightChange?: (height: number) => void;
  /** The step after this one, for the "Then" chip when it comes soon after. */
  nextStep?: RouteStep | null;
  isFinalStep?: boolean;
  /** Tapping the manoeuvre icon says the instruction again. */
  onRepeatInstruction?: () => void;
  distanceUnit?: DistanceUnit;
  lanes?: Lane[] | null;
  /** Metres left to the manoeuvre along the road (live). Falls back to the step's length. */
  metersToManoeuvre?: number | null;
  /** Roundabouts: the real way in and out (nav/roundabout.ts roundaboutGeometryFor). */
  roundaboutGeometry?: { approach: import("@/utils/polyline").LatLng[]; after: import("@/utils/polyline").LatLng[] };
}

export { splitRouteShield, barStreetName };

export const NAV_BAR_BG = "#000000";
export const NAV_BAR_STREET = "#41D8F5";

/**
 * The navigation top bar: full width from the very top of the screen (its black runs up behind
 * the status bar, whose text is light while it shows; the content starts below it), a big
 * white manoeuvre icon on the left, the distance huge and bold with the street in bold cyan
 * under it on one line. The long instruction sentence is spoken, never printed here.
 */
export function NavigationInstructionCard({
  step,
  onExpandDirections,
  onHeightChange,
  nextStep,
  isFinalStep = false,
  onRepeatInstruction,
  distanceUnit = "km",
  lanes,
  metersToManoeuvre,
  roundaboutGeometry,
}: Props) {
  const insets = useSafeAreaInsets();
  if (!step) return null;
  const roundaboutExit =
    step.maneuver === "roundabout-left" || step.maneuver === "roundabout-right" ? extractRoundaboutExitNumber(step.instruction) : undefined;
  const { shield, street } = splitRouteShield(barStreetName(step, isFinalStep));
  const meters = metersToManoeuvre != null && Number.isFinite(metersToManoeuvre) ? Math.max(0, metersToManoeuvre) : step.distanceMeters;
  const showThen = !!nextStep && nextStep.distanceMeters < 150 && !isFinalStep;
  const nextIcon: IconName = (nextStep?.maneuver && MANEUVER_ICONS[nextStep.maneuver]) || "straight";

  // Reported without the status-bar area, which callers add themselves.
  const onLayout = (e: LayoutChangeEvent) => onHeightChange?.(Math.max(0, e.nativeEvent.layout.height - insets.top));

  return (
    <View style={styles.wrap} onLayout={onLayout} testID="nav-top-bar">
      {/* The black bar runs up behind the status bar: its text goes light while the bar shows. */}
      <StatusBar style="light" />
      <Pressable
        onPress={onExpandDirections}
        style={[styles.bar, { paddingTop: insets.top + 6 }]}
        accessibilityRole="button"
        accessibilityLabel={`${formatDistance(meters, distanceUnit)}, ${step.instruction}. Show all directions.`}
      >
        <Pressable onPress={onRepeatInstruction} disabled={!onRepeatInstruction} hitSlop={8} accessibilityLabel="Say the instruction again" style={styles.iconSlot}>
          {isFinalStep ? (
            <Icon name="flag" size={64} color="#FFFFFF" strokeWidth={2.6} />
          ) : (
            <ManeuverIcon
              maneuver={step.maneuver}
              icons={MANEUVER_ICONS}
              size={64}
              color="#FFFFFF"
              dim="rgba(255,255,255,0.38)"
              exit={roundaboutExit ?? null}
              drivingSide={step.drivingSide}
              approach={roundaboutGeometry?.approach ?? step.polyline}
              after={roundaboutGeometry?.after ?? nextStep?.polyline}
            />
          )}
        </Pressable>
        <View style={styles.textCol}>
          <Text style={styles.distance} numberOfLines={1} testID="nav-distance">
            {formatDistance(meters, distanceUnit)}
          </Text>
          <View style={styles.streetRow}>
            {shield ? (
              <View style={styles.shield}>
                <Text style={styles.shieldText}>{shield}</Text>
              </View>
            ) : null}
            {street ? (
              <Text style={styles.street} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} testID="nav-street">
                {street}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
      {lanes && lanes.length > 0 ? (
        <View style={styles.lanes}>
          <LaneStrip lanes={lanes} drivingSide={step.drivingSide} />
        </View>
      ) : null}
      {showThen ? (
        <View style={styles.thenChip} testID="nav-then-chip">
          <Text style={styles.thenText}>Then</Text>
          <Icon name={nextIcon} size={22} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 },
  bar: { backgroundColor: NAV_BAR_BG, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 14, gap: 14 },
  iconSlot: { width: 72, height: 72, alignItems: "center", justifyContent: "center" },
  textCol: { flex: 1, minWidth: 0 },
  distance: { fontSize: 38, fontWeight: "800", color: "#FFFFFF", lineHeight: 44 },
  streetRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  street: { flex: 1, fontSize: 24, fontWeight: "700", color: NAV_BAR_STREET },
  shield: { backgroundColor: GREEN_TEXT, borderRadius: 5, borderWidth: 1.5, borderColor: "#FFFFFF", paddingHorizontal: 6, paddingVertical: 1 },
  shieldText: { fontSize: 16, fontWeight: "800", color: "#FFFFFF" },
  lanes: { backgroundColor: NAV_BAR_BG, paddingBottom: 8, alignItems: "center" },
  thenChip: {
    alignSelf: "flex-start",
    marginLeft: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1C1D20",
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  thenText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
});
