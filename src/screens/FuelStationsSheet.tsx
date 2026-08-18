import React, { forwardRef, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Keyboard } from "react-native";
import BottomSheet, { BottomSheetView, BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  searchNearbyPetrolStations,
  PlacesApiError,
  haversineMeters,
  type NearbyPlace,
  type PlaceDetails,
} from "@/services/places";
import { getFuelPrices, subscribeFuelCheckProviderStatus, type FuelStation } from "@/services/fuelPrices";
import { classifyAuRegion } from "@/utils/auStates";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

interface Props {
  location: LatLng | null;
  onSelect: (place: PlaceDetails) => void;
  onViewDetails: (placeId: string) => void;
  onSheetChange?: (index: number) => void;
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

// Real, confirmed constraint (see fuelPrices.ts's own header): live prices only exist for NSW
// today, via the NSW Government's own FuelCheck API -- there's no equivalent official live-price
// feed for any other Australian state/territory found. Checked here, not guessed.
const LIVE_PRICE_REGION = "NSW";

export const FuelStationsSheet = forwardRef<BottomSheet, Props>(function FuelStationsSheet(
  { location, onSelect, onViewDetails, onSheetChange },
  ref
) {
  const insets = useSafeAreaInsets();
  // Same fix as RestaurantsSheet/HotelsSheet -- capped to a shorter default, draggable up to a
  // taller point instead of a single large fixed size.
  const snapPoints = useMemo(() => ["50%", "88%"], []);

  // Same real bug fix as RestaurantsSheet/HotelsSheet -- the keyboard-avoidance snap to the
  // taller point otherwise sticks around after the keyboard closes.
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", () => {
      if (ref && typeof ref !== "function") ref.current?.snapToIndex(0);
    });
    return () => sub.remove();
  }, [ref]);

  const [fuelStations, setFuelStations] = useState<FuelStation[]>([]);
  const [fallbackStations, setFallbackStations] = useState<NearbyPlace[]>([]);
  const [mode, setMode] = useState<"live" | "fallback" | null>(null);
  // Real, confirmed request -- same live, letter-by-letter filter-against-already-fetched-results
  // pattern as RestaurantsSheet/HotelsSheet, matched against name AND address/vicinity (station
  // title and place), not just a fetch trigger.
  const [query, setQuery] = useState("");
  // Starts true (not false) -- avoids a blank flash while waiting for location and the
  // FuelCheck-provider-status subscription to both resolve before the fetch effect can run.
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  const [fuelCheckConfigured, setFuelCheckConfigured] = useState(false);
  // Real, confirmed bug: onSnapshot always delivers its first value asynchronously, but
  // `location` is usually already available the instant this sheet opens (GPS tracking is
  // already running) -- so the fetch effect below used to fire in fallback mode before this
  // subscription's real value ever arrived, then never retried because `fetchedFor` was already
  // set for that location. Gating the fetch on this flag means it waits for the real answer
  // instead of racing it.
  const [fuelCheckStatusReady, setFuelCheckStatusReady] = useState(false);
  useEffect(
    () =>
      subscribeFuelCheckProviderStatus((enabled) => {
        setFuelCheckConfigured(enabled);
        setFuelCheckStatusReady(true);
      }),
    []
  );

  useEffect(() => {
    if (!location || !fuelCheckStatusReady) return;
    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    if (key === fetchedFor) return;
    const region = classifyAuRegion(location.latitude, location.longitude);
    setLoading(true);
    setErrorText(null);

    // Real, confirmed complaint: a live-price failure (the FuelCheck API/gateway hiccupping,
    // a transient network error) used to leave the sheet showing only an error message with a
    // totally empty list. Falling back to real Google Places station locations (no live price,
    // same honest treatment a non-NSW region already gets) means a driver still sees real,
    // useful nearby stations instead of nothing at all -- the error text still shows too, so
    // it's never silently hidden, just no longer a dead end.
    const fetchFallbackStations = () => {
      searchNearbyPetrolStations(location)
        .then((results) => {
          setMode("fallback");
          setFallbackStations(results.sort((a, b) => a.distanceMeters - b.distanceMeters));
          setFetchedFor(key);
        })
        .catch((err) => {
          setErrorText(
            err instanceof PlacesApiError
              ? `Couldn't load nearby petrol stations (${err.status})`
              : "Couldn't load nearby petrol stations -- check your connection"
          );
        })
        .finally(() => setLoading(false));
    };

    if (region === LIVE_PRICE_REGION && fuelCheckConfigured) {
      getFuelPrices(location)
        .then((result) => {
          if (result.outcome === "success" && result.stations) {
            setMode("live");
            setFuelStations(
              [...result.stations].sort((a, b) => {
                const da =
                  a.location.latitude != null && a.location.longitude != null
                    ? haversineMeters(location, { latitude: a.location.latitude, longitude: a.location.longitude })
                    : Infinity;
                const db =
                  b.location.latitude != null && b.location.longitude != null
                    ? haversineMeters(location, { latitude: b.location.latitude, longitude: b.location.longitude })
                    : Infinity;
                return da - db;
              })
            );
            setFetchedFor(key);
            setLoading(false);
          } else {
            setErrorText(result.message);
            fetchFallbackStations();
          }
        })
        .catch(() => {
          setErrorText("Couldn't load live fuel prices -- showing nearby stations instead.");
          fetchFallbackStations();
        });
    } else {
      fetchFallbackStations();
    }
  }, [location, fetchedFor, fuelCheckConfigured, fuelCheckStatusReady]);

  const filteredFuelStations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fuelStations;
    return fuelStations.filter(
      (s) => (s.name ?? "").toLowerCase().includes(q) || (s.address ?? "").toLowerCase().includes(q) || (s.brand ?? "").toLowerCase().includes(q)
    );
  }, [fuelStations, query]);

  const filteredFallbackStations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fallbackStations;
    return fallbackStations.filter((s) => s.name.toLowerCase().includes(q) || s.vicinity.toLowerCase().includes(q));
  }, [fallbackStations, query]);

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      // Same real fix as HotelsSheet/RestaurantsSheet -- see that file's own comment: without
      // this, dragging the list rubber-banded the whole sheet (title included) past its own
      // tallest snap point instead of just scrolling the list underneath it.
      enableOverDrag={false}
      // Same real fix as HotelsSheet -- see that file's own comment: without this, a single
      // finger dragging on the list was captured by the sheet's own content-pan gesture instead
      // of the list's native scroll (only two fingers actually scrolled it). Leaves only the
      // drag handle draggable for resize/dismiss.
      enableContentPanningGesture={false}
      // Same real root-cause fix as RestaurantsSheet/HotelsSheet -- see RestaurantsSheet's own
      // comment: v5's default enableDynamicSizing=true re-measures the sheet's content height
      // off a nested BottomSheetFlatList (whose own height keeps changing as rows mount/unmount
      // via windowing while scrolling) and re-syncs the scroll offset against it, producing the
      // "scrolls fine for a few seconds then snaps back to the top" symptom.
      enableDynamicSizing={false}
      // Same real fix as RestaurantsSheet/HotelsSheet -- keeps the header below the real
      // safe-area top at the taller 88% snap point instead of sliding in under the status bar.
      topInset={insets.top}
      onChange={onSheetChange}
    >
      <BottomSheetView style={styles.content}>
        {/* Same real fix as HotelsSheet/RestaurantsSheet -- this Pressable (tap blank header
            space to dismiss the keyboard) deliberately stops before either BottomSheetFlatList
            below instead of wrapping it -- real, confirmed two-fingers-to-scroll bug otherwise. */}
        <Pressable style={styles.pressableFill} onPress={() => Keyboard.dismiss()}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Petrol stations nearby</Text>
            {/* Real, confirmed complaint: no explicit close affordance -- only drag-to-dismiss. */}
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
              placeholder="Search petrol stations…"
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => Keyboard.dismiss()}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={colors.textFaint} />
              </Pressable>
            )}
          </View>

          {mode === "live" && (
            <View style={styles.noticeBox}>
              <Ionicons name="flash" size={14} color="#16A34A" />
              <Text style={styles.noticeText}>
                Live regular unleaded (U91) prices from the NSW Government's own FuelCheck service.
              </Text>
            </View>
          )}
          {mode === "fallback" && (
            <View style={styles.noticeBox}>
              <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
              <Text style={styles.noticeText}>
                Real station locations from Google. Live prices aren't connected for this state yet.
              </Text>
            </View>
          )}

          {loading && (
            <View style={styles.centerRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.centerText}>Finding petrol stations nearby…</Text>
            </View>
          )}
          {errorText && !loading && (
            <View style={styles.centerRow}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={[styles.centerText, { color: colors.danger }]}>{errorText}</Text>
            </View>
          )}
          {!loading &&
            !errorText &&
            mode === "live" &&
            filteredFuelStations.length === 0 && (
              <View style={styles.centerRow}>
                <Text style={styles.centerText}>
                  {fuelStations.length === 0 ? "Nothing found nearby yet." : "No matches for that search."}
                </Text>
              </View>
            )}
          {!loading &&
            !errorText &&
            mode === "fallback" &&
            filteredFallbackStations.length === 0 && (
              <View style={styles.centerRow}>
                <Text style={styles.centerText}>
                  {fallbackStations.length === 0 ? "Nothing found nearby yet." : "No matches for that search."}
                </Text>
              </View>
            )}
        </Pressable>

        {mode === "live" && (
            <BottomSheetFlatList
              data={filteredFuelStations}
              keyExtractor={(item) => item.stationId}
              style={styles.listFlex}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const dist =
                  location && item.location.latitude != null && item.location.longitude != null
                    ? haversineMeters(location, { latitude: item.location.latitude, longitude: item.location.longitude })
                    : null;
                return (
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
                    onPress={() =>
                      item.location.latitude != null && item.location.longitude != null
                        ? onSelect({
                            placeId: `fuel:${item.stationId}`,
                            name: item.name ?? "Petrol station",
                            address: item.address ?? "",
                            location: { latitude: item.location.latitude, longitude: item.location.longitude },
                          })
                        : undefined
                    }
                  >
                    <View style={styles.fuelIconWrap}>
                      <MaterialCommunityIcons name="gas-station" size={22} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {item.name ?? "Petrol station"}
                      </Text>
                      <Text style={styles.vicinity} numberOfLines={1}>
                        {[item.brand, item.address].filter(Boolean).join(" · ") || "—"}
                      </Text>
                      <View style={styles.metaRow}>
                        {item.priceCents != null && (
                          <View style={styles.priceChip}>
                            <Text style={styles.priceChipText}>
                              ${(item.priceCents / 100).toFixed(2)}/L {item.fuelType}
                            </Text>
                          </View>
                        )}
                        {dist !== null && <Text style={styles.distanceText}>{formatDistance(dist)}</Text>}
                      </View>
                    </View>
                    <Ionicons name="navigate-outline" size={18} color={colors.accent} />
                  </Pressable>
                );
              }}
            />
          )}

          {mode === "fallback" && (
            <BottomSheetFlatList
              data={filteredFallbackStations}
              keyExtractor={(item) => item.placeId}
              style={styles.listFlex}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
                  onPress={() => onViewDetails(item.placeId)}
                >
                  <View style={styles.fuelIconWrap}>
                    <MaterialCommunityIcons name="gas-station" size={22} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.vicinity} numberOfLines={1}>
                      {item.vicinity}
                    </Text>
                    <View style={styles.metaRow}>
                      {item.rating !== undefined && (
                        <View style={styles.metaChip}>
                          <Ionicons name="star" size={11} color="#F59E0B" />
                          <Text style={styles.metaChipText}>{item.rating.toFixed(1)}</Text>
                        </View>
                      )}
                      <Text style={styles.distanceText}>{formatDistance(item.distanceMeters)}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                </Pressable>
              )}
            />
        )}
      </BottomSheetView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.lg },
  // No longer flex:1 -- this now wraps only the static header (title/search/notices), not
  // either list, so it sizes to its own natural content height and leaves whichever list is
  // active (its own flex:1 sibling, see listFlex) to fill the rest of the sheet.
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
  noticeBox: {
    flexDirection: "row",
    gap: spacing.xs + 2,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  noticeText: { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  centerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  centerText: { fontSize: 13, color: colors.textMuted },
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
  fuelIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  vicinity: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaChipText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  priceChip: {
    backgroundColor: "rgba(22, 163, 74, 0.12)",
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  priceChipText: { fontSize: 12, fontWeight: "800", color: "#16A34A" },
  distanceText: { fontSize: 12, color: colors.textFaint, marginLeft: "auto" },
});
