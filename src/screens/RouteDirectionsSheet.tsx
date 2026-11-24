import React, { forwardRef, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { View, StyleSheet } from "react-native";
import { Text } from "@/components/AppText";
import BottomSheet, { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MANEUVER_ICONS } from "@/components/NavigationInstructionCard";
import { ManeuverIcon } from "@/components/icons/RoundaboutIcon";
import type { Route } from "@/services/directions";
import { activeRowIndex, directionsRows, type DirectionsRow } from "@/nav/directionsRows";
import { formatDistance, type DistanceUnit } from "@/utils/navFormat";
import { BLUE, GREEN_TEXT, SURFACES } from "@/theme/colors";
import { radius, shadow, spacing } from "@/theme/tokens";

// Fix pass 5 §7: the directions list. One row per real manoeuvre (repeats merged,
// nav/directionsRows.ts): a big manoeuvre picture (our roundabout for roundabouts), the distance
// in bold, the street in bold with its route shield, the instruction in grey under it, the step
// you're on highlighted. Light or dark with the map. It's an overlay sheet: closing it leaves the
// map exactly as it was (it never moves the camera).

interface Props {
  route: Route | null;
  activeStepIndex: number;
  onClose: () => void;
  onSheetChange?: (index: number) => void;
  scheme?: "light" | "dark";
  distanceUnit?: DistanceUnit;
}

export const RouteDirectionsSheet = forwardRef<BottomSheet, Props>(function RouteDirectionsSheet(
  { route, activeStepIndex, onClose, onSheetChange, scheme = "light", distanceUnit = "km" },
  ref
) {
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ["65%"], []);
  const s = SURFACES[scheme];
  const rows = useMemo(() => (route ? directionsRows(route.steps) : []), [route]);
  const current = activeRowIndex(rows, activeStepIndex);

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={onSheetChange}
      handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: s.divider }]}
      backgroundStyle={[styles.sheetBackground, { backgroundColor: s.sheet }]}
    >
      {route && (
        <>
          <View style={[styles.header, { borderBottomColor: s.divider }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: s.text }]}>Directions</Text>
              <Text style={[styles.subtitle, { color: s.textMuted }]}>
                {route.distanceText} · {route.etaInTrafficText ?? route.etaText}
                {route.hasTrafficDelay ? " (traffic)" : ""}
              </Text>
            </View>
            <Button variant="ghost" icon="close" iconColor={s.textMuted} onPress={onClose} accessibilityLabel="Close" testID="directions-close" />
          </View>
          <BottomSheetFlatList
            keyboardShouldPersistTaps="handled"
            data={rows}
            keyExtractor={(r: DirectionsRow) => r.key}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
            renderItem={({ item, index }: { item: DirectionsRow; index: number }) => {
              const isActive = index === current;
              const isPast = index < current;
              const ink = isPast ? s.textFaint : s.text;
              const next = route.steps[item.lastStep + 1];
              return (
                <View
                  style={[styles.row, { borderBottomColor: s.divider }, isActive && { backgroundColor: scheme === "dark" ? "#0F2A40" : "#E5F4FF" }]}
                  testID={isActive ? "directions-row-current" : "directions-row"}
                >
                  <View style={styles.iconSlot}>
                    {item.final ? (
                      <Icon name="flag" size={40} color={isActive ? BLUE : ink} strokeWidth={2.6} />
                    ) : (
                      <ManeuverIcon
                        maneuver={item.maneuver}
                        icons={MANEUVER_ICONS}
                        size={44}
                        color={isActive ? BLUE : ink}
                        dim={s.divider}
                        exit={item.roundaboutExit}
                        drivingSide={item.drivingSide}
                        approach={route.steps[item.lastStep]?.polyline}
                        after={next?.polyline}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.distance, { color: ink }]} testID="directions-distance">
                      {formatDistance(item.meters, distanceUnit)}
                    </Text>
                    <View style={styles.streetRow}>
                      {item.shield ? (
                        <View style={styles.shield}>
                          <Text style={styles.shieldText}>{item.shield}</Text>
                        </View>
                      ) : null}
                      {item.street ? (
                        <Text style={[styles.street, { color: ink }]} numberOfLines={1} testID="directions-street">
                          {item.street}
                        </Text>
                      ) : null}
                    </View>
                    {item.detail ? (
                      <Text style={[styles.detail, { color: s.textMuted }]} numberOfLines={2} testID="directions-detail">
                        {item.detail}
                      </Text>
                    ) : null}
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
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.high,
  },
  handleIndicator: { width: 40 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, fontWeight: "800" },
  subtitle: { fontSize: 14, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconSlot: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  distance: { fontSize: 20, fontWeight: "800", lineHeight: 24 },
  streetRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  street: { flex: 1, fontSize: 17, fontWeight: "700" },
  shield: { backgroundColor: GREEN_TEXT, borderRadius: 5, borderWidth: 1.5, borderColor: "#FFFFFF", paddingHorizontal: 5, paddingVertical: 1 },
  shieldText: { fontSize: 14, fontWeight: "800", color: "#FFFFFF" },
  detail: { fontSize: 14, lineHeight: 18, marginTop: 2 },
});
