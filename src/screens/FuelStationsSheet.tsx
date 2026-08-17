import React, { forwardRef, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Keyboard } from "react-native";
import BottomSheet, { BottomSheetView, BottomSheetFlatList } from "@gorhom/bottom-sheet";
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
  // Same fix as RestaurantsSheet/HotelsSheet -- capped to a shorter default, draggable up to a
  // taller point instead of a single large fixed size.
  const snapPoints = useMemo(() => ["50%", "88%"], []);
  const [fuelStations, setFuelStations] = useState<FuelStation[]>([]);
  const [fallbackStations, setFallbackStations] = useState<NearbyPlace[]>([]);
  const [mode, setMode] = useState<"live" | "fallback" | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  const [fuelCheckConfigured, setFuelCheckConfigured] = useState(false);
  useEffect(() => subscribeFuelCheckProviderStatus(setFuelCheckConfigured), []);

  useEffect(() => {
    if (!location) return;
    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    if (key === fetchedFor) return;
    const region = classifyAuRegion(location.latitude, location.longitude);
    setLoading(true);
    setErrorText(null);

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
          } else {
            setErrorText(result.message);
          }
        })
        .catch(() => setErrorText("Couldn't load live fuel prices -- check your connection"))
        .finally(() => setLoading(false));
    } else {
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
    }
  }, [location, fetchedFor, fuelCheckConfigured]);

  return (
    <BottomSheet ref={ref} index={-1} snapPoints={snapPoints} enablePanDownToClose onChange={onSheetChange}>
      <BottomSheetView style={styles.content}>
        <Pressable style={styles.pressableFill} onPress={() => Keyboard.dismiss()}>
          <Text style={styles.title}>Petrol stations nearby</Text>

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
            fuelStations.length === 0 && (
              <View style={styles.centerRow}>
                <Text style={styles.centerText}>Nothing found nearby yet.</Text>
              </View>
            )}
          {!loading &&
            !errorText &&
            mode === "fallback" &&
            fallbackStations.length === 0 && (
              <View style={styles.centerRow}>
                <Text style={styles.centerText}>Nothing found nearby yet.</Text>
              </View>
            )}

          {mode === "live" && (
            <BottomSheetFlatList
              data={fuelStations}
              keyExtractor={(item) => item.stationId}
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
              data={fallbackStations}
              keyExtractor={(item) => item.placeId}
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
  centerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  centerText: { fontSize: 13, color: colors.textMuted },
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
