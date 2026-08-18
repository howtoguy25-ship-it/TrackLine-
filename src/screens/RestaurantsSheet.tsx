import React, { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Image, ActivityIndicator, Keyboard } from "react-native";
import BottomSheet, { BottomSheetView, BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { searchNearbyRestaurants, PlacesApiError, type NearbyPlace } from "@/services/places";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import { setActiveSearchFocus, isActiveSearchFocus, clearActiveSearchFocusIfOwner } from "@/utils/activeSearchFocus";

const SEARCH_FOCUS_KEY = "restaurants";

interface Props {
  location: LatLng | null;
  // Real, confirmed request -- tapping a row now opens the full detail view (photos, rating,
  // hours, phone, website, reviews -- see PlaceInfoSheet) instead of routing straight there with
  // no way to actually see anything about the place first. Directions is still one tap away
  // from inside that detail sheet.
  onViewDetails: (placeId: string) => void;
  onSheetChange?: (index: number) => void;
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

function priceLevelText(level: number | undefined): string | null {
  if (level === undefined) return null;
  return "$".repeat(Math.max(1, level));
}

export const RestaurantsSheet = forwardRef<BottomSheet, Props>(function RestaurantsSheet(
  { location, onViewDetails, onSheetChange },
  ref
) {
  const insets = useSafeAreaInsets();
  // Real, confirmed complaint: 70% left the sheet covering most of the screen -- capped to a
  // shorter default (matching PlaceInfoSheet's own 50%) with a second, taller snap point so it
  // can still be dragged up to see more results instead of being stuck at one large fixed size.
  const snapPoints = useMemo(() => ["50%", "88%"], []);

  // Real, confirmed bug: @gorhom/bottom-sheet's own keyboard-avoidance snaps this sheet up to
  // its taller point while the search input is focused (so the keyboard doesn't cover it) --
  // correct while typing, but it then STAYS at that taller point after the keyboard closes,
  // since nothing else ever tells it to come back down. Re-snapping to the compact default the
  // moment the keyboard hides fixes the "stuck covering the whole screen" complaint without
  // losing the keyboard-avoidance itself.
  //
  // Real, confirmed SECOND bug this guards against now (video evidence: a scroll that was
  // progressing normally suddenly reset to the top with no matching gesture): `keyboardDidHide`
  // is a GLOBAL event, not scoped to this sheet's own input -- Restaurants/Hotels/Petrol are all
  // mounted at once (see MapScreen.tsx), so any keyboard closing for ANY reason (another sheet's
  // search box losing focus, a stray OS predictive-text blink) used to resnap ALL THREE sheets
  // back to 50%, even ones with no keyboard of their own open at all -- including one being
  // actively scrolled through at 88% at that exact moment. Gated on isActiveSearchFocus so only
  // the one sheet whose own search input most recently gained focus ever reacts -- see
  // activeSearchFocus.ts's own comment for the full mechanism.
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", () => {
      if (!isActiveSearchFocus(SEARCH_FOCUS_KEY)) return;
      clearActiveSearchFocusIfOwner(SEARCH_FOCUS_KEY);
      if (ref && typeof ref !== "function") ref.current?.snapToIndex(0);
    });
    return () => sub.remove();
  }, [ref]);

  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  // Fetched once per real location fix, not per keystroke -- the search bar below filters this
  // real result set live, letter by letter, entirely client-side (see filteredPlaces).
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  // Real, confirmed THIRD independent cause of the same "scroll recoils back to the top" bug:
  // this sheet stays mounted continuously (see MapScreen.tsx's place-sheets block) with GPS
  // updating live the whole time, so the effect below used to keep watching `location` even
  // while the sheet was open and being actively scrolled -- once the driver (or the phone's own
  // GPS jitter) crossed the 3-decimal-degree rounding boundary mid-browse, it refetched and
  // replaced `places` with a brand-new array out from under an in-progress scroll, which reads
  // exactly like a recoil even with nothing wrong in the sheet's own gesture handling at all.
  // `sheetIndex` (fed by onChange below) and `justOpened` gate a real refetch to only the moment
  // the sheet is FRESH (first ever mount) or newly reopened after being closed -- never while
  // it's already open, so a location drift mid-scroll no longer touches `places` until the next
  // deliberate open.
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
    searchNearbyRestaurants(location)
      .then((results) => {
        setPlaces(results.sort((a, b) => a.distanceMeters - b.distanceMeters));
        setFetchedFor(key);
      })
      .catch((err) => {
        setErrorText(
          err instanceof PlacesApiError
            ? `Couldn't load nearby restaurants (${err.status})`
            : "Couldn't load nearby restaurants -- check your connection"
        );
      })
      .finally(() => setLoading(false));
  }, [location, fetchedFor, sheetIndex]);

  // Live, letter-by-letter filter against the already-fetched real result set -- every
  // keystroke narrows the same list instantly, no debounce/network round-trip needed since
  // there's nothing left to fetch.
  const filteredPlaces = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return places;
    return places.filter((p) => p.name.toLowerCase().includes(q) || p.vicinity.toLowerCase().includes(q));
  }, [places, query]);

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      // Same real fix as HotelsSheet/FuelStationsSheet -- see that file's own comment: without
      // this, dragging the list rubber-banded the whole sheet (title included) past its own
      // tallest snap point instead of just scrolling the list underneath it.
      enableOverDrag={false}
      // Same real fix as HotelsSheet -- see that file's own comment: without this, a single
      // finger dragging on the list was captured by the sheet's own content-pan gesture instead
      // of the list's native scroll (only two fingers actually scrolled it). Leaves only the
      // drag handle draggable for resize/dismiss.
      enableContentPanningGesture={false}
      // Real, confirmed contributor to "scroll works fine for a few seconds then snaps back to
      // the very top": v5 of this library defaults enableDynamicSizing to true, which keeps
      // re-measuring the sheet's own content height off the mounted layout and re-syncing its
      // internal scrollable offset against that measurement -- fighting a nested
      // BottomSheetFlatList whose own content height changes constantly as rows mount/unmount
      // via windowing while scrolling. Explicit snapPoints below already define this sheet's
      // real sizing; disabling dynamic sizing stops it from fighting the list for control of the
      // scroll offset. Confirmed NOT sufficient on its own -- see the keyboardDidHide fix above
      // and the sheet-open-gated fetch below for the two other real, independent causes of the
      // exact same symptom found after this alone didn't resolve it.
      enableDynamicSizing={false}
      // Real, confirmed complaint: at the taller 88% snap point the header ("Restaurants
      // nearby") could render up under the status bar/notch with no margin. topInset keeps the
      // sheet's own maximum extent below the real safe-area top on every device instead of a
      // guessed fixed pixel value.
      topInset={insets.top}
      onChange={(index) => {
        setSheetIndex(index);
        onSheetChange?.(index);
      }}
    >
      <BottomSheetView style={styles.content}>
        {/* Real, confirmed complaint: tapping blank space in the header (the title, the notice
            area) left the keyboard sitting up with no way to dismiss it -- this Pressable
            catches those taps and blurs the keyboard. Deliberately does NOT wrap the
            BottomSheetFlatList below anymore -- real, confirmed bug (screenshot evidence: the
            list needed two fingers to scroll): a plain RN Pressable's own touch responder,
            nested around the list's real-native-gesture-handler-based scroll, was winning the
            very first touch instead of ceding it to the list, so an ordinary single-finger drag
            never reached the FlatList's own scroll gesture at all -- only a second, simultaneous
            touch point did. The list already has its own "tap a row" Pressables and
            keyboardShouldPersistTaps/on-drag dismiss handling, so it never needed this wrapper's
            help to begin with. */}
        <Pressable style={styles.pressableFill} onPress={() => Keyboard.dismiss()}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Restaurants nearby</Text>
          {/* Real, confirmed complaint: no explicit close affordance -- only drag-to-dismiss,
              which isn't obvious, especially once the sheet is scrolled up under the status bar.
              Same imperative .close() the "X" everywhere else in this file already uses. */}
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
            placeholder="Search restaurants, cafes, dessert…"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            onFocus={() => setActiveSearchFocus(SEARCH_FOCUS_KEY)}
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
            <Text style={styles.centerText}>Finding what's nearby…</Text>
          </View>
        )}
        {errorText && !loading && (
          <View style={styles.centerRow}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={[styles.centerText, { color: colors.danger }]}>{errorText}</Text>
          </View>
        )}
        {!loading && !errorText && filteredPlaces.length === 0 && (
          <View style={styles.centerRow}>
            <Text style={styles.centerText}>
              {places.length === 0 ? "Nothing found nearby yet." : "No matches for that search."}
            </Text>
          </View>
        )}
        </Pressable>

        <BottomSheetFlatList
          data={filteredPlaces}
          keyExtractor={(item) => item.placeId}
          style={styles.listFlex}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Real, explicit request -- Android-specific nested-scroll fix for a list living
          // inside the sheet's own gesture-handler view hierarchy.
          nestedScrollEnabled
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
              onPress={() => onViewDetails(item.placeId)}
            >
              {item.photoUrl ? (
                <Image source={{ uri: item.photoUrl }} style={styles.photo} />
              ) : (
                <View style={[styles.photo, styles.photoFallback]}>
                  <Ionicons name="restaurant-outline" size={22} color={colors.textFaint} />
                </View>
              )}
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
                      <Text style={styles.metaChipText}>
                        {item.rating.toFixed(1)}
                        {item.userRatingsTotal ? ` (${item.userRatingsTotal})` : ""}
                      </Text>
                    </View>
                  )}
                  {priceLevelText(item.priceLevel) && (
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>{priceLevelText(item.priceLevel)}</Text>
                    </View>
                  )}
                  {item.openNow !== undefined && (
                    <View style={styles.metaChip}>
                      <View style={[styles.openDot, { backgroundColor: item.openNow ? "#22C55E" : colors.textFaint }]} />
                      <Text style={styles.metaChipText}>{item.openNow ? "Open" : "Closed"}</Text>
                    </View>
                  )}
                  <Text style={styles.distanceText}>{formatDistance(item.distanceMeters)}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          )}
        />
      </BottomSheetView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.lg },
  // No longer flex:1 -- this now wraps only the static header (title/search/notices), not the
  // list, so it should size to its own natural content height and leave the list (its own
  // flex:1 sibling, see listFlex) to fill the rest of the sheet.
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
  listContent: { paddingBottom: spacing.xxl, gap: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  photo: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  photoFallback: { alignItems: "center", justifyContent: "center" },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  vicinity: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4, flexWrap: "wrap" },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaChipText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  openDot: { width: 6, height: 6, borderRadius: 3 },
  distanceText: { fontSize: 12, color: colors.textFaint, marginLeft: "auto" },
});
