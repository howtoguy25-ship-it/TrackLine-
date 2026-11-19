import React, { useEffect, useState } from "react";
import { FlatList, Keyboard, StyleSheet, useWindowDimensions } from "react-native";
import { Pressable, View } from "@/components/ui/Surface";
import { SurfaceScheme } from "@/components/ui/surfaceScheme";
import { DriveTile } from "@/components/ui/DriveTile";
import type { IconName } from "@/components/ui/Icon";
import { DRIVE_TILE } from "@/theme/colors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ALONG_CATEGORIES, detourText, searchAlongRoute, type AlongCategory, type AlongResult } from "@/places/alongRoute";
import { placesErrorText } from "@/services/routingErrors";
import { formatDistance } from "@/utils/navFormat";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, spacing } from "@/theme/tokens";

// Search along route, while driving (the round Search button on the bottom bar): Fuel, Food,
// Parking, Coffee, EV or a typed search, for places on the road still ahead, sorted by the extra
// time a stop adds, each with "+3 min" and Add stop. It is only mounted while open, so once closed
// nothing of it is left over the map catching touches (the old in-drive search replaced the
// whole driving UI, and its only way out was a small grey ⓧ, so it felt stuck).
// Looks like the rest of the driving UI: a dark sheet, the categories as big round coloured
// tiles, and each result with its category disc, the extra time in bold and the distance.

const CATEGORY_ICON: Record<AlongCategory, IconName> = {
  fuel: "gas-station",
  food: "restaurant",
  parking: "parking",
  coffee: "coffee",
  ev: "flash",
};

interface Props {
  route: LatLng[];
  origin: LatLng | null;
  remainingSeconds: number;
  unit: "km" | "miles";
  onAddStop: (r: AlongResult) => void;
  onClose: () => void;
}

type State = { status: "loading" } | { status: "ok"; results: AlongResult[] } | { status: "error"; message: string };

export function SearchAlongRouteSheet({ route, origin, remainingSeconds, unit, onAddStop, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [category, setCategory] = useState<AlongCategory | null>("fuel");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const q = query.trim();
  const cat = ALONG_CATEGORIES.find((c) => c.key === category) ?? null;
  const ask = q.length >= 2 ? { query: q, type: undefined } : cat ? { query: cat.query, type: cat.type } : null;
  const key = ask ? `${ask.query}|${ask.type ?? ""}|${retry}` : "";

  useEffect(() => {
    if (!ask || !origin || route.length < 2) return;
    let cancelled = false;
    const t = setTimeout(
      () => {
        setState({ status: "loading" });
        searchAlongRoute({ query: ask.query, type: ask.type, route, origin, remainingSeconds })
          .then((results) => !cancelled && setState({ status: "ok", results }))
          .catch((err) => !cancelled && setState({ status: "error", message: placesErrorText("places along your route", err) }));
      },
      q.length >= 2 ? 400 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on what's being searched
  }, [key]);

  return (
    <SurfaceScheme value="dark">
    <View style={[styles.sheet, { height: height * 0.62, paddingBottom: insets.bottom + spacing.sm }]} testID="search-along-route">
      <View style={styles.grabber} />
      <View style={styles.header}>
        <View style={styles.searchRow}>
          <Icon name="search" size={20} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search along your route"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            accessibilityLabel="Search along your route"
            testID="search-along-input"
          />
        </View>
        <Button variant="secondary" label="Back" onPress={onClose} accessibilityLabel="Close search and go back to navigation" testID="search-along-close" />
      </View>
      <View style={styles.tiles}>
        {ALONG_CATEGORIES.map((c) => (
          <DriveTile
            key={c.key}
            kind={c.key}
            icon={CATEGORY_ICON[c.key]}
            label={c.label}
            selected={category === c.key && q.length < 2}
            onPress={() => {
              setQuery("");
              setCategory(c.key);
            }}
            testID={`search-along-${c.key}`}
          />
        ))}
      </View>
      {!origin ? (
        <Text style={styles.note}>Waiting for your location.</Text>
      ) : state.status === "loading" ? (
        <View testID="search-along-loading">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeleton} />
          ))}
        </View>
      ) : state.status === "error" ? (
        <Pressable onPress={() => setRetry((r) => r + 1)} accessibilityRole="button" testID="search-along-error">
          <Text style={styles.error}>{state.message}</Text>
        </Pressable>
      ) : state.results.length === 0 ? (
        <Text style={styles.note}>Nothing found along your route. Try another search.</Text>
      ) : (
        <FlatList
          data={state.results}
          keyExtractor={(r) => r.placeId}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => {
            const disc = DRIVE_TILE[q.length < 2 && category ? category : "addStop"];
            const extra = detourText(item.detourSeconds);
            return (
              <View style={styles.row} testID={`search-along-row-${item.placeId}`}>
                <View style={[styles.disc, { backgroundColor: disc.fill }]}>
                  <Icon name={q.length < 2 && category ? CATEGORY_ICON[category] : "location"} size={18} color={disc.glyph} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.address} numberOfLines={1}>
                    {item.address}
                  </Text>
                </View>
                <View style={styles.right}>
                  {extra ? <Text style={styles.detour}>{extra}</Text> : null}
                  <Text style={styles.address}>{formatDistance(item.distanceMeters, unit)}</Text>
                </View>
                <Button variant="primary" label="Add stop" onPress={() => onAddStop(item)} accessibilityLabel={`Add ${item.name} as a stop`} testID={`search-along-add-${item.placeId}`} />
              </View>
            );
          }}
        />
      )}
    </View>
    </SurfaceScheme>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  flex: { flex: 1 },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.surfaceMuted, marginBottom: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  searchRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, paddingHorizontal: spacing.md, minHeight: 48 },
  tiles: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm },
  disc: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  right: { alignItems: "flex-end", minWidth: 56 },
  input: { flex: 1, fontSize: 16, color: colors.text },
  note: { fontSize: 15, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: "center" },
  error: { fontSize: 15, color: colors.danger, paddingVertical: spacing.lg, textAlign: "center" },
  skeleton: { height: 60, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, marginBottom: spacing.sm },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68 },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  address: { fontSize: 13, color: colors.textMuted },
  detour: { fontSize: 15, fontWeight: "800", color: colors.text },
});
