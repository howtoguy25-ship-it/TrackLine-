import React, { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  ScrollView,
  Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { SimpleBottomSheet, type SimpleBottomSheetRef } from "@/components/SimpleBottomSheet";
import { PlacesApiError, type NearbyPlace } from "@/services/places";
import { searchNearbyOsmPlaces, searchOsmPlacesByText } from "@/services/osmPlaces";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";
import { setActiveSearchFocus, isActiveSearchFocus, clearActiveSearchFocusIfOwner } from "@/utils/activeSearchFocus";
import {
  NO_PARKING_FILTERS,
  PARKING_FILTER_LABELS,
  PARKING_SORT_LABELS,
  activeFilterCount,
  applyParkingFilters,
  parkingAttributes,
  type ParkingFilters,
  type ParkingSort,
} from "@/services/parkingFilters";

const SEARCH_FOCUS_KEY = "parking";

// The "Where to?" sheet's Parking list: live nearby car parks from OpenStreetMap, with text
// search, a sort, and filters.
//
// The filters are built on what OSM actually records for a car park -- free/paid, opening
// hours, covered, wheelchair access, disabled bays, EV charging -- read by
// services/parkingFilters.ts. That data is patchy, so a filter keeps only car parks that
// definitely match and the sheet says how many it left out for not saying either way.
//
// The original brief also listed "Top rated" and "Sort by price". Neither is offered: OSM has
// no ratings and no prices, and a control with no data behind it would be a button that lies.
// "Free first" is the real sort the fee data does support.
const SORT_ORDER: ParkingSort[] = ["nearest", "freeFirst", "largest"];
// The two filters worth a chip of their own; the rest live behind "More".
const MORE_FILTER_KEYS = ["covered", "wheelchairAccessible", "disabledBays", "evCharging"] as const;

interface Props {
  location: LatLng | null;
  onViewDetails: (placeId: string) => void;
  onSheetChange?: (index: number) => void;
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export const ParkingSheet = forwardRef<SimpleBottomSheetRef, Props>(function ParkingSheet(
  { location, onViewDetails, onSheetChange },
  ref
) {
  const insets = useSafeAreaInsets();
  const snapFractions: [number, number] = [0.5, 0.88];

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", () => {
      if (!isActiveSearchFocus(SEARCH_FOCUS_KEY)) return;
      clearActiveSearchFocusIfOwner(SEARCH_FOCUS_KEY);
      if (ref && typeof ref !== "function") ref.current?.snapToIndex(0);
    });
    return () => sub.remove();
  }, [ref]);

  const [carParks, setCarParks] = useState<NearbyPlace[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState(-1);
  const wasOpenRef = useRef(false);
  const [retryTick, setRetryTick] = useState(0);
  const [sort, setSort] = useState<ParkingSort>("nearest");
  const [filters, setFilters] = useState<ParkingFilters>(NO_PARKING_FILTERS);
  const [moreOpen, setMoreOpen] = useState(false);
  // "Open now" depends on the clock, so the time used is refreshed whenever the list itself is
  // (re)loaded or the sheet is reopened -- not read during render.
  const [evaluatedAt, setEvaluatedAt] = useState(() => new Date());

  useEffect(() => {
    if (!location) return;
    const isOpen = sheetIndex >= 0;
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (fetchedFor !== null && !justOpened) return;
    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    if (key === fetchedFor) return;
    // The "a load has started" state is set from the first step of the request chain rather
    // than directly in the effect body, so it lands in the same pass as the request starting
    // instead of forcing an extra render of its own first.
    Promise.resolve()
      .then(() => {
        setLoading(true);
        setErrorText(null);
        // "Open now" is judged against the moment this list was loaded.
        setEvaluatedAt(new Date());
        return searchNearbyOsmPlaces(location, "parking", (partial, isFinal) => {
          if (partial.length > 0 || isFinal) {
            setCarParks(partial);
            setLoading(false);
          }
        });
      })
      .then((results) => {
        setCarParks(results);
        setFetchedFor(key);
      })
      .catch((err) => {
        setErrorText(
          err instanceof PlacesApiError
            ? `Couldn't load nearby parking (${err.status})`
            : "Couldn't load nearby parking -- check your connection"
        );
      })
      .finally(() => setLoading(false));
  }, [location, fetchedFor, sheetIndex, retryTick]);

  const TEXT_SEARCH_DEBOUNCE_MS = 450;
  const [textSearchResults, setTextSearchResults] = useState<NearbyPlace[]>([]);
  const [textSearching, setTextSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    // Under two characters nothing is searched; any earlier results are simply ignored by the
    // list below (see `remoteMatches`) rather than being cleared from here.
    if (q.length < 2 || !location) return;
    const timer = setTimeout(() => {
      setTextSearching(true);
      searchOsmPlacesByText(q, location, "parking", (partial, isFinal) => {
        if (partial.length > 0 || isFinal) {
          setTextSearchResults(partial);
          setTextSearching(false);
        }
      })
        .then(setTextSearchResults)
        .catch(() => {})
        .finally(() => setTextSearching(false));
    }, TEXT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, location]);

  const filteredCarParks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return carParks;
    const localMatches = carParks.filter((s) => s.name.toLowerCase().includes(q) || s.vicinity.toLowerCase().includes(q));
    const remoteMatches = q.length >= 2 ? textSearchResults : [];
    if (remoteMatches.length === 0) return localMatches;
    const merged = new Map<string, NearbyPlace>();
    for (const s of localMatches) merged.set(s.placeId, s);
    for (const s of remoteMatches) merged.set(s.placeId, s);
    return Array.from(merged.values()).sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [carParks, query, textSearchResults]);

  // Each car park with what its own map tags say about it, then the driver's filters and sort.
  const filtered = useMemo(
    () =>
      applyParkingFilters(
        filteredCarParks.map((place) => ({
          place,
          distanceMeters: place.distanceMeters,
          attributes: parkingAttributes(place.osmTags, evaluatedAt),
        })),
        filters,
        sort
      ),
    [filteredCarParks, filters, sort, evaluatedAt]
  );
  const filterCount = activeFilterCount(filters);
  const moreCount = MORE_FILTER_KEYS.filter((key) => filters[key]).length;
  const toggleFilter = (key: keyof ParkingFilters) => setFilters((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <SimpleBottomSheet
      ref={ref}
      snapFractions={snapFractions}
      topInset={insets.top}
      onChange={(index) => {
        setSheetIndex(index);
        onSheetChange?.(index);
      }}
    >
      <View style={styles.content}>
        <Pressable style={styles.pressableFill} onPress={() => Keyboard.dismiss()}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Parking nearby</Text>
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                if (ref && typeof ref !== "function") ref.current?.close();
              }}
              hitSlop={10}
              accessibilityLabel="Close"
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search parking…"
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => Keyboard.dismiss()}
              onFocus={() => {
                setActiveSearchFocus(SEARCH_FOCUS_KEY);
                if (ref && typeof ref !== "function") ref.current?.snapToIndex(1);
              }}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={colors.textFaint} />
              </Pressable>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.filterRow}
          >
            <FilterChip
              label={PARKING_SORT_LABELS[sort]}
              icon="swap-vertical"
              active={sort !== "nearest"}
              onPress={() => setSort(SORT_ORDER[(SORT_ORDER.indexOf(sort) + 1) % SORT_ORDER.length])}
              accessibilityLabel={`Sort: ${PARKING_SORT_LABELS[sort]}. Tap to change.`}
            />
            <FilterChip label="Open now" active={filters.openNow} onPress={() => toggleFilter("openNow")} />
            <FilterChip label="Free" active={filters.free} onPress={() => toggleFilter("free")} />
            <FilterChip
              label={moreCount > 0 ? `More (${moreCount})` : "More"}
              icon="options-outline"
              active={moreCount > 0}
              onPress={() => {
                Keyboard.dismiss();
                setMoreOpen(true);
              }}
            />
          </ScrollView>

          {loading && (
            <View style={styles.centerRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.centerText}>Finding parking nearby…</Text>
            </View>
          )}
          {textSearching && !loading && (
            <View style={styles.centerRow}>
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={styles.centerText}>Searching further afield…</Text>
            </View>
          )}
          {errorText && !loading && (
            <View style={styles.centerRow}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={[styles.centerText, { color: colors.danger }]}>{errorText}</Text>
              <Pressable
                onPress={() => setRetryTick((t) => t + 1)}
                hitSlop={10}
                style={styles.retryButton}
                accessibilityLabel="Retry"
              >
                <Ionicons name="refresh" size={14} color={colors.accent} />
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          )}
          {!loading && !errorText && filteredCarParks.length === 0 && (
            <View style={styles.centerRow}>
              <Text style={styles.centerText}>
                {carParks.length === 0 ? "Nothing found nearby yet." : "No matches for that search."}
              </Text>
            </View>
          )}
          {/* Says what the filters removed, and why -- a car park the map says nothing about
              isn't the same as one that's known to be paid or closed. */}
          {!loading && !errorText && filterCount > 0 && filteredCarParks.length > 0 && (
            <View style={styles.filterNote}>
              <Text style={styles.filterNoteText}>
                {filtered.kept.length === 0 ? "No car parks nearby are marked as matching. " : ""}
                {filtered.excludedUnknown > 0
                  ? `${filtered.excludedUnknown} hidden because the map doesn't say either way.`
                  : filtered.kept.length === 0
                    ? ""
                    : `Showing ${filtered.kept.length} of ${filteredCarParks.length}.`}
              </Text>
              <Pressable onPress={() => setFilters(NO_PARKING_FILTERS)} hitSlop={8}>
                <Text style={styles.filterNoteAction}>Clear filters</Text>
              </Pressable>
            </View>
          )}
        </Pressable>

        <FlatList
          data={filtered.kept}
          keyExtractor={(item) => item.place.placeId}
          style={styles.listFlex}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xxl }]}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: { place, attributes } }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
              onPress={() => onViewDetails(place.placeId)}
            >
              <View style={styles.parkingIconWrap}>
                <MaterialCommunityIcons name="parking" size={22} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {place.name}
                </Text>
                {!!place.vicinity && (
                  <Text style={styles.vicinity} numberOfLines={1}>
                    {place.vicinity}
                  </Text>
                )}
                {/* Only what the map actually states -- nothing shown for a detail it omits. */}
                <View style={styles.metaRow}>
                  {attributes.free === true && <Text style={[styles.badge, styles.badgeGood]}>Free</Text>}
                  {attributes.free === false && <Text style={styles.badge}>Paid</Text>}
                  {attributes.openNow === true && <Text style={[styles.badge, styles.badgeGood]}>Open</Text>}
                  {attributes.openNow === false && <Text style={[styles.badge, styles.badgeBad]}>Closed</Text>}
                  {attributes.covered === true && <Text style={styles.badge}>Covered</Text>}
                  {attributes.evCharging === true && <Text style={styles.badge}>EV</Text>}
                  {attributes.capacity !== null && attributes.capacity > 0 && (
                    <Text style={styles.badge}>{attributes.capacity} spaces</Text>
                  )}
                  {attributes.restricted && <Text style={[styles.badge, styles.badgeBad]}>Restricted</Text>}
                  <Text style={styles.distanceText}>{formatDistance(place.distanceMeters)}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          )}
        />

        <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
          <Pressable style={styles.moreOverlay} onPress={() => setMoreOpen(false)}>
            <Pressable style={[styles.moreCard, { paddingBottom: insets.bottom + spacing.lg }]} onPress={() => {}}>
              <Text style={styles.moreTitle}>More filters</Text>
              {MORE_FILTER_KEYS.map((key) => (
                <View key={key} style={styles.moreRow}>
                  <Text style={styles.moreLabel}>{PARKING_FILTER_LABELS[key]}</Text>
                  <Switch value={filters[key]} onValueChange={() => toggleFilter(key)} />
                </View>
              ))}
              <Text style={styles.moreHint}>
                These come from each car park&apos;s own map details, which many don&apos;t fill in. Turning one on
                shows only car parks that are marked as having it.
              </Text>
              <View style={styles.moreActions}>
                <Pressable onPress={() => setFilters(NO_PARKING_FILTERS)} hitSlop={8} style={styles.moreButton}>
                  <Text style={styles.moreButtonTextMuted}>Clear all</Text>
                </Pressable>
                <Pressable onPress={() => setMoreOpen(false)} style={[styles.moreButton, styles.moreButtonPrimary]}>
                  <Text style={styles.moreButtonTextPrimary}>Done</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </SimpleBottomSheet>
  );
});

function FilterChip({
  label,
  icon,
  active,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: pressedOpacity }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {icon && <Ionicons name={icon} size={14} color={active ? "#FFFFFF" : colors.textMuted} />}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.lg },
  pressableFill: {},
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text },
  centerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  centerText: { flex: 1, fontSize: 13, color: colors.textMuted },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  retryButtonText: { fontSize: 12, fontWeight: "700", color: colors.accent },
  listFlex: { flex: 1 },
  listContent: { paddingBottom: spacing.xxl, gap: spacing.xs, paddingTop: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  parkingIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  vicinity: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs, marginTop: 4 },
  filterRow: { gap: spacing.xs, paddingBottom: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceMuted,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  chipTextActive: { color: "#FFFFFF" },
  filterNote: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.sm },
  filterNoteText: { flex: 1, fontSize: 12, color: colors.textMuted },
  filterNoteAction: { fontSize: 12, fontWeight: "700", color: colors.accent },
  badge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  badgeGood: { color: "#15803D", backgroundColor: "#DCFCE7" },
  badgeBad: { color: "#B91C1C", backgroundColor: "#FEE2E2" },
  moreOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  moreCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  moreTitle: { fontSize: 18, fontWeight: "800", color: colors.text, marginBottom: spacing.xs },
  moreRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.xs },
  moreLabel: { fontSize: 15, color: colors.text },
  moreHint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs },
  moreActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  moreButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  moreButtonPrimary: { backgroundColor: colors.accent },
  moreButtonTextMuted: { fontSize: 15, fontWeight: "700", color: colors.textMuted },
  moreButtonTextPrimary: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  distanceText: { fontSize: 12, color: colors.textFaint, marginLeft: "auto" },
});
