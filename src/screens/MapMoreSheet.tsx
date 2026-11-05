import React, { forwardRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";

interface Props {
  onOpenDetection: () => void;
  detectionBatteryLow?: boolean;
  show3D: boolean;
  onToggle3D: () => void;
  satelliteOn: boolean;
  onToggleSatellite: () => void;
  onSheetChange?: (index: number) => void;
}

// Real, explicit request -- declutter the home map screen. AI Vehicle Detection, the 3D
// buildings toggle, and the satellite/map-type toggle used to be 3 separate always-visible FABs
// stacked on the same screen edge as Locate and the "+" report button (5 buttons total). Those
// three are secondary, occasional-use controls (not something tapped every session the way
// search/report/locate are), so they're condensed into this one small sheet behind a single
// "More" FAB instead -- same real @gorhom/bottom-sheet pattern NavOptionsSheet.tsx already uses
// for the equivalent in-navigation "..." menu, reused here for consistency rather than inventing
// a second pattern.
export const MapMoreSheet = forwardRef<BottomSheet, Props>(function MapMoreSheet(
  { onOpenDetection, detectionBatteryLow, show3D, onToggle3D, satelliteOn, onToggleSatellite, onSheetChange },
  ref
) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onChange={onSheetChange}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.title}>More</Text>

        <OptionRow
          icon="videocam-outline"
          label="AI Vehicle Detection"
          subtitle={detectionBatteryLow ? "Battery below 50% -- still works, may run slower" : undefined}
          onPress={onOpenDetection}
          trailing={<Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
        />
        <ToggleRow icon="business-outline" label="3D buildings" on={show3D} onPress={onToggle3D} />
        <ToggleRow icon="map-outline" label="Satellite view" on={satelliteOn} onPress={onToggleSatellite} />
      </BottomSheetView>
    </BottomSheet>
  );
});

const SNAP_POINTS = ["32%"];

function OptionRow({
  icon,
  label,
  subtitle,
  onPress,
  trailing,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress: () => void;
  trailing: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
      accessibilityLabel={subtitle ? `${label} -- ${subtitle}` : label}
    >
      <View style={styles.rowIconWrap}>
        <Ionicons name={icon} size={20} color={colors.text} />
      </View>
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}
      </View>
      {trailing}
    </Pressable>
  );
}

function ToggleRow({
  icon,
  label,
  on,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <OptionRow
      icon={icon}
      label={label}
      onPress={onPress}
      trailing={
        <View style={[styles.toggleTrack, on && styles.toggleTrackOn]}>
          <View style={[styles.toggleThumb, on && styles.toggleThumbOn]} />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  handleIndicator: {
    backgroundColor: colors.surfaceMuted,
    width: 40,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTextWrap: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  rowSubtitle: {
    fontSize: 12,
    color: colors.warning,
    marginTop: 1,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    padding: 3,
    justifyContent: "center",
  },
  toggleTrackOn: {
    backgroundColor: colors.accent,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
  },
  toggleThumbOn: {
    transform: [{ translateX: 18 }],
  },
});
