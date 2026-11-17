import React, { forwardRef, useEffect, useMemo, useState } from "react";
import { FlatList, Image, Keyboard, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "@/components/AppText";
import { Button, Chip } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { SimpleBottomSheet, type SimpleBottomSheetRef } from "@/components/SimpleBottomSheet";
import { useSettings } from "@/context/SettingsContext";
import { useLatest } from "@/hooks/useLatest";
import { placesErrorText } from "@/services/routingErrors";
import {
  AREAS,
  FUEL_TYPES,
  SORTS,
  arrangeResults,
  formatFuelPrice,
  photoUrl,
  searchNearbyNew,
  searchTextNew,
  updatedAgo,
  type AreaKey,
  type FuelPrice,
  type FuelTypeKey,
  type NearbyCategory,
  type NearbyResult,
  type SortKey,
} from "@/places/nearbyNew";
import { fetchFuelCheck, pricesFor } from "@/places/fuelPrices";
import { driveTimesTo } from "@/places/driveTimes";
import { priceLevelText } from "@/services/places";
import { formatDistance, formatDurationText } from "@/utils/navFormat";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";
import { setActiveSearchFocus, isActiveSearchFocus, clearActiveSearchFocusIfOwner } from "@/utils/activeSearchFocus";

// Petrol, food, hotels and parking near you, Waze-style: Google Places (New) results sorted by
// distance with real drive times, filters (area, sort, open now, top rated), and for petrol the
// live price of your fuel type (NSW FuelCheck, or Google's own station prices elsewhere). Each
// result is reported to the map as a pin with its brand or price, and the map zooms out to fit
// them. While loading: skeleton rows, never a spinner that runs forever (requests give up after
// 10 s and say why).

export interface NearbyPin {
  id: string;
  lat: number;
  lng: number;
  name: string;
  /** Under the pin: the price ("$1.89") for petrol, else the brand / name. */
  label: string;
  onPress: () => void;
}

const META: Record<NearbyCategory, { title: string; icon: IconName; noun: string; placeholder: string }> = {
  fuel: { title: "Petrol stations", icon: "gas-station", noun: "petrol stations", placeholder: "Search petrol stations" },
  food: { title: "Food and drink", icon: "restaurant", noun: "places to eat", placeholder: "Search food" },
  hotel: { title: "Hotels", icon: "bed", noun: "hotels", placeholder: "Search hotels" },
  parking: { title: "Parking", icon: "parking", noun: "car parks", placeholder: "Search parking" },
};

export const ROW_HEIGHT = 72;

interface Props {
  category: NearbyCategory;
  location: LatLng | null;
  onViewDetails: (placeId: string) => void;
  onSheetChange?: (index: number) => void;
  onPinsChange?: (pins: NearbyPin[]) => void;
  /** Parking: open the OpenStreetMap list with free / covered / accessible / EV filters. */
  onMoreFilters?: () => void;
}

type LoadState = { status: "loading" } | { status: "ok" } | { status: "error"; message: string };

export const NearbyPlacesSheet = forwardRef<SimpleBottomSheetRef, Props>(function NearbyPlacesSheet(
  { category, location, onViewDetails, onSheetChange, onPinsChange, onMoreFilters },
  ref
) {
  const insets = useSafeAreaInsets();
  const meta = META[category];
  const focusKey = `nearby-${category}`;
  const { settings, updateSettings } = useSettings();
  const fuelType: FuelTypeKey = settings.preferredFuelType ?? "91";

  const [area, setArea] = useState<AreaKey>("near");
  const [sort, setSort] = useState<SortKey>(category === "fuel" ? "price" : "distance");
  const [openNow, setOpenNow] = useState(false);
  const [topRated, setTopRated] = useState(false);
  const [query, setQuery] = useState("");
  const [sheetIndex, setSheetIndex] = useState(-1);
  const [retryTick, setRetryTick] = useState(0);

  const [results, setResults] = useState<NearbyResult[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [times, setTimes] = useState<Record<string, number | null>>({});
  const [prices, setPrices] = useState<Map<string, FuelPrice>>(new Map());
  const [priceNote, setPriceNote] = useState<string | null>(null);

  const radiusM = AREAS.find((a) => a.key === area)?.radiusM ?? 2000;
  const isOpen = sheetIndex >= 0;
  // Asked again only for a new area / fuel type / search / retry, or ~1 km of movement; not on
  // every GPS fix (which used to replace the list mid-scroll).
  const anchor = location ? `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}` : null;
  const q = query.trim();
  const locationRef = useLatest(location);

  // Keyboard hides → back to the shorter sheet (only for the sheet that owns the search box).
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", () => {
      if (!isActiveSearchFocus(focusKey)) return;
      clearActiveSearchFocusIfOwner(focusKey);
      if (ref && typeof ref !== "function") ref.current?.snapToIndex(0);
    });
    return () => sub.remove();
  }, [ref, focusKey]);

  // Results: Nearby Search, or Text Search for 2+ typed characters (debounced).
  useEffect(() => {
    const here = locationRef.current;
    if (!isOpen || !anchor || !here) return;
    let cancelled = false;
    const run = () => {
      setLoad({ status: "loading" });
      const ask =
        q.length >= 2
          ? searchTextNew(q, category, here, radiusM, category === "fuel" ? fuelType : undefined)
          : searchNearbyNew(category, here, radiusM, { fuelType: category === "fuel" ? fuelType : undefined, popular: sort === "best" });
      ask
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setLoad({ status: "ok" });
          // Drive times for the whole list in one request.
          driveTimesTo(here, r.map((x) => x.location))
            .then((t) => !cancelled && setTimes(Object.fromEntries(r.map((x, i) => [x.placeId, t[i] ?? null]))))
            .catch(() => {});
          if (category === "fuel" && fuelType !== "ev") {
            fetchFuelCheck(here, fuelType, Math.max(1, Math.round(radiusM / 1000)))
              .then((fc) => {
                if (cancelled) return;
                setPrices(pricesFor(r, fuelType, fc.stations));
                setPriceNote(!fc.configured ? "Live NSW prices aren't set up yet." : fc.error ? `Live prices: ${fc.error}` : null);
              })
              .catch((err) => {
                if (cancelled) return;
                setPrices(pricesFor(r, fuelType, []));
                setPriceNote(`Live prices unavailable: ${err instanceof Error ? err.message : "no answer"}`);
              });
          } else {
            setPrices(new Map());
            setPriceNote(null);
          }
        })
        .catch((err) => !cancelled && setLoad({ status: "error", message: placesErrorText(meta.noun, err) }));
    };
    const t = setTimeout(run, q.length >= 2 ? 400 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request's inputs; location read from the ref
  }, [isOpen, anchor, category, radiusM, fuelType, q, sort === "best", retryTick]);

  const shown = useMemo(
    () => arrangeResults(results, { sort, openNow, topRated, priceOf: category === "fuel" ? (r) => prices.get(r.placeId)?.centsPerLitre ?? null : undefined }),
    [results, sort, openNow, topRated, prices, category]
  );

  // Pins for the map (every result in the list as shown), with the price or brand under each.
  const onPinsChangeRef = useLatest(onPinsChange);
  const onViewDetailsRef = useLatest(onViewDetails);
  useEffect(() => {
    onPinsChangeRef.current?.(
      isOpen
        ? shown.map((r) => {
            const p = prices.get(r.placeId);
            return {
              id: r.placeId,
              lat: r.location.latitude,
              lng: r.location.longitude,
              name: r.name,
              label: p ? formatFuelPrice(p.centsPerLitre) : shortName(r.name),
              onPress: () => onViewDetailsRef.current(r.placeId),
            };
          })
        : []
    );
  }, [shown, prices, isOpen, onPinsChangeRef, onViewDetailsRef]);
  useEffect(() => {
    const latest = onPinsChangeRef;
    return () => latest.current?.([]);
  }, [onPinsChangeRef]);

  const close = () => {
    Keyboard.dismiss();
    if (ref && typeof ref !== "function") ref.current?.close();
  };
  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? "Best match";
  const nextSort = () => setSort((s) => SORTS[(SORTS.findIndex((x) => x.key === s) + 1) % SORTS.length].key);

  return (
    <SimpleBottomSheet
      ref={ref}
      snapFractions={[0.5, 0.9]}
      topInset={insets.top}
      onChange={(index) => {
        setSheetIndex(index);
        onSheetChange?.(index);
      }}
    >
      <View style={styles.content} testID={`nearby-${category}`}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header">
            {meta.title}
          </Text>
          <Button variant="ghost" icon="close" iconColor={colors.textMuted} onPress={close} accessibilityLabel="Close" />
        </View>
        <View style={styles.searchRow}>
          <Icon name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={meta.placeholder}
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            onFocus={() => {
              setActiveSearchFocus(focusKey);
              if (ref && typeof ref !== "function") ref.current?.snapToIndex(1);
            }}
            accessibilityLabel={meta.placeholder}
            testID="nearby-search"
          />
          {query ? <Button variant="ghost" icon="close-circle" iconColor={colors.textFaint} onPress={() => setQuery("")} accessibilityLabel="Clear search" /> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {AREAS.map((a) => (
            <Chip key={a.key} label={a.label} selected={area === a.key} onPress={() => setArea(a.key)} testID={`nearby-area-${a.key}`} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          <Chip label={`Sort: ${sortLabel}`} trailingIcon="chevron-down" onPress={nextSort} accessibilityLabel={`Sorted by ${sortLabel}. Change sort`} testID="nearby-sort" />
          <Chip label="Open now" selected={openNow} onPress={() => setOpenNow((v) => !v)} testID="nearby-open-now" />
          <Chip label="Top rated" selected={topRated} onPress={() => setTopRated((v) => !v)} testID="nearby-top-rated" />
          {onMoreFilters ? <Chip label="More filters" icon="options" onPress={onMoreFilters} accessibilityLabel="More filters: free, covered, accessible, EV charging" testID="nearby-more-filters" /> : null}
        </ScrollView>
        {category === "fuel" ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {FUEL_TYPES.map((f) => (
              <Chip key={f.key} label={f.label} selected={fuelType === f.key} onPress={() => updateSettings({ preferredFuelType: f.key })} testID={`nearby-fuel-${f.key}`} />
            ))}
          </ScrollView>
        ) : null}
        {priceNote ? <Text style={styles.note}>{priceNote}</Text> : null}

        {!location ? (
          <Text style={styles.empty}>Waiting for your location to find {meta.noun} near you.</Text>
        ) : load.status === "loading" ? (
          <View testID="nearby-skeleton">
            {Array.from({ length: 6 }, (_, i) => (
              <View key={i} style={styles.skeletonRow}>
                <View style={[styles.thumb, styles.skeleton]} />
                <View style={styles.flex}>
                  <View style={[styles.skeleton, styles.skeletonLine, { width: "60%" }]} />
                  <View style={[styles.skeleton, styles.skeletonLine, { width: "85%", marginTop: 8 }]} />
                </View>
              </View>
            ))}
          </View>
        ) : load.status === "error" ? (
          <Pressable onPress={() => setRetryTick((t) => t + 1)} accessibilityRole="button" testID="nearby-error">
            <Text style={styles.error}>{load.message}</Text>
          </Pressable>
        ) : shown.length === 0 ? (
          <Text style={styles.empty} testID="nearby-empty">
            {emptyReason(meta.noun, results.length, { openNow, topRated, q, areaLabel: AREAS.find((a) => a.key === area)?.label ?? "" })}
          </Text>
        ) : (
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={shown}
            keyExtractor={(r) => r.placeId}
            style={styles.flex}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            nestedScrollEnabled
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => (
              <ResultRow
                r={item}
                icon={meta.icon}
                driveSeconds={times[item.placeId] ?? null}
                price={category === "fuel" ? prices.get(item.placeId) ?? null : null}
                unit={settings.distanceUnit}
                onPress={() => onViewDetails(item.placeId)}
              />
            )}
          />
        )}
      </View>
    </SimpleBottomSheet>
  );
});

function shortName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}

export function emptyReason(noun: string, fetched: number, f: { openNow: boolean; topRated: boolean; q: string; areaLabel: string }): string {
  if (fetched === 0) return f.q ? `No ${noun} match “${f.q}” here. Try a wider area.` : `No ${noun} found (${f.areaLabel.toLowerCase()}). Try a wider area.`;
  const why = [f.openNow && "open now", f.topRated && "rated 4.3 or more"].filter(Boolean).join(" and ");
  return `None of the ${fetched} ${noun} found are ${why}. Turn a filter off to see them.`;
}

function ResultRow({
  r,
  icon,
  driveSeconds,
  price,
  unit,
  onPress,
}: {
  r: NearbyResult;
  icon: IconName;
  driveSeconds: number | null;
  price: FuelPrice | null;
  unit: "km" | "miles";
  onPress: () => void;
}) {
  const level = r.priceLevel != null ? priceLevelText(r.priceLevel) : null;
  const where = [r.address, r.suburb && !r.address.includes(r.suburb) ? r.suburb : null].filter(Boolean).join(", ");
  const label = [
    r.name,
    where,
    r.openNow === true ? "Open" : r.openNow === false ? "Closed" : null,
    r.rating != null ? `rated ${r.rating.toFixed(1)}` : null,
    price ? `${formatFuelPrice(price.centsPerLitre)} a litre` : null,
    formatDistance(r.distanceMeters, unit),
    driveSeconds != null ? `${formatDurationText(driveSeconds)} drive` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]} accessibilityRole="button" accessibilityLabel={label} testID={`nearby-row-${r.placeId}`}>
      {r.photoName ? (
        <Image source={{ uri: photoUrl(r.photoName) }} style={styles.thumb} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, styles.iconThumb]}>
          <Icon name={icon} size={22} color={colors.accent} />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>
          {r.name}
        </Text>
        <Text style={styles.address} numberOfLines={1}>
          {where}
        </Text>
        <View style={styles.metaRow}>
          {r.openNow != null ? <Text style={[styles.meta, { color: r.openNow ? colors.goodText : colors.danger }]}>{r.openNow ? "Open" : "Closed"}</Text> : null}
          {r.rating != null ? (
            <Text style={styles.meta}>
              ★ {r.rating.toFixed(1)}
              {r.ratingCount ? ` (${r.ratingCount})` : ""}
            </Text>
          ) : null}
          {level ? <Text style={styles.meta}>{level}</Text> : null}
        </View>
      </View>
      <View style={styles.right}>
        {price ? (
          <>
            <Text style={styles.price}>{formatFuelPrice(price.centsPerLitre)}</Text>
            {updatedAgo(price.updatedMs) ? <Text style={styles.small}>{updatedAgo(price.updatedMs)}</Text> : null}
          </>
        ) : null}
        <Text style={styles.distance}>{formatDistance(r.distanceMeters, unit)}</Text>
        {driveSeconds != null ? <Text style={styles.small}>{formatDurationText(driveSeconds)}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.lg },
  flex: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44, marginBottom: spacing.sm },
  searchInput: { flex: 1, fontSize: 16, color: colors.text },
  chips: { flexDirection: "row", gap: spacing.sm, paddingBottom: spacing.sm },
  note: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.xs },
  empty: { fontSize: 15, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: "center" },
  error: { fontSize: 15, color: colors.danger, paddingVertical: spacing.lg, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: ROW_HEIGHT, paddingVertical: spacing.sm },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 60 },
  thumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  iconThumb: { alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  address: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  metaRow: { flexDirection: "row", gap: spacing.sm, marginTop: 2 },
  meta: { fontSize: 13, color: colors.textMuted, fontWeight: "600" },
  right: { alignItems: "flex-end", minWidth: 64 },
  price: { fontSize: 20, fontWeight: "800", color: colors.text },
  distance: { fontSize: 14, fontWeight: "700", color: colors.text },
  small: { fontSize: 12, color: colors.textMuted },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, height: ROW_HEIGHT },
  skeleton: { backgroundColor: colors.surfaceMuted },
  skeletonLine: { height: 12, borderRadius: 6 },
});
