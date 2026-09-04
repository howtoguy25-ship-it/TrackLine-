import React, { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, FlatList, Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { SimpleBottomSheet, type SimpleBottomSheetRef } from "@/components/SimpleBottomSheet";
import { searchNearbyPetrolStations, searchPlacesByText, PlacesApiError, type NearbyPlace } from "@/services/places";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";
import { setActiveSearchFocus, isActiveSearchFocus, clearActiveSearchFocusIfOwner } from "@/utils/activeSearchFocus";

const SEARCH_FOCUS_KEY = "fuel";

// Real, explicit request -- "add in where I can see [petrol stations] on map," distinct from
// this sheet's own list. Reported up to MapScreen (via onStationsChange below) as ready-to-
// render pin descriptors, own onPress included.
//
// No longer carries a price -- real, explicit request to remove the live NSW FuelCheck price
// integration entirely. Its OAuth token endpoint had a genuine, confirmed external outage
// (tested with real credentials, bogus credentials, and multiple retries, all hitting the same
// broken response from NSW's own government server, not this app's code), and even working it
// only ever covered NSW. This sheet is real Google Places station locations only now, same as
// RestaurantsSheet/HotelsSheet.
export interface FuelStationPin {
  id: string;
  lat: number;
  lng: number;
  name: string;
  onPress: () => void;
}

interface Props {
  location: LatLng | null;
  onViewDetails: (placeId: string) => void;
  onSheetChange?: (index: number) => void;
  onStationsChange?: (pins: FuelStationPin[]) => void;
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export const FuelStationsSheet = forwardRef<SimpleBottomSheetRef, Props>(function FuelStationsSheet(
  { location, onViewDetails, onSheetChange, onStationsChange },
  ref
) {
  const insets = useSafeAreaInsets();
  // Same fix as RestaurantsSheet/HotelsSheet -- capped to a shorter default, draggable up to a
  // taller point instead of a single large fixed size.
  const snapFractions: [number, number] = [0.5, 0.88];

  // Same real bug fix/history as RestaurantsSheet/HotelsSheet -- see SimpleBottomSheet.tsx's own
  // header comment for the full account of why this no longer uses @gorhom/bottom-sheet at all.
  // Gated on isActiveSearchFocus -- see RestaurantsSheet's own comment for the scroll-reset bug
  // this prevents (ANY of the three place sheets' keyboards hiding used to resnap ALL of them,
  // not just its own).
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", () => {
      if (!isActiveSearchFocus(SEARCH_FOCUS_KEY)) return;
      clearActiveSearchFocusIfOwner(SEARCH_FOCUS_KEY);
      if (ref && typeof ref !== "function") ref.current?.snapToIndex(0);
    });
    return () => sub.remove();
  }, [ref]);

  const [stations, setStations] = useState<NearbyPlace[]>([]);
  // Real, confirmed request -- same live, letter-by-letter filter-against-already-fetched-results
  // pattern as RestaurantsSheet/HotelsSheet, matched against name AND address/vicinity.
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  // Same real third fix as RestaurantsSheet/HotelsSheet -- see RestaurantsSheet's own comment:
  // refetching on every live GPS update while this sheet is already open replaces the station
  // list mid-scroll, which reads exactly like a recoil. Gated to only ever refetch on first
  // mount or a fresh reopen.
  const [sheetIndex, setSheetIndex] = useState(-1);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!location) return;
    const isOpen = sheetIndex >= 0;
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (fetchedFor !== null && !justOpened) return;
    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    if (key === fetchedFor) return;
    setLoading(true);
    setErrorText(null);
    searchNearbyPetrolStations(location)
      .then((results) => {
        setStations(results.sort((a, b) => a.distanceMeters - b.distanceMeters));
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
  }, [location, fetchedFor, sheetIndex]);

  // Real, explicit request: "everything they can think of they can search" -- broadens a real
  // search (2+ characters) out to Google's actual Text Search API, merged with the instant local
  // filter results -- see RestaurantsSheet's own comment for the full reasoning.
  const TEXT_SEARCH_DEBOUNCE_MS = 450;
  const [textSearchResults, setTextSearchResults] = useState<NearbyPlace[]>([]);
  const [textSearching, setTextSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !location) {
      setTextSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setTextSearching(true);
      searchPlacesByText(q, location, "gas_station")
        .then(setTextSearchResults)
        .catch(() => {})
        .finally(() => setTextSearching(false));
    }, TEXT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, location]);

  const filteredStations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stations;
    const localMatches = stations.filter((s) => s.name.toLowerCase().includes(q) || s.vicinity.toLowerCase().includes(q));
    if (textSearchResults.length === 0) return localMatches;
    const merged = new Map<string, NearbyPlace>();
    for (const s of localMatches) merged.set(s.placeId, s);
    for (const s of textSearchResults) merged.set(s.placeId, s);
    return Array.from(merged.values()).sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [stations, query, textSearchResults]);

  // Real, confirmed bug this "latest ref" pattern fixes: this effect used to list onViewDetails/
  // onStationsChange directly as dependencies -- fine as long as every caller happens to pass
  // stable references, but MapScreen.tsx's own callback was (until fixed) a fresh inline arrow
  // function on every render, which re-ran this effect every render too, which called
  // onStationsChange -> a MapScreen state update -> another MapScreen render -> a brand-new
  // callback -> the effect firing again, forever. A genuine infinite render loop, not a metaphor.
  // Refs updated on every render (cheap, no effect re-run) hold the latest versions, and the
  // effect itself only re-runs when the real station DATA changes, never when a caller's
  // callback identity does.
  const onViewDetailsRef = useRef(onViewDetails);
  onViewDetailsRef.current = onViewDetails;
  const onStationsChangeRef = useRef(onStationsChange);
  onStationsChangeRef.current = onStationsChange;

  // Reports the FULL (un-filtered) result set, not filteredStations -- map pins showing every
  // real station found stays independent of this sheet's own text search.
  useEffect(() => {
    if (!onStationsChangeRef.current) return;
    onStationsChangeRef.current(
      stations.map((s) => ({
        id: s.placeId,
        lat: s.location.latitude,
        lng: s.location.longitude,
        name: s.name,
        onPress: () => onViewDetailsRef.current(s.placeId),
      }))
    );
  }, [stations]);

  // Clears any reported pins the instant this sheet unmounts (a route starting -- see
  // MapScreen.tsx's place-sheets block) so a stale set of petrol pins never lingers on the map
  // once the sheet that produced them is gone. Reads the ref (always current), not a value
  // closed over at mount time.
  useEffect(() => {
    return () => onStationsChangeRef.current?.([]);
  }, []);

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
        {/* Same real fix as HotelsSheet/RestaurantsSheet -- this Pressable (tap blank header
            space to dismiss the keyboard) deliberately stops before the list below instead of
            wrapping it -- real, confirmed two-fingers-to-scroll bug otherwise. */}
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

          {loading && (
            <View style={styles.centerRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.centerText}>Finding petrol stations nearby…</Text>
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
            </View>
          )}
          {!loading && !errorText && filteredStations.length === 0 && (
            <View style={styles.centerRow}>
              <Text style={styles.centerText}>
                {stations.length === 0 ? "Nothing found nearby yet." : "No matches for that search."}
              </Text>
            </View>
          )}
        </Pressable>

        {/* Plain, un-wrapped FlatList -- see SimpleBottomSheet.tsx's own header comment for why
            this now has zero gesture composition with the sheet at all. */}
        <FlatList
          data={filteredStations}
          keyExtractor={(item) => item.placeId}
          style={styles.listFlex}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xxl }]}
          // Real, explicit request -- Android-specific nested-scroll fix for a list living
          // inside the sheet's own gesture-handler view hierarchy.
          nestedScrollEnabled
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
      </View>
    </SimpleBottomSheet>
  );
});

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.lg },
  // No longer flex:1 -- this now wraps only the static header (title/search/notices), not the
  // list, so it sizes to its own natural content height and leaves the list (its own flex:1
  // sibling, see listFlex) to fill the rest of the sheet.
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
  distanceText: { fontSize: 12, color: colors.textFaint, marginLeft: "auto" },
});
