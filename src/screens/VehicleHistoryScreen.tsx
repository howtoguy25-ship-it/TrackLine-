import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, Alert, Image } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  getVehicleHistory,
  clearVehicleHistory,
  removeVehicleHistoryEntry,
  type VehicleHistoryEntry,
} from "@/services/vehicleHistory";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import type { RootStackParamList } from "@/navigation/RootNavigator";

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function speedLabel(entry: VehicleHistoryEntry): string | null {
  if (entry.lastSpeedKmh === null) return null;
  return entry.lastSpeedKind === "closing"
    ? `${Math.round(Math.abs(entry.lastSpeedKmh))} km/h closing`
    : `${Math.max(0, Math.round(entry.lastSpeedKmh))} km/h`;
}

// Every vehicle the live AI detector has fully identified (a real, confirmed on-device plate
// read -- see vehicleHistory.ts) is automatically logged here, per explicit request -- nothing
// to tap or save manually for those. This screen just surfaces that log and is the entry point
// into a real REV check for any of them, plus a manual "enter a plate" path for one that was
// never seen by the camera at all.
export function VehicleHistoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [entries, setEntries] = useState<VehicleHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Real, explicit request: a "Select" mode toggle (checkboxes per row, Select All/Deselect
  // All, and a bulk "Delete Selected" with a confirm dialog) alongside the existing single-item
  // paths (swipe-to-delete below, and long-press) -- these are three genuinely different real
  // actions, not the same one relabeled: swipe/long-press are for "I know exactly which one I
  // want gone right now", select mode is for "let me pick several, then commit once".
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPlates, setSelectedPlates] = useState<Set<string>>(new Set());

  const reload = useCallback(() => {
    getVehicleHistory().then((list) => {
      setEntries(list);
      setLoaded(true);
    });
  }, []);

  // Refreshes every time this screen comes back into focus -- e.g. after running a REV check
  // (which records a manual entry) and tapping back, so the list is never stale.
  useFocusEffect(reload);

  // Leaving select mode (either by toggling it off, or the list becoming empty out from under
  // it) always clears whatever was checked -- a stale selection surviving into a fresh session
  // of picking rows would be a real, confusing bug (deleting something the driver never
  // actually re-checked this time around).
  useEffect(() => {
    if (!selectMode) setSelectedPlates(new Set());
  }, [selectMode]);

  const onOpenRevCheck = useCallback(
    (entry: VehicleHistoryEntry) => {
      // A synthetic "VIN:<vin>" key (see vehicleHistory.ts's recordManualCheck) means this entry
      // never had a real plate -- don't prefill the plate field with that placeholder text.
      const isSyntheticVinKey = entry.plate.startsWith("VIN:");
      navigation.navigate("RevCheck", {
        plate: isSyntheticVinKey ? undefined : entry.plate,
        state: entry.state ?? undefined,
        vin: entry.vin ?? undefined,
        vehicleLabel: entry.label,
        speedKmh: entry.lastSpeedKmh,
        speedKind: entry.lastSpeedKind,
      });
    },
    [navigation]
  );

  const onRemove = useCallback((plate: string) => {
    removeVehicleHistoryEntry(plate).then(setEntries);
  }, []);

  const onLongPressRemove = useCallback(
    (plate: string) => {
      Alert.alert("Remove from history?", plate, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => onRemove(plate) },
      ]);
    },
    [onRemove]
  );

  const onClearAll = useCallback(() => {
    if (entries.length === 0) return;
    Alert.alert("Clear all vehicle history?", "This removes every saved plate from this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear all",
        style: "destructive",
        onPress: () => clearVehicleHistory().then(() => setEntries([])),
      },
    ]);
  }, [entries.length]);

  const toggleSelected = useCallback((plate: string) => {
    setSelectedPlates((prev) => {
      const next = new Set(prev);
      if (next.has(plate)) next.delete(plate);
      else next.add(plate);
      return next;
    });
  }, []);

  const allSelected = entries.length > 0 && selectedPlates.size === entries.length;
  const onToggleSelectAll = useCallback(() => {
    setSelectedPlates(allSelected ? new Set() : new Set(entries.map((e) => e.plate)));
  }, [allSelected, entries]);

  const onDeleteSelected = useCallback(() => {
    const count = selectedPlates.size;
    if (count === 0) return;
    Alert.alert(
      `Delete ${count} vehicle${count === 1 ? "" : "s"}?`,
      "This removes the selected entries from this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            let remaining = entries;
            for (const plate of selectedPlates) {
              remaining = await removeVehicleHistoryEntry(plate);
            }
            setEntries(remaining);
            setSelectMode(false);
          },
        },
      ]
    );
  }, [entries, selectedPlates]);

  // Real per-row swipe-to-delete (react-native-gesture-handler's own Swipeable, already a real
  // dependency/used throughout the app) -- deliberately no confirm dialog, unlike long-press and
  // the bulk delete above: the swipe gesture itself is the deliberate "I want this one gone"
  // action, the same convention iOS Mail/Reminders use, so a confirm on top of it would just be
  // a redundant extra tap for the one-at-a-time case this exists to make quick.
  const renderRightActions = useCallback(
    (plate: string) => (
      <Pressable onPress={() => onRemove(plate)} style={styles.swipeDeleteAction}>
        <Ionicons name="trash" size={20} color="#FFFFFF" />
        <Text style={styles.swipeDeleteText}>Delete</Text>
      </Pressable>
    ),
    [onRemove]
  );

  const headerRight = useMemo(() => {
    if (!selectMode) {
      return entries.length > 0 ? (
        <Pressable onPress={() => setSelectMode(true)} style={({ pressed }) => pressed && { opacity: pressedOpacity }}>
          <Text style={styles.selectToggleText}>Select</Text>
        </Pressable>
      ) : null;
    }
    return (
      <Pressable onPress={() => setSelectMode(false)} style={({ pressed }) => pressed && { opacity: pressedOpacity }}>
        <Text style={styles.selectToggleText}>Cancel</Text>
      </Pressable>
    );
  }, [selectMode, entries.length]);

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Pressable
          onPress={() => navigation.navigate("RevCheck", undefined)}
          style={({ pressed }) => [styles.addButton, pressed && { opacity: pressedOpacity }]}
        >
          <Ionicons name="add-circle" size={20} color="#FFFFFF" />
          <Text style={styles.addButtonText}>Enter a plate manually</Text>
        </Pressable>
        {headerRight}
      </View>

      {selectMode && (
        <View style={styles.selectBar}>
          <Pressable
            onPress={onToggleSelectAll}
            style={({ pressed }) => [styles.selectAllButton, pressed && { opacity: pressedOpacity }]}
          >
            <Ionicons name={allSelected ? "checkbox" : "square-outline"} size={18} color={colors.accent} />
            <Text style={styles.selectAllText}>{allSelected ? "Deselect all" : "Select all"}</Text>
          </Pressable>
          <Text style={styles.selectCountText}>{selectedPlates.size} selected</Text>
        </View>
      )}

      {loaded && entries.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="car-search-outline" size={40} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>No vehicles yet</Text>
          <Text style={styles.emptyText}>
            Vehicles the AI detector fully identifies (a confirmed number plate read) are
            automatically saved here, or enter one manually above.
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.plate}
          contentContainerStyle={[styles.list, selectMode && { paddingBottom: spacing.xxl + 64 }]}
          renderItem={({ item }) => {
            const speed = speedLabel(item);
            const isSyntheticVinKey = item.plate.startsWith("VIN:");
            const isChecked = selectedPlates.has(item.plate);

            const row = (
              <Pressable
                onPress={() =>
                  selectMode ? toggleSelected(item.plate) : onOpenRevCheck(item)
                }
                onLongPress={() => (selectMode ? undefined : onLongPressRemove(item.plate))}
                style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
              >
                {selectMode && (
                  <Ionicons
                    name={isChecked ? "checkbox" : "square-outline"}
                    size={22}
                    color={isChecked ? colors.accent : colors.textFaint}
                  />
                )}
                {/* Real, explicit request: a saved thumbnail per row, cropped on-device from the
                    same photo the live plate OCR already captured (see
                    services/vehicleThumbnail.ts) -- null whenever no thumbnail was available to
                    save (a manual entry with no camera capture behind it, or a crop that failed),
                    in which case the row just falls back to the plate badge alone, same as
                    before this existed. */}
                {item.thumbnailUri ? (
                  <Image source={{ uri: item.thumbnailUri }} style={styles.thumbnail} />
                ) : (
                  <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                    <MaterialCommunityIcons name="car" size={22} color={colors.textFaint} />
                  </View>
                )}
                <View style={styles.plateBadge}>
                  <Text style={styles.plateBadgeText}>
                    {isSyntheticVinKey ? item.vin ?? item.plate : item.plate}
                  </Text>
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowMeta}>
                    {item.label}
                    {item.source === "detected" ? " — AI detected" : " — manual entry"}
                    {item.timesSeen > 1 ? ` · seen ${item.timesSeen}x` : ""}
                  </Text>
                  <Text style={styles.rowMetaFaint}>
                    {speed ? `${speed} · ` : ""}
                    Last seen {relativeTime(item.lastSeenAt)}
                    {item.state ? ` · ${item.state}` : ""}
                    {!isSyntheticVinKey && item.vin ? ` · VIN saved` : ""}
                  </Text>
                </View>
                {!selectMode && <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />}
              </Pressable>
            );

            // Swipe-to-delete only makes sense outside select mode -- inside it, the row's own
            // tap already toggles a checkbox, and a rogue horizontal swipe mid-selection
            // shouldn't be able to delete something the driver hasn't confirmed via Delete
            // Selected yet.
            return selectMode ? (
              row
            ) : (
              <Swipeable renderRightActions={() => renderRightActions(item.plate)} overshootRight={false}>
                {row}
              </Swipeable>
            );
          }}
        />
      )}

      {selectMode ? (
        <Pressable
          onPress={onDeleteSelected}
          disabled={selectedPlates.size === 0}
          style={({ pressed }) => [
            styles.deleteSelectedButton,
            selectedPlates.size === 0 && styles.deleteSelectedButtonDisabled,
            pressed && selectedPlates.size > 0 && { opacity: pressedOpacity },
          ]}
        >
          <Ionicons name="trash" size={16} color="#FFFFFF" />
          <Text style={styles.deleteSelectedText}>Delete selected ({selectedPlates.size})</Text>
        </Pressable>
      ) : (
        entries.length > 0 && (
          <Pressable
            onPress={onClearAll}
            style={({ pressed }) => [styles.clearButton, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={styles.clearButtonText}>Clear all history</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceMuted, padding: spacing.xl, gap: spacing.md },
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  addButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    height: 48,
    ...shadow.low,
  },
  addButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  selectToggleText: { color: colors.accent, fontWeight: "700", fontSize: 14 },
  selectBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  selectAllButton: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  selectAllText: { color: colors.accent, fontWeight: "600", fontSize: 13 },
  selectCountText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  list: { gap: spacing.sm, paddingBottom: spacing.xxl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.low,
  },
  // Matches the row's own height/radius/margin so the revealed action reads as "part of this
  // row sliding open", not a separate floating element -- Swipeable renders this as a sibling
  // of the row content, not wrapped inside the row's own View, so it needs its own layout here.
  swipeDeleteAction: {
    backgroundColor: colors.danger,
    borderRadius: radius.lg,
    marginLeft: spacing.sm,
    width: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  swipeDeleteText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  thumbnailPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  plateBadge: {
    backgroundColor: colors.dark,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm - 2,
  },
  plateBadgeText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14,
    fontFamily: "monospace",
    letterSpacing: 1,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowMeta: { fontSize: 13, fontWeight: "600", color: colors.text },
  rowMetaFaint: { fontSize: 12, color: colors.textMuted },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 18 },
  clearButton: { alignItems: "center", paddingVertical: spacing.sm },
  clearButtonText: { fontSize: 13, fontWeight: "600", color: colors.danger },
  deleteSelectedButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    height: 48,
    ...shadow.low,
  },
  deleteSelectedButtonDisabled: {
    backgroundColor: colors.textFaint,
  },
  deleteSelectedText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});
