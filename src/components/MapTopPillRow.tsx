import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, radius, shadow, pressedOpacity } from "@/theme/tokens";

interface Props {
  alertsEnabled: boolean;
  onToggleAlerts: () => void;
  onFindRestaurants: () => void;
  onFindHotels: () => void;
}

// Real, confirmed request, per a reference screenshot: a persistent row of transparent pill
// buttons anchored at the very top of the map -- not buried inside the search bar's own
// idle-state dropdown (which only ever showed once the search box was tapped/focused first).
// Restaurants/Hotels open the exact same sheets the old dropdown rows did; Alerts is real, not
// decorative -- it toggles settings.alertsEnabled, the same flag MapScreen's own alert
// subscription already gates on, so switching it off here genuinely stops fetching/showing
// alerts, not just a visual state.
export function MapTopPillRow({ alertsEnabled, onToggleAlerts, onFindRestaurants, onFindHotels }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.row, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
      <Pressable
        style={({ pressed }) => [styles.pill, alertsEnabled && styles.pillActive, pressed && { opacity: pressedOpacity }]}
        onPress={onToggleAlerts}
        accessibilityLabel={alertsEnabled ? "Alerts on -- tap to turn off" : "Alerts off -- tap to turn on"}
      >
        <Ionicons name="radio-outline" size={16} color="#FFFFFF" />
        <Text style={styles.pillText}>Alerts</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.pill, pressed && { opacity: pressedOpacity }]}
        onPress={onFindRestaurants}
        accessibilityLabel="Restaurants nearby"
      >
        <Ionicons name="restaurant-outline" size={16} color="#FFFFFF" />
        <Text style={styles.pillText}>Restaurants</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.pill, pressed && { opacity: pressedOpacity }]}
        onPress={onFindHotels}
        accessibilityLabel="Hotels nearby"
      >
        <Ionicons name="bed-outline" size={16} color="#FFFFFF" />
        <Text style={styles.pillText}>Hotels</Text>
      </Pressable>
    </View>
  );
}

export const MAP_TOP_PILL_ROW_HEIGHT = 44;

const styles = StyleSheet.create({
  row: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    gap: spacing.sm,
    zIndex: 5,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    height: MAP_TOP_PILL_ROW_HEIGHT,
    borderRadius: radius.pill,
    // Semi-transparent dark, matching the reference screenshot's own pill treatment -- reads
    // clearly over any map style/theme underneath, unlike a solid opaque fill would need to be
    // theme-matched.
    backgroundColor: "rgba(17, 24, 39, 0.72)",
    ...shadow.medium,
  },
  pillActive: {
    backgroundColor: "#2563EB",
  },
  pillText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
