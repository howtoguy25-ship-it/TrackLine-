import React, { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, FlatList, Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { SimpleBottomSheet, type SimpleBottomSheetRef } from "@/components/SimpleBottomSheet";
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
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";
import { setActiveSearchFocus, isActiveSearchFocus, clearActiveSearchFocusIfOwner } from "@/utils/activeSearchFocus";

const SEARCH_FOCUS_KEY = "fuel";

// Real, explicit request -- "add in where I can see [petrol stations] on map," distinct from
// this sheet's own list. Reported up to MapScreen (via onStationsChange below) as ready-to-
// render pin descriptors, own onPress included, so MapScreen never needs to know whether a given
// station came from live FuelCheck data or the Google Places fallback -- it just renders
// whatever pins it's given and lets each one's own onPress do the right thing (the exact same
// onSelect/onViewDetails action its matching list row already uses).
export interface FuelStationPin {
  id: string;
  lat: number;
  lng: number;
  name: string;
  priceCents: number | null;
  onPress: () => void;
}

interface Props {
  location: LatLng | null;
  onSelect: (place: PlaceDetails) => void;
  onViewDetails: (placeId: string) => void;
  onSheetChange?: (index: number) => void;
  onStationsChange?: (pins: FuelStationPin[]) => void;
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

// Real, confirmed constraint (see fuelPrices.ts's own header): live prices only exist for NSW
// today, via the NSW Government's own FuelCheck API -- there's no equivalent official live-price
// feed for any other Australian state/territory found. Checked here, not guessed.
const LIVE_PRICE_REGION = "NSW";

export const FuelStationsSheet = forwardRef<SimpleBottomSheetRef, Props>(function FuelStationsSheet(
  { location, onSelect, onViewDetails, onSheetChange, onStationsChange },
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
  // Same real third fix as RestaurantsSheet/HotelsSheet -- see RestaurantsSheet's own comment:
  // refetching on every live GPS update while this sheet is already open replaces the station
  // list mid-scroll, which reads exactly like a recoil. Gated to only ever refetch on first
  // mount or a fresh reopen.
  const [sheetIndex, setSheetIndex] = useState(-1);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!location || !fuelCheckStatusReady) return;
    const isOpen = sheetIndex >= 0;
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (fetchedFor !== null && !justOpened) return;
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
  }, [location, fetchedFor, fuelCheckConfigured, fuelCheckStatusReady, sheetIndex]);

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

  // Real, confirmed bug this "latest ref" pattern fixes: this effect used to list onSelect/
  // onViewDetails/onStationsChange directly as dependencies -- fine as long as every caller
  // happens to pass stable references, but MapScreen.tsx's own onSelect was (until just now) a
  // fresh inline arrow function on every render, which re-ran this effect every render too,
  // which called onStationsChange -> a MapScreen state update -> another MapScreen render ->
  // another brand-new onSelect -> the effect firing again, forever. A genuine infinite render
  // loop, not a metaphor -- confirmed from screenshot evidence (general "bugginess", search
  // predictions never appearing, every "Finding X nearby" spinner across all three place sheets
  // stuck indefinitely even with real network timeouts in place, since a JS thread pinned in a
  // continuous render loop can starve async callbacks from ever getting a turn to run at all).
  // MapScreen.tsx's own onSelect is now itself a stable useCallback (the real, direct fix), but
  // this effect no longer trusts ANY caller to keep its callback props stable -- refs updated on
  // every render (cheap, no effect re-run) hold the latest versions, and the effect itself only
  // re-runs when the real station DATA changes, never when a caller's callback identity does.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onViewDetailsRef = useRef(onViewDetails);
  onViewDetailsRef.current = onViewDetails;
  const onStationsChangeRef = useRef(onStationsChange);
  onStationsChangeRef.current = onStationsChange;

  // Reports the FULL (un-filtered) result set, not filteredFuelStations/filteredFallbackStations
  // -- map pins showing every real station found stays independent of this sheet's own text
  // search, the same way typing a filter here was never meant to also hide pins on the map.
  useEffect(() => {
    if (!onStationsChangeRef.current) return;
    if (mode === "live") {
      onStationsChangeRef.current(
        fuelStations
          .filter((s): s is FuelStation & { location: { latitude: number; longitude: number } } =>
            s.location.latitude != null && s.location.longitude != null
          )
          .map((s) => ({
            id: s.stationId,
            lat: s.location.latitude,
            lng: s.location.longitude,
            name: s.name ?? "Petrol station",
            priceCents: s.priceCents,
            onPress: () =>
              onSelectRef.current({
                placeId: `fuel:${s.stationId}`,
                name: s.name ?? "Petrol station",
                address: s.address ?? "",
                location: { latitude: s.location.latitude as number, longitude: s.location.longitude as number },
              }),
          }))
      );
    } else if (mode === "fallback") {
      onStationsChangeRef.current(
        fallbackStations.map((s) => ({
          id: s.placeId,
          lat: s.location.latitude,
          lng: s.location.longitude,
          name: s.name,
          priceCents: null,
          onPress: () => onViewDetailsRef.current(s.placeId),
        }))
      );
    } else {
      onStationsChangeRef.current([]);
    }
  }, [mode, fuelStations, fallbackStations]);

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
            space to dismiss the keyboard) deliberately stops before either list below instead of
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

        {/* Plain, un-wrapped FlatLists -- see SimpleBottomSheet.tsx's own header comment for why
            these now have zero gesture composition with the sheet at all. */}
        {mode === "live" && (
            <FlatList
              data={filteredFuelStations}
              keyExtractor={(item) => item.stationId}
              style={styles.listFlex}
              contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xxl }]}
              // Real, explicit request -- Android-specific nested-scroll fix for a list living
              // inside the sheet's own gesture-handler view hierarchy.
              nestedScrollEnabled
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
            <FlatList
              data={filteredFallbackStations}
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
        )}
      </View>
    </SimpleBottomSheet>
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
