import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, radius, shadow, pressedOpacity } from "@/theme/tokens";

interface Props {
  alertsEnabled: boolean;
  onToggleAlerts: () => void;
  onFindRestaurants: () => void;
  onFindHotels: () => void;
  onFindPetrol: () => void;
}

// Real, confirmed request, per a reference screenshot: a persistent row of transparent pill
// buttons anchored at the very top of the map -- not buried inside the search bar's own
// idle-state dropdown (which only ever showed once the search box was tapped/focused first).
// Restaurants/Hotels/Petrol open the exact same sheets the old dropdown rows did; Alerts is
// real, not decorative -- it toggles settings.alertsEnabled, the same flag MapScreen's own
// alert subscription already gates on, so switching it off here genuinely stops fetching/
// showing alerts, not just a visual state. Horizontally scrollable (not a fixed row) now that
// there are 4 labeled pills -- keeps every one reachable and un-clipped on a narrower phone
// instead of assuming they always fit the screen width.
export function MapTopPillRow({ alertsEnabled, onToggleAlerts, onFindRestaurants, onFindHotels, onFindPetrol }: Props) {
  const insets = useSafeAreaInsets();
  return (
    // Real, confirmed complaint: insets.top alone (the safe-area inset) sat close enough to the
    // status bar's own clock/battery on some devices to read as crowding it -- a fixed extra
    // margin (spacing.lg, up from spacing.sm) on top of the real safe-area inset gives it clear
    // breathing room on every device instead of just barely clearing the notch/Dynamic Island.
    <View style={[styles.wrap, { top: insets.top + spacing.lg }]} pointerEvents="box-none">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
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
        <Pressable
          style={({ pressed }) => [styles.pill, pressed && { opacity: pressedOpacity }]}
          onPress={onFindPetrol}
          accessibilityLabel="Petrol stations nearby"
        >
          <MaterialCommunityIcons name="gas-station-outline" size={16} color="#FFFFFF" />
          <Text style={styles.pillText}>Petrol</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

export const MAP_TOP_PILL_ROW_HEIGHT = 44;
// The row's own top margin beyond the safe-area inset (see the render's own `top` above) --
// exported so callers stacking something below this row (see DestinationSearchBar's topOffset
// in MapScreen.tsx) compute the real total space this row consumes instead of assuming a stale
// value that would drift out of sync with the render's own margin.
export const MAP_TOP_PILL_ROW_TOP_MARGIN = spacing.lg;

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    // Real, confirmed bug: right: 0 let this row's scrollable viewport run all the way to the
    // screen edge, straight underneath MapScreen's fixed settings-gear button (topRightControls
    // -- right: spacing.sm, width 40) -- the last pill (Petrol) scrolled to sit behind/colliding
    // with it instead of stopping cleanly beside Hotels. Reserving that same width (+ margins)
    // clips this row's own visible area short of the gear button entirely.
    right: 40 + spacing.sm * 2,
    zIndex: 5,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
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
    backgroundColor: "#1D4ED8",
  },
  pillText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
