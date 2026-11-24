import React, { forwardRef, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StyleSheet, ScrollView } from "react-native";
import { Pressable, View } from "@/components/ui/Surface";
import { SurfaceScheme } from "@/components/ui/surfaceScheme";
import { SURFACES } from "@/theme/colors";
import { Text } from "@/components/AppText";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReportItemIcon } from "@/components/settings/ReportItemIcon";
import { REPORT_ITEM_BY_ID, type ReportItemId } from "@/settings/reportCatalog";
import { GRID_LABEL, REPORT_CATEGORIES, type ReportCategory } from "@/settings/reportGrid";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import { MapSheet } from "@/components/MapSheet";

// The report grid: categories (Police, Crash, Traffic, Camera, Hazard, Road feature...), each
// opening its own items -- every item in Settings > Reports can be reported here, each with its
// own icon. A one-item category reports straight away. Choosing an item hands off to MapScreen's
// placement flow (drag the pin, Set) with the item; "Speed limit / school zone" opens the road
// report sheet instead.
// Dark like the rest of the driving UI, a big "Report" title and the kinds as large round
// coloured icons in a 3-wide grid, so the right one is quick to hit at a glance.

interface Props {
  onItemSelected: (item: ReportItemId) => void;
  /** "Speed limit / school zone": the road report sheet. */
  onRoadReport: () => void;
  onClose: () => void;
  onSheetChange?: (index: number) => void;
}

export const itemLabel = (item: ReportItemId) => GRID_LABEL[item] ?? REPORT_ITEM_BY_ID[item].title;

export const AlertReportSheet = forwardRef<BottomSheet, Props>(function AlertReportSheet(
  { onItemSelected, onRoadReport, onClose, onSheetChange },
  ref
) {
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ["62%"], []);
  const [category, setCategory] = useState<ReportCategory | null>(null);

  const pickCategory = (c: ReportCategory) => {
    if (c.roadSheet) {
      setCategory(null);
      onRoadReport();
      return;
    }
    if (c.items.length === 1) {
      setCategory(null);
      onItemSelected(c.items[0]);
      return;
    }
    setCategory(c);
  };

  return (
    <MapSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={(i) => {
        if (i < 0) setCategory(null);
        onSheetChange?.(i);
      }}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <SurfaceScheme value="dark">
      <BottomSheetView style={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.header}>
          {category ? (
            <Button variant="ghost" icon="chevron-back" onPress={() => setCategory(null)} accessibilityLabel="Back to categories" testID="report-back" />
          ) : null}
          <Text style={styles.title}>{category ? category.title : "Report"}</Text>
          <Button variant="ghost" icon="close" iconColor={colors.textMuted} onPress={onClose} accessibilityLabel="Close" />
        </View>
        <ScrollView contentContainerStyle={styles.grid}>
          {category
            ? category.items.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => {
                    setCategory(null);
                    onItemSelected(item);
                  }}
                  style={({ pressed }) => [styles.typeTile, pressed && { opacity: pressedOpacity }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Report ${itemLabel(item)}`}
                  testID={`report-item-${item}`}
                >
                  <ReportItemIcon id={item} size={56} />
                  <Text style={styles.typeLabel} numberOfLines={2}>{itemLabel(item)}</Text>
                </Pressable>
              ))
            : REPORT_CATEGORIES.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => pickCategory(c)}
                  style={({ pressed }) => [styles.typeTile, pressed && { opacity: pressedOpacity }]}
                  accessibilityRole="button"
                  accessibilityLabel={c.title}
                  testID={`report-category-${c.id}`}
                >
                  <ReportItemIcon id={c.iconItem} size={64} />
                  <Text style={styles.typeLabel} numberOfLines={2}>{c.title}</Text>
                </Pressable>
              ))}
        </ScrollView>
      </BottomSheetView>
      </SurfaceScheme>
    </MapSheet>
  );
});

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: SURFACES.dark.sheet,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.high,
  },
  handleIndicator: {
    backgroundColor: SURFACES.dark.textFaint,
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
    flex: 1,
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  typeTile: {
    width: "30%",
    minHeight: 104,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  typeLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
    paddingHorizontal: 4,
  },
});
