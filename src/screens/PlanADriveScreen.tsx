import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, StyleSheet, FlatList, ActivityIndicator, Keyboard } from "react-native";
import { Text, TextInput } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLocation } from "@/context/LocationContext";
import {
  searchPlaces,
  getPlaceDetails,
  PlacesApiError,
  type PlacePrediction,
  type PlaceDetails,
} from "@/services/places";
import { getSavedPlaces, type SavedPlaces } from "@/services/savedPlaces";
import { getSearchHistory } from "@/services/searchHistory";
import { getDirections, DirectionsApiError } from "@/services/directions";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";

// Real, explicit request (Waze-style redesign Phase 4 -- main menu's "Plan a drive" card).
// Picks a real destination (same search/saved-places/history data every other picker in this
// app already uses) and a departure time, shows the real ETA for that combination, then hands
// off to the already-running MapScreen to actually start the route -- MapScreen owns all of
// this app's search-to-route state internally (see its own onDestinationSelected), so this
// screen never duplicates that logic, it just navigates back with the picked place/time and lets
// MapScreen pick it up (see RootNavigator.tsx's own comment on the Map screen's params).
//
// Departure time is a real LIST of presets (Now / 15 / 30 / 60 min), not a free-form time
// picker -- deliberately, there's no date/time-picker native dependency in this project yet, and
// a short preset list is both a real, honest match for "plan a drive time list" and already
// covers the realistic case (checking the drive before leaving soon), without asking the app to
// take on a new native dependency just for this screen. Only "Now" gets a real live-traffic ETA
// the normal way (departure_time=now); the later presets pass their own real future
// departure_time to Google's own Directions API, which genuinely computes a predictive,
// traffic-model-based duration for that time -- never a client-guessed adjustment.
const DEPARTURE_PRESETS = [
  { label: "Leave now", minutesFromNow: 0 },
  { label: "15 min", minutesFromNow: 15 },
  { label: "30 min", minutesFromNow: 30 },
  { label: "1 hour", minutesFromNow: 60 },
] as const;

export function PlanADriveScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { location } = useLocation();

  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState<SavedPlaces>({ home: null, work: null, custom: [] });
  const [history, setHistory] = useState<PlaceDetails[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSavedPlaces().then(setSaved);
    getSearchHistory().then(setHistory);
  }, []);

  const [destination, setDestination] = useState<PlaceDetails | null>(null);
  const [minutesFromNow, setMinutesFromNow] = useState(0);
  const [eta, setEta] = useState<{ etaText: string; distanceText: string } | null>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  const [etaError, setEtaError] = useState<string | null>(null);

  const onChangeText = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setPredictions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setPredictions(await searchPlaces(text, location?.coords));
      } catch {
        setPredictions([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  };

  const pickPlace = useCallback(async (place: PlaceDetails) => {
    Keyboard.dismiss();
    setDestination(place);
    setEta(null);
    setEtaError(null);
    setQuery("");
    setPredictions([]);
  }, []);

  const onPickPrediction = async (prediction: PlacePrediction) => {
    const place = await getPlaceDetails(prediction.placeId);
    pickPlace(place);
  };

  useEffect(() => {
    if (!destination || !location) return;
    let cancelled = false;
    setEtaLoading(true);
    setEtaError(null);
    const departureUnixSeconds = minutesFromNow === 0 ? true : Math.floor(Date.now() / 1000) + minutesFromNow * 60;
    getDirections(location.coords, destination.location, { useTraffic: departureUnixSeconds })
      .then((route) => {
        if (cancelled) return;
        setEta({ etaText: route.etaInTrafficText ?? route.etaText, distanceText: route.distanceText });
      })
      .catch((err) => {
        if (cancelled) return;
        setEtaError(
          err instanceof DirectionsApiError || err instanceof PlacesApiError
            ? "Couldn't get a route to this destination"
            : "Couldn't get a route -- check your connection"
        );
      })
      .finally(() => {
        if (!cancelled) setEtaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [destination, location, minutesFromNow]);

  // Real, honest scope limit -- this app has no scheduled/unattended-start capability, so
  // "Start" always begins the normal real route-selection flow right now, the same as picking
  // this destination any other way, regardless of which departure preset was being previewed.
  // The preset only ever changes the ETA preview above; it's never implied to delay the actual
  // start.
  const onStart = () => {
    if (!destination) return;
    navigation.navigate("Map", { planADriveDestination: destination });
  };

  const quickPicks: PlaceDetails[] = [
    ...(saved.home ? [saved.home] : []),
    ...(saved.work ? [saved.work] : []),
    ...saved.custom,
    ...history,
  ].slice(0, 6);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Plan a drive</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      {!destination ? (
        <>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={onChangeText}
              placeholder="Where are you driving to?"
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
              autoFocus
            />
            {searching && <ActivityIndicator size="small" color={colors.accent} />}
          </View>
          <FlatList
            data={query.trim() ? predictions : quickPicks}
            keyExtractor={(item: any) => item.placeId}
            ListHeaderComponent={
              !query.trim() && quickPicks.length > 0 ? <Text style={styles.sectionLabel}>Saved & recent</Text> : null
            }
            renderItem={({ item }) =>
              "primaryText" in item ? (
                <Pressable
                  style={({ pressed }) => [styles.predictionRow, pressed && { opacity: pressedOpacity }]}
                  onPress={() => onPickPrediction(item)}
                >
                  <Ionicons name="location-outline" size={18} color={colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.predictionPrimary} numberOfLines={1}>
                      {item.primaryText}
                    </Text>
                    <Text style={styles.predictionSecondary} numberOfLines={1}>
                      {item.secondaryText}
                    </Text>
                  </View>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.predictionRow, pressed && { opacity: pressedOpacity }]}
                  onPress={() => pickPlace(item)}
                >
                  <Ionicons name="time-outline" size={18} color={colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.predictionPrimary} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.predictionSecondary} numberOfLines={1}>
                      {item.address}
                    </Text>
                  </View>
                </Pressable>
              )
            }
          />
        </>
      ) : (
        <View style={styles.planCard}>
          <Pressable style={styles.destRow} onPress={() => setDestination(null)}>
            <Ionicons name="flag" size={18} color={colors.accent} />
            <Text style={styles.destText} numberOfLines={2}>
              {destination.name}
            </Text>
            <Ionicons name="pencil" size={16} color={colors.textFaint} />
          </Pressable>

          <Text style={styles.sectionLabel}>Departure time</Text>
          <View style={styles.presetRow}>
            {DEPARTURE_PRESETS.map((preset) => (
              <Pressable
                key={preset.label}
                onPress={() => setMinutesFromNow(preset.minutesFromNow)}
                style={({ pressed }) => [
                  styles.presetChip,
                  minutesFromNow === preset.minutesFromNow && styles.presetChipActive,
                  pressed && { opacity: pressedOpacity },
                ]}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    minutesFromNow === preset.minutesFromNow && styles.presetChipTextActive,
                  ]}
                >
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.etaBox}>
            {etaLoading && <ActivityIndicator color={colors.accent} />}
            {!etaLoading && etaError && <Text style={styles.etaError}>{etaError}</Text>}
            {!etaLoading && !etaError && eta && (
              <>
                <Text style={styles.etaText}>{eta.etaText}</Text>
                <Text style={styles.etaSubtext}>{eta.distanceText}</Text>
                {minutesFromNow > 0 && (
                  <Text style={styles.etaNote}>Predicted traffic for that departure time -- not a live figure yet.</Text>
                )}
              </>
            )}
          </View>

          <Pressable
            onPress={onStart}
            disabled={!eta}
            style={({ pressed }) => [styles.startButton, !eta && styles.startButtonDisabled, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={styles.startButtonText}>Start drive</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.xs },
  predictionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  predictionPrimary: { fontSize: 15, fontWeight: "700", color: colors.text },
  predictionSecondary: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  planCard: { gap: spacing.sm },
  destRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  destText: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.text },
  presetRow: { flexDirection: "row", gap: spacing.sm },
  presetChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
  },
  presetChipActive: { backgroundColor: colors.accent },
  presetChipText: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  presetChipTextActive: { color: "#FFFFFF" },
  etaBox: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    gap: 4,
  },
  etaText: { fontSize: 28, fontWeight: "800", color: colors.text },
  etaSubtext: { fontSize: 14, color: colors.textMuted },
  etaNote: { fontSize: 11, color: colors.textFaint, textAlign: "center", marginTop: spacing.xs },
  etaError: { fontSize: 13, color: colors.danger },
  startButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  startButtonDisabled: { opacity: 0.5 },
  startButtonText: { fontSize: 16, fontWeight: "800", color: "#FFFFFF" },
});
