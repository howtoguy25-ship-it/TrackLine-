import React, { forwardRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

interface Props {
  onReportAlert: () => void;
  onShareEta: () => void;
  onOpenDetection: () => void;
  onEndNavigation: () => void;
  onClose: () => void;
  onSheetChange?: (index: number) => void;
  // Same live battery reading MapScreen's own AI Detection FAB badge uses -- advisory only,
  // never disables this row. See MapScreen.tsx's detectionBatteryLow comment for the full
  // reasoning (in particular: why this never interrupts a session already open).
  detectionBatteryLow?: boolean;
}

// The "..." button on the new bottom trip bar (see NavBottomBar.tsx) -- everything that used
// to live in the nav card's own actions row (Report/Share ETA/AI Detection) plus a dedicated
// End Navigation entry now lives here instead, matching the explicit ask for a compact bottom
// tab (ETA/road/Add Stop/options) rather than a wide row of icons competing with the turn
// instructions for space.
export const NavOptionsSheet = forwardRef<BottomSheet, Props>(function NavOptionsSheet(
  { onReportAlert, onShareEta, onOpenDetection, onEndNavigation, onClose, onSheetChange, detectionBatteryLow },
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
        <View style={styles.header}>
          <Text style={styles.title}>Trip options</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        <OptionRow icon="warning" iconBg="#F59E0B" iconColor="#111827" label="Report an incident" onPress={onReportAlert} />
        <OptionRow icon="share-outline" iconBg="#DBEAFE" iconColor="#1D4ED8" label="Share ETA" onPress={onShareEta} />
        <OptionRow
          icon="videocam-outline"
          iconBg="#EDE9FE"
          iconColor="#7C3AED"
          label="AI Vehicle Detection"
          subtitle={detectionBatteryLow ? "Battery below 50% -- still works, may run slower" : undefined}
          onPress={onOpenDetection}
        />

        <View style={styles.divider} />

        <Pressable
          onPress={onEndNavigation}
          style={({ pressed }) => [styles.endButton, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel="End navigation"
        >
          <Ionicons name="close-circle" size={20} color="#FFFFFF" />
          <Text style={styles.endButtonText}>End navigation</Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
});

const SNAP_POINTS = ["42%"];

function OptionRow({
  icon,
  iconBg,
  iconColor,
  label,
  labelColor,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  label: string;
  labelColor?: string;
  // Small advisory line under the label (e.g. a battery warning) -- purely informational, never
  // changes what onPress does.
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
      accessibilityLabel={subtitle ? `${label} -- ${subtitle}` : label}
    >
      <View style={[styles.rowIconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.rowTextWrap}>
        <Text style={[styles.rowLabel, labelColor ? { color: labelColor } : null]}>{label}</Text>
        {subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  rowIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
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
  divider: {
    height: 1,
    backgroundColor: colors.surfaceMuted,
    marginVertical: spacing.md,
  },
  // Real, explicit request for a more polished look -- End navigation is a destructive, trip-
  // ending action, not just another row in the list, so it now reads as its own clear, full-
  // width button instead of blending in with Report/Share/AI Detection's identical row shape.
  endButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "#DC2626",
    borderRadius: radius.lg,
    paddingVertical: spacing.sm + 6,
    ...shadow.low,
  },
  endButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
});
