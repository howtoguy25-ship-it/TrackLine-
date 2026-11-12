import React, { forwardRef, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { View, StyleSheet } from "react-native";
import { Text } from "@/components/AppText";
import BottomSheet, { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MANEUVER_ICONS } from "@/components/NavigationInstructionCard";
import type { Route, RouteStep } from "@/services/directions";
import { colors, radius, shadow, spacing } from "@/theme/tokens";

interface Props {
  route: Route | null;
  activeStepIndex: number;
  onClose: () => void;
  onSheetChange?: (index: number) => void;
}

export const RouteDirectionsSheet = forwardRef<BottomSheet, Props>(function RouteDirectionsSheet(
  { route, activeStepIndex, onClose, onSheetChange },
  ref
) {
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ["65%"], []);

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={onSheetChange}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      {route && (
        <>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Directions</Text>
              <Text style={styles.subtitle}>
                {route.distanceText} · {route.etaInTrafficText ?? route.etaText}
                {route.hasTrafficDelay ? " (traffic)" : ""}
              </Text>
            </View>
            <Button
              variant="ghost"
              icon="close"
              iconColor={colors.textMuted}
              onPress={onClose}
              accessibilityLabel="Close"
            />
          </View>
          <BottomSheetFlatList keyboardShouldPersistTaps="handled"
            data={route.steps}
            keyExtractor={(_: RouteStep, i: number) => String(i)}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
            renderItem={({ item, index }: { item: RouteStep; index: number }) => {
              const icon = (item.maneuver && MANEUVER_ICONS[item.maneuver]) || "straight";
              const isActive = index === activeStepIndex;
              const isPast = index < activeStepIndex;
              return (
                <View style={[styles.row, isActive && styles.rowActive]}>
                  <View style={[styles.iconWrap, isActive && styles.iconWrapActive, isPast && styles.iconWrapPast]}>
                    <Icon name={icon} size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.instruction, isPast && styles.instructionPast]}>
                      {item.instruction}
                    </Text>
                    <Text style={styles.meta}>
                      {(item.distanceMeters / 1000).toFixed(1)} km ·{" "}
                      {Math.max(1, Math.round(item.durationSeconds / 60))} min
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        </>
      )}
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.high,
  },
  handleIndicator: {
    backgroundColor: colors.border,
    width: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowActive: {
    backgroundColor: colors.surfaceMuted,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapActive: {
    backgroundColor: colors.accent,
  },
  iconWrapPast: {
    backgroundColor: colors.textFaint,
  },
  instruction: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  instructionPast: {
    color: colors.textMuted,
  },
  meta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
