import React from "react";
import { Icon } from "@/components/ui/Icon";
import { View, StyleSheet, Pressable, type LayoutChangeEvent } from "react-native";
import { Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NAV_CARD_THEMES, type NavCardThemeKey } from "@/utils/navCardTheme";
import { colors } from "@/theme/tokens";

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
}: Props) {
  const insets = useSafeAreaInsets();
  const theme = NAV_CARD_THEMES[themeKey];
  const bg = theme.bottomBarBackground ?? theme.background;
  const roundBg = theme.actionBg;
  const onLayout = (e: LayoutChangeEvent) => onHeightChange?.(e.nativeEvent.layout.height);

  return (
    <View style={styles.wrap} pointerEvents="box-none" testID="nav-bottom-bar">
      {!isFollowing ? (
        <Pressable onPress={onRecenter} style={styles.recenter} accessibilityRole="button" accessibilityLabel="Re-centre on my location" testID="nav-recenter">
          <Icon name="locate" size={24} color="#FFFFFF" />
        </Pressable>
      ) : null}
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
          style={styles.centre}
          accessibilityRole="button"
          accessibilityLabel={`Arrive ${arrivalClockText}, ${etaText}, ${distanceRemainingText}. Open trip details.`}
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
  recenter: {
    position: "absolute",
    left: 16,
    bottom: "100%",
    marginBottom: 12,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.recenterGrey,
    alignItems: "center",
    justifyContent: "center",
  },
});
