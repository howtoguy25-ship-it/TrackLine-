import React from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { View, StyleSheet, Pressable, type LayoutChangeEvent } from "react-native";
import { Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NAV_CARD_THEMES, type NavCardThemeKey } from "@/utils/navCardTheme";
import { colors, pressedOpacity, radius, shadow, spacing } from "@/theme/tokens";

interface Props {
  etaText: string;
  arrivalClockText: string;
  distanceRemainingText: string;
  roadName: string | null;
  themeKey: NavCardThemeKey;
  hasStop: boolean;
  onAddStop: () => void;
  onRemoveStop: () => void;
  onOptions: () => void;
  // Same real-measured-height pattern NavigationInstructionCard already uses for the controls
  // above it -- MapScreen shifts the FAB column up by this bar's actual height so the two
  // never collide, instead of guessing a fixed number that only holds for one line count.
  onHeightChange?: (height: number) => void;
  // Real, explicit request (Waze-style redesign, Phase 1B section 7) -- whether the camera is
  // currently auto-following the driver (MapScreen's own `followTilt`). When true, this bar
  // shows the normal arrival/ETA info (tap = open route options); when false (the driver
  // manually panned/zoomed/rotated away), it switches to a big Re-centre control instead.
  isFollowing: boolean;
  onRecenter: () => void;
  // Real, explicit request -- fits the whole remaining route in view. Reuses MapScreen's
  // existing pulled-back 3D "overview" pose toggle (applyOverviewPose) rather than a full
  // fit-bounds-to-route computation, which this screen doesn't have yet -- see NOTES.md.
  onOverview: () => void;
}

// Waze/Google-Maps-style persistent trip strip at the bottom of the screen. Two real states:
// "following" (the normal case -- live ETA/arrival/distance + road, tap to open route options)
// and "re-centre" (once a manual gesture has dropped the camera out of auto-follow -- a big,
// unmissable button to resume it, same real `followTilt` state MapScreen already tracks for its
// own chase-cam logic). An "Overview" pill stays visible either way.
export function NavBottomBar({
  etaText,
  arrivalClockText,
  distanceRemainingText,
  roadName,
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

  const onLayout = (e: LayoutChangeEvent) => {
    onHeightChange?.(e.nativeEvent.layout.height);
  };

  return (
    <View
      style={[styles.bar, { backgroundColor: theme.bottomBarBackground ?? theme.background, bottom: insets.bottom + spacing.sm }]}
      onLayout={onLayout}
    >
      {isFollowing ? (
        <Pressable
          style={({ pressed }) => [styles.info, pressed && { opacity: pressedOpacity }]}
          onPress={onOptions}
          accessibilityLabel="Trip options"
        >
          <Text style={[styles.arrivalText, { color: theme.text }]} numberOfLines={1}>
            {arrivalClockText}
          </Text>
          <Text style={[styles.infoSecondary, { color: theme.textSecondary }]} numberOfLines={1}>
            {etaText} · {distanceRemainingText}
          </Text>
          {roadName && (
            <Text style={[styles.roadText, { color: theme.textSecondary }]} numberOfLines={1}>
              {roadName}
            </Text>
          )}
        </Pressable>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.recentreRow, pressed && { opacity: pressedOpacity }]}
          onPress={onRecenter}
          accessibilityLabel="Re-centre on my location"
        >
          <View style={styles.recentreCircle}>
            <View style={styles.recentreCrosshairRing} />
            <Icon name="navigate" size={22} color="#FFFFFF" />
          </View>
          <View>
            <Text style={styles.recentreText}>Re-centre</Text>
            <Text style={[styles.infoSecondary, { color: theme.textSecondary }]} numberOfLines={1}>
              {etaText} · {distanceRemainingText}
            </Text>
          </View>
        </Pressable>
      )}

      <Button
        variant="secondary"
        label="Overview"
        onPress={onOverview}
        accessibilityLabel="Overview of the whole route"
      />

      <Button
        variant="secondary"
        icon={hasStop ? "close-circle-outline" : "add"}
        onPress={hasStop ? onRemoveStop : onAddStop}
        accessibilityLabel={hasStop ? "Remove stop" : "Add a stop"}
      />

      <Button
        variant="secondary"
        icon="ellipsis-vertical"
        onPress={onOptions}
        accessibilityLabel="More options"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    borderRadius: radius.xl,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadow.medium,
  },
  info: {
    flex: 1,
  },
  // Real, explicit request (Phase 1B section 7) -- arrival clock time gets its own bold,
  // prominent line, separate from the eta/distance line below it (was one combined line).
  arrivalText: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  infoSecondary: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  roadText: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 1,
    opacity: 0.85,
  },
  // Real, explicit request -- the Re-centre state's big circle button. 56px here (not the
  // brief's literal 80pt) to fit this bar's real shared-row width alongside the Overview pill
  // and the existing add-stop/options buttons -- see NOTES.md.
  recentreRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  recentreCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.recenterGrey,
    alignItems: "center",
    justifyContent: "center",
  },
  recentreCrosshairRing: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.45)",
  },
  recentreText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
  },
});
