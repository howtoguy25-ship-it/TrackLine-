import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, TextInput, FlatList, Text, Pressable, StyleSheet, ActivityIndicator, Keyboard } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  searchPlaces,
  getPlaceDetails,
  PlacesApiError,
  type PlacePrediction,
  type PlaceDetails,
} from "@/services/places";
import {
  getSearchHistory,
  addSearchHistoryEntry,
  removeSearchHistoryEntry,
  clearSearchHistory,
} from "@/services/searchHistory";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

// Default collapsed count for "Recent searches" -- the dropdown toggle expands to the full
// stored history (see searchHistory.ts's own cap) and collapses back to this.
const COLLAPSED_HISTORY_COUNT = 3;

// Real, confirmed request -- match Apple Maps' own search result styling: a category-colored
// icon circle per result type instead of one generic pin for every row. Reads straight off
// Google's own real place `types` tags (see places.ts), not guessed from the name text.
function predictionIconFor(types: string[] | undefined): { name: keyof typeof Ionicons.glyphMap; bg: string } {
  const t = new Set(types ?? []);
  if (t.has("train_station") || t.has("transit_station") || t.has("subway_station") || t.has("light_rail_station")) {
    return { name: "train", bg: "#1D4ED8" };
  }
  if (t.has("bus_station")) return { name: "bus", bg: "#1D4ED8" };
  if (t.has("airport")) return { name: "airplane", bg: "#1D4ED8" };
  if (t.has("university") || t.has("school")) return { name: "school", bg: "#92400E" };
  if (t.has("lodging")) return { name: "bed", bg: "#7C3AED" };
  if (t.has("restaurant") || t.has("cafe") || t.has("food")) return { name: "restaurant", bg: "#EA580C" };
  if (t.has("park")) return { name: "leaf", bg: "#16A34A" };
  if (t.has("hospital") || t.has("pharmacy")) return { name: "medkit", bg: "#DC2626" };
  if (t.has("shopping_mall") || t.has("store")) return { name: "cart", bg: "#0891B2" };
  if (t.has("locality") || t.has("political") || t.has("administrative_area_level_1") || t.has("administrative_area_level_2")) {
    return { name: "business", bg: "#6B7280" };
  }
  return { name: "location", bg: "#DC2626" };
}

// Same m/km formatting convention as every other real distance shown in this app (see the
// Hotels/Restaurants/Fuel sheets' own formatDistance).
function formatPredictionDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

// Sentinel placeId for the "My Location" quick row below -- lets a caller tell "pick my live,
// continuously-updating GPS position" apart from a real place that merely happens to be near it
// (a frozen PlaceDetails.location snapshot would go stale the instant the driver moves).
export const MY_LOCATION_PLACE_ID = "__my_location__";

interface Props {
  biasLocation?: LatLng;
  onDestinationSelected: (place: PlaceDetails) => void;
  placeholder?: string;
  // Only set when this bar is standing in for a secondary pick (e.g. "add a stop") that the
  // user should be able to back out of without having picked anything.
  onCancel?: () => void;
  // Quick-action row shown only in the idle state (before typing/results), same visibility
  // gate as "Recent searches" below it -- skips typing a destination entirely and routes
  // straight to the real nearest bus/train stop. Omitted entirely (no row rendered) on the
  // secondary "add a stop"/mid-nav search bars, where it wouldn't make sense.
  onFindNearestStation?: () => void;
  findingNearestStation?: boolean;
  // Same idea/gating as onFindNearestStation above -- opens RestaurantsSheet instead of routing
  // anywhere directly, since picking a restaurant is its own real list (rating, price, distance)
  // rather than a single "closest one" shortcut.
  onFindRestaurants?: () => void;
  // Same again, opens HotelsSheet.
  onFindHotels?: () => void;
  // "My Location" row at the top of the idle dropdown, Apple/Google-Maps-style -- only passed
  // where picking the device's own live position as the result makes real sense (the "choose
  // starting point" bar). See MY_LOCATION_PLACE_ID above for how the caller tells it apart from
  // a real place.
  showMyLocation?: boolean;
  // Live reverse-geocoded street address for the device's current GPS fix, shown as a subtitle
  // under the "My Location" row so it's clear *which* real address tapping it will pick, not
  // just a generic label. Optional -- the row still works (falls back to no subtitle) before the
  // first reverse-geocode resolves.
  myLocationAddress?: string;
  // Renders a second "From" row above the main search input, inside the same card -- the
  // stacked From/To directions panel real map apps use. Only passed by the initial, pre-route
  // search bar; the add-a-stop and mid-nav bars have no "from" to show.
  originLabel?: string;
  onPressOrigin?: () => void;
  // Extra px pushed onto this bar's own top offset -- lets a caller stack something else (e.g.
  // MapTopPillRow) above it without this component needing to know anything about what that is.
  // Defaults to 0 -- every existing call site keeps its exact previous position.
  topOffset?: number;
}

export function DestinationSearchBar({
  biasLocation,
  onDestinationSelected,
  placeholder = "Search destination",
  onCancel,
  onFindNearestStation,
  findingNearestStation,
  onFindRestaurants,
  onFindHotels,
  showMyLocation,
  myLocationAddress,
  originLabel,
  onPressOrigin,
  topOffset = 0,
}: Props) {
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  // Deliberately NOT driven by TextInput focus state -- a blur fires the instant a history row
  // (or the old predictions list, which has the same shape of problem) is tapped, since the
  // tap itself moves focus off the input. Gating visibility on "is the input focused" would
  // unmount the row out from under the user's finger before the tap could register. Instead
  // this tracks "should the recent-searches panel be showing" as its own independent state,
  // exactly the same way the predictions list already only depends on predictions.length.
  const [historyVisible, setHistoryVisible] = useState(false);
  const [history, setHistory] = useState<PlaceDetails[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    getSearchHistory().then(setHistory);
  }, []);

  const dismissSearch = useCallback(() => {
    Keyboard.dismiss();
    setPredictions([]);
    setHistoryVisible(false);
  }, []);

  const onChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!text.trim()) {
        setPredictions([]);
        setErrorText(null);
        setHistoryVisible(true);
        return;
      }
      setHistoryVisible(false);
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        setErrorText(null);
        try {
          const results = await searchPlaces(text, biasLocation);
          setPredictions(results);
        } catch (err) {
          setPredictions([]);
          // Confirmed via direct testing that this app's Google API key returns the exact same
          // "You must enable Billing on the Google Cloud Project" error on every Maps Platform
          // call (Places, Directions, Street View alike) -- not a per-API restriction issue.
          // Surface that specific, actionable cause when it's what actually came back, instead
          // of a generic "check your key" guess that doesn't tell whoever owns the Google Cloud
          // project what to actually go do.
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

  const selectPlace = useCallback(
    (place: PlaceDetails) => {
      setQuery(place.name);
      setPredictions([]);
      Keyboard.dismiss();
      setHistoryVisible(false);
      addSearchHistoryEntry(place).then(setHistory);
      onDestinationSelected(place);
    },
    [onDestinationSelected]
  );

  // Deliberately bypasses selectPlace/addSearchHistoryEntry -- "My Location" is a live position,
  // not a real place worth remembering in search history, and the caller (see MY_LOCATION_PLACE_ID
  // above) needs the sentinel id intact to know to keep following GPS rather than freeze this
  // one snapshot of biasLocation.
  const selectMyLocation = useCallback(() => {
    if (!biasLocation) return;
    setQuery("My Location");
    setPredictions([]);
    Keyboard.dismiss();
    setHistoryVisible(false);
    onDestinationSelected({
      placeId: MY_LOCATION_PLACE_ID,
      name: "My Location",
      address: "Current location",
      location: biasLocation,
    });
  }, [biasLocation, onDestinationSelected]);

  const onSelectPrediction = useCallback(
    async (prediction: PlacePrediction) => {
      try {
        const details = await getPlaceDetails(prediction.placeId);
        selectPlace(details);
      } catch (err) {
        setErrorText(
          err instanceof PlacesApiError
            ? `Couldn't load that place (${err.status})`
            : "Couldn't load that place -- check your connection"
        );
      }
    },
    [selectPlace]
  );

  const onRemoveHistoryEntry = useCallback((placeId: string) => {
    removeSearchHistoryEntry(placeId).then((next) => {
      setHistory(next);
      if (next.length <= COLLAPSED_HISTORY_COUNT) setHistoryExpanded(false);
    });
  }, []);

  const onClearAllHistory = useCallback(() => {
    clearSearchHistory().then(() => {
      setHistory([]);
      setHistoryExpanded(false);
    });
  }, []);

  const showHistory = historyVisible && !query.trim() && predictions.length === 0 && history.length > 0;
  const showQuickActions = historyVisible && !query.trim() && predictions.length === 0 && !!onFindNearestStation;
  const showRestaurantsAction = historyVisible && !query.trim() && predictions.length === 0 && !!onFindRestaurants;
  const showHotelsAction = historyVisible && !query.trim() && predictions.length === 0 && !!onFindHotels;
  const showMyLocationRow =
    historyVisible && !query.trim() && predictions.length === 0 && !!showMyLocation && !!biasLocation;
  const visibleHistory = historyExpanded ? history : history.slice(0, COLLAPSED_HISTORY_COUNT);
  const hasOriginRow = !!originLabel && !!onPressOrigin;

  return (
    <>
      {/* Tapping the map while the keyboard/prediction dropdown is up used to do nothing --
          the keyboard just stayed open, blocking most of the screen with no obvious way out
          short of the keyboard's own dismiss key. Sits behind the search box in paint order
          (rendered first), so it only catches taps that land outside the box/dropdown, which
          keep working normally. Gated on whichever dropdown can actually be showing, not raw
          focus -- see historyVisible's own comment for why focus alone isn't the right signal. */}
      {(historyVisible || predictions.length > 0) && (
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissSearch} />
      )}
      <View style={[styles.container, { top: insets.top + spacing.md + topOffset }]}>
        <View style={hasOriginRow ? styles.fieldsCard : undefined}>
          {hasOriginRow && (
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
          <View style={hasOriginRow ? styles.inputRowFlat : styles.inputRow}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={onChangeText}
              onFocus={() => {
                if (!query.trim()) setHistoryVisible(true);
              }}
              placeholder={placeholder}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
            />
            {loading && <ActivityIndicator size="small" color={colors.accent} />}
            {onCancel && (
              <Pressable onPress={onCancel} hitSlop={10} accessibilityLabel="Cancel">
                <Ionicons name="close-circle" size={20} color={colors.textFaint} />
              </Pressable>
            )}
          </View>
        </View>
        {errorText && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{errorText}</Text>
          </View>
        )}
        {showMyLocationRow && (
          <Pressable
            style={({ pressed }) => [styles.myLocationRow, pressed && styles.rowPressed]}
            onPress={selectMyLocation}
          >
            <View style={styles.myLocationIconWrap}>
              <Ionicons name="navigate" size={13} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.myLocationText}>My Location</Text>
              {!!myLocationAddress && (
                <Text style={styles.myLocationAddress} numberOfLines={1}>
                  {myLocationAddress}
                </Text>
              )}
            </View>
          </Pressable>
        )}
        {showQuickActions && (
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
        {showRestaurantsAction && (
          <Pressable
            style={({ pressed }) => [styles.quickAction, pressed && styles.rowPressed]}
            // Real, confirmed complaint: this search bar's own TextInput could still be focused
            // (keyboard up) the moment this row is tapped -- unlike every other action in this
            // file (see the Keyboard.dismiss() calls above), this one never blurred it, so the
            // keyboard stayed up floating over the Restaurants sheet that opens underneath,
            // even though its own search input was never actually tapped.
            onPress={() => {
              Keyboard.dismiss();
              onFindRestaurants?.();
            }}
          >
            <Ionicons name="restaurant-outline" size={18} color={colors.accent} />
            <Text style={styles.quickActionText}>Restaurants nearby</Text>
          </Pressable>
        )}
        {showHotelsAction && (
          <Pressable
            style={({ pressed }) => [styles.quickAction, pressed && styles.rowPressed]}
            onPress={() => {
              Keyboard.dismiss();
              onFindHotels?.();
            }}
          >
            <Ionicons name="bed-outline" size={18} color={colors.accent} />
            <Text style={styles.quickActionText}>Hotels nearby</Text>
          </Pressable>
        )}
        {predictions.length > 0 && (
          <FlatList
            data={predictions}
            keyExtractor={(item) => item.placeId}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
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
        {showHistory && (
          <View style={styles.list}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyHeaderText}>Recent searches</Text>
              <View style={styles.historyHeaderActions}>
                <Pressable onPress={onClearAllHistory} hitSlop={8} accessibilityLabel="Clear all recent searches">
                  <Text style={styles.clearAllText}>Clear all</Text>
                </Pressable>
                {history.length > COLLAPSED_HISTORY_COUNT && (
                  <Pressable
                    onPress={() => setHistoryExpanded((v) => !v)}
                    hitSlop={8}
                    style={styles.dropdownButton}
                    accessibilityLabel={historyExpanded ? "Show fewer recent searches" : "Show all recent searches"}
                  >
                    <Ionicons name={historyExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>
            </View>
            {visibleHistory.map((place) => (
              <View key={place.placeId} style={styles.row}>
                <Pressable style={styles.historyRowMain} onPress={() => selectPlace(place)}>
                  <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.primaryText} numberOfLines={1}>
                      {place.name}
                    </Text>
                    {!!place.address && (
                      <Text style={styles.secondaryText} numberOfLines={1}>
                        {place.address}
                      </Text>
                    )}
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => onRemoveHistoryEntry(place.placeId)}
                  hitSlop={10}
                  style={styles.historyRemoveButton}
                  accessibilityLabel={`Remove ${place.name} from recent searches`}
                >
                  <Ionicons name="close" size={16} color={colors.textFaint} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    gap: spacing.sm,
    ...shadow.low,
  },
  // Same visual card as fieldsCard's outer wrapper provides the bg/radius/shadow for, so this
  // variant (used only when stacked under the origin row) stays flat -- otherwise the input row
  // would draw its own separate rounded card on top of the shared one, doubling the shadow/edge.
  inputRowFlat: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    height: 48,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  // Shared card for the stacked From/To directions panel -- one rounded rect containing both
  // the origin row and the search input, divided by a hairline, matching the real Apple/Google
  // Maps "plan a route" panel instead of two separately-shadowed boxes stacked with a gap.
  fieldsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadow.low,
  },
  originRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    // Extra right padding (beyond the ordinary paddingHorizontal) reserves real room for
    // MapScreen's Settings gear button, which floats on top of this bar's own top-right corner
    // -- a short placeholder/"My Location" label never reached that zone, but a real full
    // street address (this row's live reverse-geocoded origin label) routinely does, and
    // without this the text ran directly underneath the gear button instead of truncating
    // safely clear of it.
    paddingRight: spacing.md + 44,
    // minHeight (not a fixed height) -- a full street address routinely needs the 2 lines
    // originText now allows (see its own numberOfLines) instead of being clipped to whatever a
    // single 40px row could fit; the row grows to fit the real text instead of hiding it.
    minHeight: 40,
    paddingVertical: spacing.xs + 2,
  },
  originText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
    lineHeight: 18,
    color: colors.text,
  },
  originDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  myLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    ...shadow.low,
  },
  myLocationIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  myLocationText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  myLocationAddress: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  errorBanner: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#FEF2F2",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    ...shadow.low,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: colors.danger,
  },
  list: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    maxHeight: 320,
    ...shadow.low,
  },
  quickAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    ...shadow.low,
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.accent,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  // Real, confirmed request -- category-colored icon circle per result, matching Apple Maps'
  // own search result style instead of one flat generic pin for every row.
  predictionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  predictionTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs + 2,
  },
  predictionDistance: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  primaryText: {
    flexShrink: 1,
    fontSize: 15,
    color: colors.text,
    fontWeight: "600",
  },
  secondaryText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historyHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  historyHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.accent,
  },
  dropdownButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  historyRowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  historyRemoveButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
