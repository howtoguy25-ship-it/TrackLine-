import React from "react";
import { RECENTER_ABOVE_BAR, RECENTER_SIZE, REPORT_SIZE, SIDE_MARGIN } from "@/nav/navControlsLayout";
import { Icon } from "@/components/ui/Icon";
import { View, StyleSheet, Pressable, type LayoutChangeEvent } from "react-native";
import { Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NAV_CARD_THEMES, type NavCardThemeKey } from "@/utils/navCardTheme";
import { colors } from "@/theme/tokens";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, type SharedValue } from "react-native-reanimated";

interface Props {
  etaText: string;
  arrivalClockText: string;
  distanceRemainingText: string;
  /** Kept for callers; the street shows in the pill above the bar. */
  roadName: string | null;
  themeKey: NavCardThemeKey;
  hasStop: boolean;
  /** Search along the route (fuel, food, parking) and add it as a stop. */
  onAddStop: () => void;
  onRemoveStop: () => void;
  /** Opens the ETA sheet (arrival, events on route, best time to leave, Stop). */
  onOptions: () => void;
  onHeightChange?: (height: number) => void;
  isFollowing: boolean;
  onRecenter: () => void;
  /** The routes button: the whole route on screen (and the other routes). */
  onOverview: () => void;
  /** Long-press the bar: end navigation (asks first). */
  onLongPressEnd?: () => void;
  /** The ahead banner raising the controls above the bar (pt, animated): Re-centre rises with them. */
  raise?: SharedValue<number>;
}

export const NAV_BOTTOM_BAR_HEIGHT = 110;

/**
 * The bottom bar while navigating (Waze-style): a thick bar across the full bottom. Round search
 * button on the left, arrival time large in the middle with "25 min • 28 km" under it, round
 * routes button on the right. Tapping the middle opens the ETA sheet. Re-centre is its own
 * round button above the bar, only after the map has been panned -- nothing ever sits on top of
 * the arrival time.
 */
export function NavBottomBar({
  etaText,
  arrivalClockText,
  distanceRemainingText,
  themeKey,
  hasStop,
  onAddStop,
  onRemoveStop,
  onOptions,
  onHeightChange,
  isFollowing,
  onRecenter,
  onOverview,
  onLongPressEnd,
  raise,
}: Props) {
  const insets = useSafeAreaInsets();
  const theme = NAV_CARD_THEMES[themeKey];
  const bg = theme.bottomBarBackground ?? theme.background;
  const roundBg = theme.actionBg;
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -(raise?.get() ?? 0) }] }));
  const onLayout = (e: LayoutChangeEvent) => onHeightChange?.(e.nativeEvent.layout.height);
  // Drag the bar up: the ETA sheet (same as tapping the arrival time), so it's always reachable.
  const swipeUp = Gesture.Pan()
    .activeOffsetY(-15)
    .onEnd((e) => {
      if (e.translationY < -30) runOnJS(onOptions)();
    });

  return (
    <View style={styles.wrap} pointerEvents="box-none" testID="nav-bottom-bar">
      {!isFollowing ? (
        <Animated.View style={lift} pointerEvents="box-none">
          <Pressable onPress={onRecenter} style={styles.recenter} accessibilityRole="button" accessibilityLabel="Re-centre on my location" testID="nav-recenter">
            <Icon name="locate" size={24} color="#FFFFFF" />
          </Pressable>
        </Animated.View>
      ) : null}
      <GestureDetector gesture={swipeUp}>
      <View style={[styles.bar, { backgroundColor: bg, paddingBottom: insets.bottom + 10, minHeight: NAV_BOTTOM_BAR_HEIGHT + insets.bottom }]} onLayout={onLayout}>
        <Pressable
          onPress={hasStop ? onRemoveStop : onAddStop}
          style={[styles.round, { backgroundColor: roundBg }]}
          accessibilityRole="button"
          accessibilityLabel={hasStop ? "Remove the stop" : "Search along the route"}
          testID="nav-search"
        >
          <Icon name={hasStop ? "close" : "search"} size={24} color={theme.text} />
        </Pressable>
        <Pressable
          onPress={onOptions}
          onLongPress={onLongPressEnd}
          delayLongPress={600}
          style={styles.centre}
          accessibilityRole="button"
          accessibilityLabel={`Arrive ${arrivalClockText}, ${etaText}, ${distanceRemainingText}. Open trip details.`}
          accessibilityHint="Swipe up or tap for trip details and Stop. Long-press to end navigation."
          testID="nav-eta"
        >
          <View style={[styles.grabber, { backgroundColor: theme.textSecondary }]} />
          <Text style={[styles.arrival, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
            {arrivalClockText}
          </Text>
          <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>
            {etaText} • {distanceRemainingText}
          </Text>
        </Pressable>
        <Pressable onPress={onOverview} style={[styles.round, { backgroundColor: roundBg }]} accessibilityRole="button" accessibilityLabel="Routes and overview" testID="nav-routes">
          <Icon name="swap-vertical" size={24} color={theme.text} />
        </Pressable>
      </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  round: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  centre: { flex: 1, alignItems: "center", minHeight: 56, justifyContent: "center" },
  grabber: { width: 36, height: 4, borderRadius: 2, opacity: 0.5, marginBottom: 6 },
  arrival: { fontSize: 30, fontWeight: "800" },
  sub: { fontSize: 15, fontWeight: "500", marginTop: 2 },
  // Bottom-RIGHT, over the Report button (nav/navControlsLayout.ts). It used to sit bottom-left,
  // exactly on top of the speedometer.
  recenter: {
    position: "absolute",
    right: SIDE_MARGIN + (REPORT_SIZE - RECENTER_SIZE) / 2,
    bottom: "100%",
    marginBottom: RECENTER_ABOVE_BAR,
    width: RECENTER_SIZE,
    height: RECENTER_SIZE,
    borderRadius: RECENTER_SIZE / 2,
    backgroundColor: colors.recenterGrey,
    alignItems: "center",
    justifyContent: "center",
  },
});
