import React, { forwardRef } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Text } from "@/components/AppText";
import BottomSheet, { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";

interface Props {
  onRecenter: () => void;
  show3D: boolean;
  onToggle3D: () => void;
  satelliteOn: boolean;
  onToggleSatellite: () => void;
  onOpenDetection: () => void;
  detectionBatteryLow?: boolean;
  alertsEnabled: boolean;
  onToggleAlerts: () => void;
  onFindRestaurants: () => void;
  onFindHotels: () => void;
  onFindPetrol: () => void;
  onFindParking: () => void;
  onOpenSettings: () => void;
  onSheetChange?: (index: number) => void;
}

// Real, explicit request -- replace the whole column of separate floating circle buttons
// (recenter, satellite/map style, 3D buildings, dashcam, settings, layers) with ONE map-tools
// FAB opening this single clean panel instead. Every control that used to be its own always-
// visible FAB (MapMoreSheet.tsx, this file's predecessor) or a persistent top pill row
// (MapTopPillRow.tsx, now deleted) lives here as a labelled row instead -- same real
// @gorhom/bottom-sheet pattern NavOptionsSheet.tsx already uses, just with every map control in
// one place instead of three separate buttons plus a row of pills.
export const MapToolsSheet = forwardRef<BottomSheet, Props>(function MapToolsSheet(
  {
    onRecenter,
    show3D,
    onToggle3D,
    satelliteOn,
    onToggleSatellite,
    onOpenDetection,
    detectionBatteryLow,
    alertsEnabled,
    onToggleAlerts,
    onFindRestaurants,
    onFindHotels,
    onFindPetrol,
    onFindParking,
    onOpenSettings,
    onSheetChange,
  },
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
      <BottomSheetScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Map tools</Text>

        <SectionLabel label="Map" />
        <OptionRow icon="locate" label="Recenter" onPress={onRecenter} />
        <ToggleRow icon="business-outline" label="3D buildings" on={show3D} onPress={onToggle3D} />
        <ToggleRow icon="map-outline" label="Satellite view" on={satelliteOn} onPress={onToggleSatellite} />

        <View style={styles.divider} />

        <SectionLabel label="Nearby" />
        <ToggleRow icon="radio-outline" label="Alerts" on={alertsEnabled} onPress={onToggleAlerts} />
        <OptionRow icon="restaurant-outline" label="Restaurants" onPress={onFindRestaurants} />
        <OptionRow icon="bed-outline" label="Hotels" onPress={onFindHotels} />
        <OptionRow icon="car-outline" label="Petrol stations" onPress={onFindPetrol} />
        <OptionRow icon="square-outline" label="Parking" onPress={onFindParking} />

        <View style={styles.divider} />

        <OptionRow
          icon="videocam-outline"
          label="Dashcam"
          subtitle={detectionBatteryLow ? "Battery below 50% -- still works, may run slower" : undefined}
          onPress={onOpenDetection}
          trailing={<Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
        />
        <OptionRow
          icon="settings-outline"
          label="Settings"
          onPress={onOpenSettings}
          trailing={<Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
        />
      </BottomSheetScrollView>
    </BottomSheet>
  );
});

const SNAP_POINTS = ["55%", "85%"];

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

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
  trailing?: React.ReactNode;
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
  scroll: {
    flex: 1,
  },
  container: {
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  rowIconWrap: {
    width: 38,
    height: 38,
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
  divider: {
    height: 1,
    backgroundColor: colors.surfaceMuted,
    marginVertical: spacing.sm,
  },
});
