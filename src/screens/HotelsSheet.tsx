import React, { forwardRef, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, Image, ActivityIndicator, Linking, Keyboard } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import { searchNearbyHotels, PlacesApiError, type NearbyPlace, type PlaceDetails } from "@/services/places";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

interface Props {
  location: LatLng | null;
  onSelect: (place: PlaceDetails) => void;
  onSheetChange?: (index: number) => void;
}

type PriceSort = "none" | "low-high" | "high-low";

const STAR_FILTERS = [0, 1, 2, 3, 4, 5];

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

function priceLevelText(level: number | undefined): string | null {
  if (level === undefined) return null;
  return "$".repeat(Math.max(1, level));
}

export const HotelsSheet = forwardRef<BottomSheet, Props>(function HotelsSheet(
  { location, onSelect, onSheetChange },
  ref
) {
  const snapPoints = useMemo(() => ["75%"], []);
  const [query, setQuery] = useState("");
  const [hotels, setHotels] = useState<NearbyPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  const [priceSort, setPriceSort] = useState<PriceSort>("none");
  const [minStars, setMinStars] = useState(0);

  useEffect(() => {
    if (!location) return;
    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    if (key === fetchedFor) return;
    setLoading(true);
    setErrorText(null);
    searchNearbyHotels(location)
      .then((results) => {
        setHotels(results);
        setFetchedFor(key);
      })
      .catch((err) => {
        setErrorText(
          err instanceof PlacesApiError
            ? `Couldn't load nearby hotels (${err.status})`
            : "Couldn't load nearby hotels -- check your connection"
        );
      })
      .finally(() => setLoading(false));
  }, [location, fetchedFor]);

  const visibleHotels = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = hotels.filter(
      (h) => (!q || h.name.toLowerCase().includes(q) || h.vicinity.toLowerCase().includes(q)) && (h.rating ?? 0) >= minStars
    );
    if (priceSort !== "none") {
      // Hotels with no real price-level data (Google itself doesn't have it for every listing)
      // always sort to the end regardless of direction -- "unknown" is never displayed as
      // cheaper or pricier than a real, known level.
      list = [...list].sort((a, b) => {
        if (a.priceLevel === undefined && b.priceLevel === undefined) return 0;
        if (a.priceLevel === undefined) return 1;
        if (b.priceLevel === undefined) return -1;
        return priceSort === "low-high" ? a.priceLevel - b.priceLevel : b.priceLevel - a.priceLevel;
      });
    } else {
      list = [...list].sort((a, b) => a.distanceMeters - b.distanceMeters);
    }
    return list;
  }, [hotels, query, priceSort, minStars]);

  return (
    <BottomSheet ref={ref} index={-1} snapPoints={snapPoints} enablePanDownToClose onChange={onSheetChange}>
      <BottomSheetView style={styles.content}>
        {/* Same keyboard-dismiss-on-background-tap fix as RestaurantsSheet -- see its own
            comment for why this is a plain Pressable, not a BottomSheetView replacement. */}
        <Pressable style={styles.pressableFill} onPress={() => Keyboard.dismiss()}>
        <Text style={styles.title}>Hotels nearby</Text>
        {/* Honest, per explicit request that nothing here be fake -- Google Places has real
            names/photos/ratings/price LEVEL for every hotel below, but no live per-night price
            or a real booking checkout (that needs an actual hotel-booking API relationship,
            e.g. Booking.com/Expedia, not something this app fabricates). "Open in Maps" links
            through to Google's own listing, which often does surface real booking links/prices
            there -- this app just isn't the one hosting that data yet. */}
        <View style={styles.noticeBox}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
          <Text style={styles.noticeText}>
            Real listings, photos &amp; ratings from Google. Live prices and booking aren't connected yet --
            tap "Open in Maps" on a hotel for booking options.
          </Text>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search hotels…"
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

        <View style={styles.filterRow}>
          <Pressable
            style={[styles.filterChip, priceSort === "low-high" && styles.filterChipActive]}
            onPress={() => setPriceSort((v) => (v === "low-high" ? "none" : "low-high"))}
          >
            <Ionicons name="arrow-up" size={12} color={priceSort === "low-high" ? "#FFFFFF" : colors.textMuted} />
            <Text style={[styles.filterChipText, priceSort === "low-high" && styles.filterChipTextActive]}>
              Cheapest
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterChip, priceSort === "high-low" && styles.filterChipActive]}
            onPress={() => setPriceSort((v) => (v === "high-low" ? "none" : "high-low"))}
          >
            <Ionicons name="arrow-down" size={12} color={priceSort === "high-low" ? "#FFFFFF" : colors.textMuted} />
            <Text style={[styles.filterChipText, priceSort === "high-low" && styles.filterChipTextActive]}>
              Priciest
            </Text>
          </Pressable>
        </View>
        <View style={styles.filterRow}>
          {STAR_FILTERS.map((stars) => (
            <Pressable
              key={stars}
              style={[styles.filterChip, minStars === stars && styles.filterChipActive]}
              onPress={() => setMinStars(stars)}
            >
              <Text style={[styles.filterChipText, minStars === stars && styles.filterChipTextActive]}>
                {stars === 0 ? "Any" : `${stars}★+`}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading && (
          <View style={styles.centerRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.centerText}>Finding hotels nearby…</Text>
          </View>
        )}
        {errorText && !loading && (
          <View style={styles.centerRow}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={[styles.centerText, { color: colors.danger }]}>{errorText}</Text>
          </View>
        )}
        {!loading && !errorText && visibleHotels.length === 0 && (
          <View style={styles.centerRow}>
            <Text style={styles.centerText}>{hotels.length === 0 ? "Nothing found nearby yet." : "No matches for this filter."}</Text>
          </View>
        )}

        <FlatList
          data={visibleHotels}
          keyExtractor={(item) => item.placeId}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
              // Real, confirmed complaint: unlike RestaurantsSheet's identical-looking row, this
              // row had no tap handler of its own at all -- only the two small "Directions"/"Open
              // in Maps" text buttons at the bottom responded, so tapping the photo/name/address
              // area (the natural place to tap, especially since it looks and lays out exactly
              // like a Restaurants row) silently did nothing. Whole row now defaults to the same
              // Directions action; the two explicit buttons below still work independently for
              // anyone who wants a specific action without hitting the broader row target.
              onPress={() =>
                onSelect({ placeId: item.placeId, name: item.name, address: item.vicinity, location: item.location })
              }
            >
              {item.photoUrl ? (
                <Image source={{ uri: item.photoUrl }} style={styles.photo} />
              ) : (
                <View style={[styles.photo, styles.photoFallback]}>
                  <Ionicons name="bed-outline" size={22} color={colors.textFaint} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                {/* Google's own `vicinity` field for a smaller/private lodging listing can come
                    back as just the bare country name ("Australia") instead of a real street-
                    level address -- a real value Google returned, not something this app
                    generated wrong, but showing it as-is reads as broken/fake. Hidden whenever
                    it doesn't look like a real street-level address (no digit and no comma),
                    same "never show something misleading" principle as the rest of this sheet --
                    the distance chip below still tells the driver how far it is either way. */}
                {/^.*\d/.test(item.vicinity) || item.vicinity.includes(",") ? (
                  <Text style={styles.vicinity} numberOfLines={1}>
                    {item.vicinity}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  {item.rating !== undefined && (
                    <View style={styles.metaChip}>
                      <Ionicons name="star" size={11} color="#F59E0B" />
                      <Text style={styles.metaChipText}>{item.rating.toFixed(1)}</Text>
                    </View>
                  )}
                  {priceLevelText(item.priceLevel) && (
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>{priceLevelText(item.priceLevel)}</Text>
                    </View>
                  )}
                  <Text style={styles.distanceText}>{formatDistance(item.distanceMeters)}</Text>
                </View>
                <View style={styles.actionRow}>
                  <Pressable
                    style={({ pressed }) => [styles.actionButton, pressed && { opacity: pressedOpacity }]}
                    onPress={() =>
                      onSelect({ placeId: item.placeId, name: item.name, address: item.vicinity, location: item.location })
                    }
                  >
                    <Ionicons name="navigate-outline" size={13} color={colors.accent} />
                    <Text style={styles.actionButtonText}>Directions</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.actionButton, pressed && { opacity: pressedOpacity }]}
                    onPress={() =>
                      Linking.openURL(`https://www.google.com/maps/place/?q=place_id:${item.placeId}`).catch(() => {})
                    }
                  >
                    <Ionicons name="open-outline" size={13} color={colors.accent} />
                    <Text style={styles.actionButtonText}>Open in Maps</Text>
                  </Pressable>
                </View>
              </View>
            </Pressable>
          )}
        />
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.lg },
  pressableFill: { flex: 1 },
  title: { fontSize: 17, fontWeight: "800", color: colors.text, marginBottom: spacing.sm },
  noticeBox: {
    flexDirection: "row",
    gap: spacing.xs + 2,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  noticeText: { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 15 },
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
  filterRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.xs, flexWrap: "wrap" },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  filterChipActive: { backgroundColor: colors.accent },
  filterChipText: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  filterChipTextActive: { color: "#FFFFFF" },
  centerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  centerText: { fontSize: 13, color: colors.textMuted },
  listContent: { paddingBottom: spacing.xxl, gap: spacing.xs, paddingTop: spacing.xs },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  photo: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  photoFallback: { alignItems: "center", justifyContent: "center" },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  vicinity: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaChipText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  distanceText: { fontSize: 12, color: colors.textFaint, marginLeft: "auto" },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs + 2 },
  actionButton: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionButtonText: { fontSize: 12, fontWeight: "700", color: colors.accent },
});
