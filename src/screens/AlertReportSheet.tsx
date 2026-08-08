import React, { forwardRef, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ALERT_COLORS, ALERT_LABELS, type AlertType } from "@/types/alert";
import { AlertTypeGlyph } from "@/components/AlertTypeGlyph";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

const ALERT_TYPES: AlertType[] = [
  "police",
  "emergency_vehicle",
  "hazard",
  "camera",
  "crash",
  "traffic_light",
];

interface Props {
  // Selecting a type is the whole interaction here now -- picking one immediately hands off
  // to MapScreen's placement flow (drag the pin to the exact spot, then Set/Save), rather
  // than this sheet owning a location and a "Share" confirm button itself. Order requested:
  // select the type first, *then* place the pin, not place-first-pick-type-after.
  onTypeSelected: (type: AlertType) => void;
  onClose: () => void;
  onSheetChange?: (index: number) => void;
}

export const AlertReportSheet = forwardRef<BottomSheet, Props>(function AlertReportSheet(
  { onTypeSelected, onClose, onSheetChange },
  ref
) {
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ["44%"], []);

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
      <BottomSheetView style={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.header}>
          <Text style={styles.title}>What do you see?</Text>
          {/* Swipe-down-to-close is easy to miss -- an explicit button next to the title so
              there's always a visible, tappable way out, not just a gesture on the handle. */}
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {ALERT_TYPES.map((type) => (
            <Pressable
              key={type}
              onPress={() => onTypeSelected(type)}
              style={({ pressed }) => [styles.typeButton, pressed && { opacity: pressedOpacity }]}
            >
              {/* Same colored-circle pin treatment as the actual map marker for this alert
                  type (AlertMarker) -- previously this picker showed bare glyphs (a plain
                  vector icon for most types, a full-color emoji with no frame at all for
                  police/crash) with no shared visual language between them, and no visual tie
                  to what the alert actually looks like once placed on the map. */}
              <View style={[styles.typeIconWrap, { backgroundColor: ALERT_COLORS[type] }]}>
                <AlertTypeGlyph type={type} size={24} color="#FFFFFF" />
              </View>
              <Text style={styles.typeLabel}>{ALERT_LABELS[type]}</Text>
            </Pressable>
          ))}
        </View>
      </BottomSheetView>
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
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  typeButton: {
    width: "30%",
    aspectRatio: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
  },
  // Same colored-circle treatment as AlertMarker's own map pin -- see the render call site's
  // own comment for why matching that (rather than a bare, backgroundless glyph) was the fix.
  typeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    ...shadow.low,
  },
  typeLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
    textAlign: "center",
  },
});
