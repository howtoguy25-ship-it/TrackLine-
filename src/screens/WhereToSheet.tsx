import React, { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ThreeSnapBottomSheet, type ThreeSnapBottomSheetRef } from "@/components/ThreeSnapBottomSheet";
import {
  searchPlaces,
  getPlaceDetails,
  PlacesApiError,
  type PlacePrediction,
  type PlaceDetails,
} from "@/services/places";
import { getSearchHistory, addSearchHistoryEntry } from "@/services/searchHistory";
import {
  getSavedPlaces,
  setHomeOrWork,
  removeHomeOrWork,
  addCustomPlace,
  removeCustomPlace,
  pushSavedPlacesToProfile,
  pullSavedPlacesFromProfile,
  type SavedPlaces,
  type SavedPlaceSlot,
} from "@/services/savedPlaces";
import { useAuth } from "@/context/AuthContext";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";

// Real, explicit request (Waze-style redesign, Phase 2 -- "Bottom Search Sheet 'Where to?'").
// Replaces the old always-floating-at-the-top DestinationSearchBar as the home screen's main
// idle entry point with a real, draggable 3-snap-point sheet (peek/half/full -- see
// ThreeSnapBottomSheet.tsx). Home/Work/+New chips and the Saved/Fuel/Food/Parking category row
// are real and functional (search autocomplete, Firestore-synced saved places, live OSM nearby
// lists via the existing Fuel/Restaurants/Hotels/Parking sheets). NOT built this round, honestly
// deferred (see NOTES.md): the real speech-to-text mic (no STT library exists in this project
// yet -- tapping it shows an honest in-sheet note instead of pretending to listen), and the
// "More options" section (Drive to friends & family via Contacts, Connect calendar) -- both need
// their own new native permission integrations, tracked as a real fast-follow rather than a
// half-built, partially-dead UI shipped in the same pass as everything else here.

function formatPredictionDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

function predictionIconFor(types: string[] | undefined): { name: keyof typeof Ionicons.glyphMap; bg: string } {
  const t = new Set(types ?? []);
  if (t.has("train_station") || t.has("transit_station") || t.has("subway_station") || t.has("light_rail_station")) {
    return { name: "train", bg: "#1D4ED8" };
  }
  if (t.has("bus_station")) return { name: "bus", bg: "#1D4ED8" };
  if (t.has("airport")) return { name: "airplane", bg: "#1D4ED8" };
  if (t.has("lodging")) return { name: "bed", bg: "#7C3AED" };
  if (t.has("restaurant") || t.has("cafe") || t.has("food")) return { name: "restaurant", bg: "#EA580C" };
  if (t.has("park")) return { name: "leaf", bg: "#16A34A" };
  return { name: "location", bg: "#DC2626" };
}

export type WhereToCategory = "saved" | "fuel" | "food" | "parking";

interface Props {
  biasLocation?: LatLng;
  onDestinationSelected: (place: PlaceDetails) => void;
  onFindNearestStation?: () => void;
  findingNearestStation?: boolean;
  originLabel?: string;
  onPressOrigin?: () => void;
  onFindRestaurants: () => void;
  onFindHotels: () => void;
  onFindPetrol: () => void;
  onFindParking: () => void;
  onSheetChange?: (index: 0 | 1 | 2) => void;
}

// What the main search input is currently FOR -- "route" (the default: picking a destination to
// drive to) or assigning one of the real saved-place slots. Picking a result branches on this
// instead of the search UI itself ever duplicating.
type PickTarget = "route" | SavedPlaceSlot | "custom";

export const WhereToSheet = forwardRef<ThreeSnapBottomSheetRef, Props>(function WhereToSheet(
  {
    biasLocation,
    onDestinationSelected,
    onFindNearestStation,
    findingNearestStation,
    originLabel,
    onPressOrigin,
    onFindRestaurants,
    onFindHotels,
    onFindPetrol,
    onFindParking,
    onSheetChange,
  },
  ref
) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const snapFractions: [number, number, number] = [0.24, 0.55, 0.92];

  const [query, setQuery] = useState("");
  const [pickTarget, setPickTarget] = useState<PickTarget>("route");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [history, setHistory] = useState<PlaceDetails[]>([]);
  const [saved, setSaved] = useState<SavedPlaces>({ home: null, work: null, custom: [] });
  const [activeCategory, setActiveCategory] = useState<WhereToCategory | null>(null);
  const [micNote, setMicNote] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSearchHistory().then(setHistory);
    getSavedPlaces().then(setSaved);
  }, []);

  // Same real cross-device sync pattern as SettingsContext -- pulled once per real sign-in,
  // merged onto whatever's already stored locally rather than overwriting it.
  const pulledForUid = useRef<string | null>(null);
  useEffect(() => {
    if (!user || user.isAnonymous || pulledForUid.current === user.uid) return;
    pulledForUid.current = user.uid;
    pullSavedPlacesFromProfile(user.uid).then((remote) => {
      if (remote) setSaved(remote);
    });
  }, [user]);

  const persistSaved = useCallback(
    (next: SavedPlaces) => {
      setSaved(next);
      if (user && !user.isAnonymous) pushSavedPlacesToProfile(user.uid, next).catch(() => {});
    },
    [user]
  );

  const onChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!text.trim()) {
        setPredictions([]);
        setErrorText(null);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        setErrorText(null);
        try {
          const results = await searchPlaces(text, biasLocation);
          const sorted = [...results].sort(
            (a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)
          );
          setPredictions(sorted);
        } catch (err) {
          setPredictions([]);
          setErrorText(
            err instanceof PlacesApiError
              ? /billing/i.test(err.message)
                ? "Search unavailable -- billing isn't enabled on this app's Google Cloud project"
                : `Search unavailable (${err.status}) -- check the Places API key`
              : "Search failed -- check your connection"
          );
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [biasLocation]
  );

  const resetSearch = useCallback(() => {
    setQuery("");
    setPredictions([]);
    setPickTarget("route");
    Keyboard.dismiss();
  }, []);

  const handlePicked = useCallback(
    async (place: PlaceDetails) => {
      if (pickTarget === "route") {
        setQuery(place.name);
        setPredictions([]);
        Keyboard.dismiss();
        addSearchHistoryEntry(place).then(setHistory);
        onDestinationSelected(place);
        return;
      }
      if (pickTarget === "home" || pickTarget === "work") {
        const next = await setHomeOrWork(pickTarget, place);
        persistSaved(next);
        resetSearch();
        return;
      }
      // "custom" -- real "+ New" saved place. Labelled with the place's own real name (the full
      // brief's separate "type a name" step is a deferred fast-follow -- see this file's own
      // header).
      const next = await addCustomPlace(place);
      persistSaved(next);
      resetSearch();
    },
    [pickTarget, onDestinationSelected, persistSaved, resetSearch]
  );

  const onSelectPrediction = useCallback(
    async (prediction: PlacePrediction) => {
      try {
        const details = await getPlaceDetails(prediction.placeId);
        handlePicked(details);
      } catch (err) {
        setErrorText(
          err instanceof PlacesApiError
            ? `Couldn't load that place (${err.status})`
            : "Couldn't load that place -- check your connection"
        );
      }
    },
    [handlePicked]
  );

  const beginPicking = useCallback(
    (target: PickTarget) => {
      setActiveCategory(null);
      setPickTarget(target);
      setQuery("");
      setPredictions([]);
      if (ref && typeof ref !== "function") ref.current?.expandHalf();
    },
    [ref]
  );

  const onPressHomeOrWork = useCallback(
    (slot: SavedPlaceSlot) => {
      const place = saved[slot];
      if (!place) {
        beginPicking(slot);
        return;
      }
      onDestinationSelected(place);
    },
    [saved, beginPicking, onDestinationSelected]
  );

  const onLongPressHomeOrWork = useCallback(
    (slot: SavedPlaceSlot) => {
      const place = saved[slot];
      if (!place) return;
      const label = slot === "home" ? "Home" : "Work";
      Alert.alert(label, place.address, [
        { text: "Edit address", onPress: () => beginPicking(slot) },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const next = await removeHomeOrWork(slot);
            persistSaved(next);
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [saved, beginPicking, persistSaved]
  );

  const onPressMic = useCallback(() => {
    if (micNoteTimerRef.current) clearTimeout(micNoteTimerRef.current);
    setMicNote("Voice search isn't set up yet -- type your destination instead.");
    micNoteTimerRef.current = setTimeout(() => setMicNote(null), 3000);
  }, []);

  const onPressCategory = useCallback(
    (category: WhereToCategory) => {
      if (category === "saved") {
        setActiveCategory((v) => (v === "saved" ? null : "saved"));
        if (ref && typeof ref !== "function") ref.current?.expandHalf();
        return;
      }
      setActiveCategory(null);
      if (category === "fuel") onFindPetrol();
      else if (category === "food") onFindRestaurants();
      else if (category === "parking") onFindParking();
    },
    [ref, onFindPetrol, onFindRestaurants, onFindParking]
  );

  const picking = pickTarget !== "route";
  const pickingLabel = pickTarget === "home" ? "Set Home address" : pickTarget === "work" ? "Set Work address" : pickTarget === "custom" ? "Add a saved place" : null;
  const showPredictions = predictions.length > 0;
  const showHistory = !picking && !query.trim() && predictions.length === 0 && history.length > 0 && activeCategory === null;
  const showSavedList = activeCategory === "saved" && !picking && !query.trim();

  return (
    <ThreeSnapBottomSheet ref={ref} snapFractions={snapFractions} topInset={insets.top} onChange={onSheetChange}>
      <View style={styles.content}>
        <Pressable style={styles.pressableFill} onPress={() => Keyboard.dismiss()}>
          {!!originLabel && !!onPressOrigin && !picking && (
            <>
              <Pressable
                style={({ pressed }) => [styles.originRow, pressed && styles.rowPressed]}
                onPress={onPressOrigin}
                accessibilityLabel={`Starting point: ${originLabel}. Tap to change.`}
              >
                <Ionicons name="ellipse" size={10} color={colors.accent} />
                <Text style={styles.originText} numberOfLines={2}>
                  {originLabel}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
              </Pressable>
              <View style={styles.originDivider} />
            </>
          )}

          {picking && (
            <View style={styles.pickingBanner}>
              <Text style={styles.pickingBannerText}>{pickingLabel}</Text>
              <Pressable onPress={resetSearch} hitSlop={10} accessibilityLabel="Cancel">
                <Ionicons name="close-circle" size={20} color={colors.textFaint} />
              </Pressable>
            </View>
          )}

          <View style={styles.inputRow}>
            <View style={styles.searchIconWrap}>
              <Ionicons name="search" size={18} color={colors.accent} />
            </View>
            <TextInput
              value={query}
              onChangeText={onChangeText}
              onFocus={() => {
                if (ref && typeof ref !== "function") ref.current?.expandHalf();
              }}
              placeholder={picking ? "Search address…" : "Where to?"}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
            />
            {loading && <ActivityIndicator size="small" color={colors.accent} />}
            {!picking && (
              <Pressable onPress={onPressMic} hitSlop={10} accessibilityLabel="Voice search">
                <Ionicons name="mic-outline" size={20} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
          {!!micNote && <Text style={styles.micNote}>{micNote}</Text>}

          {!picking && (
            <>
              <View style={styles.chipsRow}>
                <Pressable
                  style={({ pressed }) => [styles.slotChip, pressed && { opacity: pressedOpacity }]}
                  onPress={() => onPressHomeOrWork("home")}
                  onLongPress={() => onLongPressHomeOrWork("home")}
                >
                  <Ionicons name="home" size={15} color={colors.accent} />
                  <Text style={styles.slotChipText}>Home</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.slotChip, pressed && { opacity: pressedOpacity }]}
                  onPress={() => onPressHomeOrWork("work")}
                  onLongPress={() => onLongPressHomeOrWork("work")}
                >
                  <Ionicons name="briefcase" size={15} color={colors.accent} />
                  <Text style={styles.slotChipText}>Work</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.slotChip, pressed && { opacity: pressedOpacity }]}
                  onPress={() => beginPicking("custom")}
                >
                  <Ionicons name="add" size={15} color={colors.accent} />
                  <Text style={styles.slotChipText}>New</Text>
                </Pressable>
              </View>

              <View style={styles.chipsRow}>
                <CategoryChip
                  icon="bookmark"
                  label="Saved"
                  active={activeCategory === "saved"}
                  onPress={() => onPressCategory("saved")}
                />
                <CategoryChip icon="car" label="Fuel" onPress={() => onPressCategory("fuel")} />
                <CategoryChip icon="restaurant" label="Food" onPress={() => onPressCategory("food")} />
                <CategoryChip icon="square-outline" label="Parking" onPress={() => onPressCategory("parking")} />
              </View>

              {onFindNearestStation && !query.trim() && activeCategory === null && (
                <Pressable
                  style={({ pressed }) => [styles.quickAction, pressed && styles.rowPressed]}
                  onPress={onFindNearestStation}
                  disabled={findingNearestStation}
                >
                  {findingNearestStation ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons name="train-outline" size={18} color={colors.accent} />
                  )}
                  <Text style={styles.quickActionText}>
                    {findingNearestStation ? "Finding nearest station…" : "Nearest train/bus station"}
                  </Text>
                </Pressable>
              )}
            </>
          )}

          {!!errorText && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{errorText}</Text>
            </View>
          )}
        </Pressable>

        {showPredictions && (
          <FlatList
            data={predictions}
            keyExtractor={(item) => item.placeId}
            style={styles.listFlex}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            renderItem={({ item }) => {
              const { name: iconName, bg: iconBg } = predictionIconFor(item.types);
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => onSelectPrediction(item)}
                >
                  <View style={[styles.predictionIconWrap, { backgroundColor: iconBg }]}>
                    <Ionicons name={iconName} size={16} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.predictionTitleRow}>
                      <Text style={styles.primaryText} numberOfLines={1}>
                        {item.primaryText}
                      </Text>
                      {item.distanceMeters !== undefined && (
                        <Text style={styles.predictionDistance}>{formatPredictionDistance(item.distanceMeters)}</Text>
                      )}
                    </View>
                    {!!item.secondaryText && (
                      <Text style={styles.secondaryText} numberOfLines={1}>
                        {item.secondaryText}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            }}
          />
        )}

        {showSavedList && (
          <FlatList
            data={saved.custom}
            keyExtractor={(item) => item.placeId}
            style={styles.listFlex}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No saved places yet -- tap &quot;New&quot; above to add one.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Pressable style={styles.historyRowMain} onPress={() => onDestinationSelected(item)}>
                  <Ionicons name="bookmark" size={16} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.primaryText} numberOfLines={1}>
                      {item.label ?? item.name}
                    </Text>
                    <Text style={styles.secondaryText} numberOfLines={1}>
                      {item.address}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const next = await removeCustomPlace(item.placeId);
                    persistSaved(next);
                  }}
                  hitSlop={10}
                  style={styles.historyRemoveButton}
                  accessibilityLabel={`Remove ${item.name}`}
                >
                  <Ionicons name="close" size={16} color={colors.textFaint} />
                </Pressable>
              </View>
            )}
          />
        )}

        {showHistory && (
          <FlatList
            data={history}
            keyExtractor={(item) => item.placeId}
            style={styles.listFlex}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            ListHeaderComponent={<Text style={styles.historyHeaderText}>Recent searches</Text>}
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => onDestinationSelected(item)}>
                <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.primaryText} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {!!item.address && (
                    <Text style={styles.secondaryText} numberOfLines={1}>
                      {item.address}
                    </Text>
                  )}
                </View>
              </Pressable>
            )}
          />
        )}
      </View>
    </ThreeSnapBottomSheet>
  );
});

function CategoryChip({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.categoryChip,
        active && styles.categoryChipActive,
        pressed && { opacity: pressedOpacity },
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={15} color={active ? "#FFFFFF" : colors.text} />
      <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.lg },
  pressableFill: {},
  originRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 36,
    paddingVertical: spacing.xs,
  },
  originText: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.text },
  originDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginBottom: spacing.sm },
  pickingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  pickingBannerText: { fontSize: 13, fontWeight: "700", color: colors.accent },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    height: 52,
    gap: spacing.sm + 2,
    marginTop: spacing.xs,
  },
  searchIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  input: { flex: 1, fontSize: 16, color: colors.text },
  micNote: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs, paddingHorizontal: spacing.xs },
  chipsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  slotChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  slotChipText: { fontSize: 13, fontWeight: "700", color: colors.text },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
  },
  categoryChipActive: { backgroundColor: colors.accent },
  categoryChipText: { fontSize: 13, fontWeight: "700", color: colors.text },
  categoryChipTextActive: { color: "#FFFFFF" },
  quickAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  quickActionText: { fontSize: 14, fontWeight: "600", color: colors.accent },
  errorBanner: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#FEF2F2",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: { flex: 1, fontSize: 12, color: colors.danger },
  listFlex: { flex: 1, marginTop: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  historyRowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  historyRemoveButton: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  historyHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  emptyText: { fontSize: 13, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: "center" },
  predictionIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  predictionTitleRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs + 2 },
  predictionDistance: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  primaryText: { flexShrink: 1, fontSize: 15, color: colors.text, fontWeight: "600" },
  secondaryText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
