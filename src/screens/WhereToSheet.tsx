import React, { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { SharedValue } from "react-native-reanimated";
import {
  View,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  Alert,
  Modal,
  Share,
} from "react-native";
import { Text, TextInput } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ThreeSnapBottomSheet, type ThreeSnapBottomSheetRef } from "@/components/ThreeSnapBottomSheet";
import { AddressKeypadAccessory, ADDRESS_KEYPAD_ACCESSORY_ID } from "@/components/AddressKeypadAccessory";
import {
  searchPlaces,
  getPlaceDetails,
  PlacesApiError,
  type PlacePrediction,
  type PlaceDetails,
} from "@/services/places";
import { getSearchHistory, addSearchHistoryEntry } from "@/services/searchHistory";
import {
  getSavedPlaces,
  setHomeOrWork,
  removeHomeOrWork,
  addCustomPlace,
  removeCustomPlace,
  pushSavedPlacesToProfile,
  pullSavedPlacesFromProfile,
  type SavedPlaces,
  type SavedPlaceSlot,
} from "@/services/savedPlaces";
import { useAuth } from "@/context/AuthContext";
import { driveShareMessage } from "@/services/driveLink";
import { useSettings } from "@/context/SettingsContext";
import { startVoiceSearch, VOICE_SEARCH_MESSAGES, type VoiceSearchSession } from "@/services/voiceSearch";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";
import {
  getContactsPermissionStatus,
  requestContactsAccess,
  getContactsWithAddresses,
  type ContactWithAddress,
} from "@/services/contactAddresses";

// Real, explicit request (Waze-style redesign, Phase 2 -- "Bottom Search Sheet 'Where to?'").
// Replaces the old always-floating-at-the-top DestinationSearchBar as the home screen's main
// idle entry point with a real, draggable 3-snap-point sheet (peek/half/full -- see
// ThreeSnapBottomSheet.tsx). Home/Work/+New chips and the Saved/Fuel/Food/Parking category row
// are real and functional (search autocomplete, Firestore-synced saved places, live OSM nearby
// lists via the existing Fuel/Restaurants/Hotels/Parking sheets). The microphone is real voice
// search (services/voiceSearch.ts): tap it, say a place, and the words fill the search box and
// run the same search typing would.

function formatPredictionDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

function predictionIconFor(types: string[] | undefined): { name: keyof typeof Ionicons.glyphMap; bg: string } {
  const t = new Set(types ?? []);
  if (t.has("train_station") || t.has("transit_station") || t.has("subway_station") || t.has("light_rail_station")) {
    return { name: "train", bg: "#1D4ED8" };
  }
  if (t.has("bus_station")) return { name: "bus", bg: "#1D4ED8" };
  if (t.has("airport")) return { name: "airplane", bg: "#1D4ED8" };
  if (t.has("lodging")) return { name: "bed", bg: "#7C3AED" };
  if (t.has("restaurant") || t.has("cafe") || t.has("food")) return { name: "restaurant", bg: "#EA580C" };
  if (t.has("park")) return { name: "leaf", bg: "#16A34A" };
  return { name: "location", bg: "#DC2626" };
}

export type WhereToCategory = "saved" | "fuel" | "food" | "parking";

interface Props {
  biasLocation?: LatLng;
  onDestinationSelected: (place: PlaceDetails) => void;
  onFindNearestStation?: () => void;
  findingNearestStation?: boolean;
  onFindRestaurants: () => void;
  onFindHotels: () => void;
  onFindPetrol: () => void;
  onFindParking: () => void;
  onSheetChange?: (index: 0 | 1 | 2) => void;
  /** Height of whatever sits under the sheet (the ad banner); the sheet rests on top of it. */
  bottomInset?: number;
  /** Receives how much of the sheet is showing, every frame -- see ThreeSnapBottomSheet. */
  visibleHeight?: SharedValue<number>;
}

// Peek / half / full, as fractions of the space between the status bar and whatever is under
// the sheet. Exported because the map lays itself out around the sheet from these same numbers.
export const WHERE_TO_SNAP_FRACTIONS: [number, number, number] = [0.24, 0.55, 0.92];

// What the main search input is currently FOR -- "route" (the default: picking a destination to
// drive to) or assigning one of the real saved-place slots. Picking a result branches on this
// instead of the search UI itself ever duplicating.
// "share" is the More options row "Share drive": pick a place, and instead of routing there
// the phone's share sheet opens with a link to it (services/driveLink.ts).
type PickTarget = "route" | SavedPlaceSlot | "custom" | "share";

export const WhereToSheet = forwardRef<ThreeSnapBottomSheetRef, Props>(function WhereToSheet(
  {
    biasLocation,
    onDestinationSelected,
    onFindNearestStation,
    findingNearestStation,
    bottomInset,
    visibleHeight,
    onFindRestaurants,
    onFindHotels,
    onFindPetrol,
    onFindParking,
    onSheetChange,
  },
  ref
) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const snapFractions = WHERE_TO_SNAP_FRACTIONS;

  const [query, setQuery] = useState("");
  const [pickTarget, setPickTarget] = useState<PickTarget>("route");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [history, setHistory] = useState<PlaceDetails[]>([]);
  const [saved, setSaved] = useState<SavedPlaces>({ home: null, work: null, custom: [] });
  const [activeCategory, setActiveCategory] = useState<WhereToCategory | null>(null);
  const [micNote, setMicNote] = useState<string | null>(null);
  const { navLanguage } = useSettings();
  const [addressInputFocused, setAddressInputFocused] = useState(false);
  // Real, explicit request -- "Drive to friends & family via Contacts" More options row,
  // previously honestly deferred (no expo-contacts dependency existed yet). Lazily loaded only
  // when the picker is actually opened, not on every sheet mount.
  const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
  // "+ New": the place that's been picked and is waiting for the driver to name it ("Mum's",
  // "Gym"), plus the name as typed so far. Null whenever that little dialog is closed.
  const [namingPlace, setNamingPlace] = useState<PlaceDetails | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [contactsStatus, setContactsStatus] = useState<"granted" | "denied" | "undetermined" | null>(null);
  const [contactsWithAddresses, setContactsWithAddresses] = useState<ContactWithAddress[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsQuery, setContactsQuery] = useState("");
  const [drivingToContactId, setDrivingToContactId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSearchHistory().then(setHistory);
    getSavedPlaces().then(setSaved);
  }, []);

  // Same real cross-device sync pattern as SettingsContext -- pulled once per real sign-in,
  // merged onto whatever's already stored locally rather than overwriting it.
  const pulledForUid = useRef<string | null>(null);
  useEffect(() => {
    if (!user || user.isAnonymous || pulledForUid.current === user.uid) return;
    pulledForUid.current = user.uid;
    pullSavedPlacesFromProfile(user.uid).then((remote) => {
      if (remote) setSaved(remote);
    });
  }, [user]);

  const persistSaved = useCallback(
    (next: SavedPlaces) => {
      setSaved(next);
      if (user && !user.isAnonymous) pushSavedPlacesToProfile(user.uid, next).catch(() => {});
    },
    [user]
  );

  const onChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!text.trim()) {
        setPredictions([]);
        setErrorText(null);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        setErrorText(null);
        try {
          const results = await searchPlaces(text, biasLocation);
          const sorted = [...results].sort(
            (a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)
          );
          setPredictions(sorted);
        } catch (err) {
          setPredictions([]);
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

  const resetSearch = useCallback(() => {
    setQuery("");
    setPredictions([]);
    setPickTarget("route");
    Keyboard.dismiss();
  }, []);

  const handlePicked = useCallback(
    async (place: PlaceDetails) => {
      if (pickTarget === "route") {
        setQuery(place.name);
        setPredictions([]);
        Keyboard.dismiss();
        addSearchHistoryEntry(place).then(setHistory);
        onDestinationSelected(place);
        return;
      }
      if (pickTarget === "home" || pickTarget === "work") {
        const next = await setHomeOrWork(pickTarget, place);
        persistSaved(next);
        resetSearch();
        return;
      }
      if (pickTarget === "share") {
        resetSearch();
        // Share.share rejects only if the share sheet itself couldn't be shown; dismissing it
        // without sending is a normal outcome, not an error.
        Share.share({
          message: driveShareMessage({
            latitude: place.location.latitude,
            longitude: place.location.longitude,
            name: place.name,
            address: place.address,
          }),
        }).catch(() => setErrorText("Couldn't open the share sheet"));
        return;
      }
      // "custom" -- a "+ New" saved place. The address is chosen; now ask what to call it,
      // starting from the place's own name so accepting that is a single tap.
      Keyboard.dismiss();
      setPlaceName(place.name);
      setNamingPlace(place);
    },
    [pickTarget, onDestinationSelected, persistSaved, resetSearch]
  );

  const confirmNamedPlace = useCallback(async () => {
    if (!namingPlace) return;
    const typed = placeName.replace(/\s+/g, " ").trim();
    // Left blank, or left as the place's own name: stored without a separate label, exactly as
    // before, so the list keeps showing the place's real name.
    const label = typed && typed !== namingPlace.name ? typed : undefined;
    const next = await addCustomPlace(namingPlace, label);
    persistSaved(next);
    setNamingPlace(null);
    resetSearch();
  }, [namingPlace, placeName, persistSaved, resetSearch]);

  const cancelNamingPlace = useCallback(() => {
    // Nothing is saved; the search stays as it was so a different address can be picked.
    setNamingPlace(null);
  }, []);

  const onSelectPrediction = useCallback(
    async (prediction: PlacePrediction) => {
      try {
        const details = await getPlaceDetails(prediction.placeId);
        handlePicked(details);
      } catch (err) {
        setErrorText(
          err instanceof PlacesApiError
            ? `Couldn't load that place (${err.status})`
            : "Couldn't load that place -- check your connection"
        );
      }
    },
    [handlePicked]
  );

  const beginPicking = useCallback(
    (target: PickTarget) => {
      setActiveCategory(null);
      setPickTarget(target);
      setQuery("");
      setPredictions([]);
      if (ref && typeof ref !== "function") ref.current?.expandHalf();
    },
    [ref]
  );

  const onPressHomeOrWork = useCallback(
    (slot: SavedPlaceSlot) => {
      const place = saved[slot];
      if (!place) {
        beginPicking(slot);
        return;
      }
      onDestinationSelected(place);
    },
    [saved, beginPicking, onDestinationSelected]
  );

  const onLongPressHomeOrWork = useCallback(
    (slot: SavedPlaceSlot) => {
      const place = saved[slot];
      if (!place) return;
      const label = slot === "home" ? "Home" : "Work";
      Alert.alert(label, place.address, [
        { text: "Edit address", onPress: () => beginPicking(slot) },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const next = await removeHomeOrWork(slot);
            persistSaved(next);
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [saved, beginPicking, persistSaved]
  );

  // Voice search. Tapping the microphone starts listening; tapping it again stops early. What's
  // heard goes through onChangeText -- exactly the path typed text takes -- so the results list
  // fills in as the driver speaks, and they finish by tapping a result, same as typing.
  const [listening, setListening] = useState(false);
  const voiceSessionRef = useRef<VoiceSearchSession | null>(null);
  const showMicNote = useCallback((text: string) => {
    if (micNoteTimerRef.current) clearTimeout(micNoteTimerRef.current);
    setMicNote(text);
    micNoteTimerRef.current = setTimeout(() => setMicNote(null), 5000);
  }, []);
  const onPressMic = useCallback(async () => {
    if (voiceSessionRef.current) {
      voiceSessionRef.current.stop();
      return;
    }
    if (listening) return; // still starting up -- a second tap shouldn't start a second session
    Keyboard.dismiss();
    setMicNote(null);
    setListening(true);
    if (ref && typeof ref !== "function") ref.current?.expandHalf();
    const session = await startVoiceSearch(navLanguage, {
      onPartial: onChangeText,
      onFinal: onChangeText,
      onError: (failure) => showMicNote(VOICE_SEARCH_MESSAGES[failure]),
      onEnd: () => {
        voiceSessionRef.current = null;
        setListening(false);
      },
    });
    voiceSessionRef.current = session;
    // Never got as far as listening (no permission, not available): onEnd won't be coming.
    if (!session) setListening(false);
  }, [listening, navLanguage, onChangeText, ref, showMicNote]);
  // Leaving the screen mid-sentence must let go of the microphone.
  useEffect(() => {
    return () => voiceSessionRef.current?.stop();
  }, []);

  const onOpenContactsPicker = useCallback(async () => {
    setContactsPickerOpen(true);
    const status = await getContactsPermissionStatus();
    setContactsStatus(status);
    if (status === "granted") {
      setContactsLoading(true);
      getContactsWithAddresses()
        .then(setContactsWithAddresses)
        .finally(() => setContactsLoading(false));
    }
  }, []);

  const onConnectContacts = useCallback(async () => {
    const granted = await requestContactsAccess();
    setContactsStatus(granted ? "granted" : "denied");
    if (granted) {
      setContactsLoading(true);
      getContactsWithAddresses()
        .then(setContactsWithAddresses)
        .finally(() => setContactsLoading(false));
    }
  }, []);

  const onPickContact = useCallback(
    async (contact: ContactWithAddress) => {
      setDrivingToContactId(contact.id);
      try {
        const predictions = await searchPlaces(contact.formattedAddress);
        if (predictions.length === 0) {
          Alert.alert("Couldn't find that address", `No match found for "${contact.formattedAddress}".`);
          return;
        }
        const place = await getPlaceDetails(predictions[0].placeId);
        setContactsPickerOpen(false);
        onDestinationSelected(place);
      } catch {
        Alert.alert("Couldn't look up that address", "Check your connection and try again.");
      } finally {
        setDrivingToContactId(null);
      }
    },
    [onDestinationSelected]
  );

  const filteredContacts = contactsQuery.trim()
    ? contactsWithAddresses.filter((c) => c.name.toLowerCase().includes(contactsQuery.trim().toLowerCase()))
    : contactsWithAddresses;

  const onPressCategory = useCallback(
    (category: WhereToCategory) => {
      if (category === "saved") {
        setActiveCategory((v) => (v === "saved" ? null : "saved"));
        if (ref && typeof ref !== "function") ref.current?.expandHalf();
        return;
      }
      setActiveCategory(null);
      if (category === "fuel") onFindPetrol();
      else if (category === "food") onFindRestaurants();
      else if (category === "parking") onFindParking();
    },
    [ref, onFindPetrol, onFindRestaurants, onFindParking]
  );

  const picking = pickTarget !== "route";
  const pickingLabel =
    pickTarget === "home"
      ? "Set Home address"
      : pickTarget === "work"
        ? "Set Work address"
        : pickTarget === "custom"
          ? "Add a saved place"
          : pickTarget === "share"
            ? "Share a drive to…"
            : null;
  const showPredictions = predictions.length > 0;
  const showHistory = !picking && !query.trim() && predictions.length === 0 && history.length > 0 && activeCategory === null;
  const showSavedList = activeCategory === "saved" && !picking && !query.trim();

  return (
    <>
    <ThreeSnapBottomSheet
      ref={ref}
      snapFractions={snapFractions}
      topInset={insets.top}
      onChange={onSheetChange}
      bottomInset={bottomInset}
      visibleHeight={visibleHeight}
    >
      <View style={styles.content}>
        <Pressable style={styles.pressableFill} onPress={() => Keyboard.dismiss()}>

          {picking && (
            <View style={styles.pickingBanner}>
              <Text style={styles.pickingBannerText}>{pickingLabel}</Text>
              <Pressable onPress={resetSearch} hitSlop={10} accessibilityLabel="Cancel">
                <Ionicons name="close-circle" size={20} color={colors.textFaint} />
              </Pressable>
            </View>
          )}

          <View style={styles.inputRow}>
            <View style={styles.searchIconWrap}>
              <Ionicons name="search" size={18} color={colors.accent} />
            </View>
            <TextInput
              value={query}
              onChangeText={onChangeText}
              onFocus={() => {
                if (ref && typeof ref !== "function") ref.current?.expandHalf();
                setAddressInputFocused(true);
              }}
              onBlur={() => setAddressInputFocused(false)}
              placeholder={picking ? "Search address…" : "Where to?"}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              inputAccessoryViewID={ADDRESS_KEYPAD_ACCESSORY_ID}
            />
            {loading && <ActivityIndicator size="small" color={colors.accent} />}
            {!picking && (
              <Pressable
                onPress={onPressMic}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={listening ? "Stop listening" : "Search by voice"}
                accessibilityState={{ selected: listening }}
              >
                <Ionicons
                  name={listening ? "mic" : "mic-outline"}
                  size={20}
                  color={listening ? colors.danger : colors.textMuted}
                />
              </Pressable>
            )}
          </View>
          {listening && <Text style={[styles.micNote, { color: colors.danger }]}>Listening… say where you want to go</Text>}
          {!!micNote && !listening && <Text style={styles.micNote}>{micNote}</Text>}
          <AddressKeypadAccessory
            visible={addressInputFocused}
            onKeyPress={(char) => onChangeText(query + char)}
          />

          {!picking && (
            <>
              <View style={styles.chipsRow}>
                <Pressable
                  style={({ pressed }) => [styles.slotChip, pressed && { opacity: pressedOpacity }]}
                  onPress={() => onPressHomeOrWork("home")}
                  onLongPress={() => onLongPressHomeOrWork("home")}
                >
                  <Ionicons name="home" size={15} color={colors.accent} />
                  <Text style={styles.slotChipText}>Home</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.slotChip, pressed && { opacity: pressedOpacity }]}
                  onPress={() => onPressHomeOrWork("work")}
                  onLongPress={() => onLongPressHomeOrWork("work")}
                >
                  <Ionicons name="briefcase" size={15} color={colors.accent} />
                  <Text style={styles.slotChipText}>Work</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.slotChip, pressed && { opacity: pressedOpacity }]}
                  onPress={() => beginPicking("custom")}
                >
                  <Ionicons name="add" size={15} color={colors.accent} />
                  <Text style={styles.slotChipText}>New</Text>
                </Pressable>
              </View>

              <View style={styles.chipsRow}>
                <CategoryChip
                  icon="bookmark"
                  label="Saved"
                  active={activeCategory === "saved"}
                  onPress={() => onPressCategory("saved")}
                />
                <CategoryChip icon="car" label="Fuel" onPress={() => onPressCategory("fuel")} />
                <CategoryChip icon="restaurant" label="Food" onPress={() => onPressCategory("food")} />
                <CategoryChip icon="square-outline" label="Parking" onPress={() => onPressCategory("parking")} />
              </View>

              {onFindNearestStation && !query.trim() && activeCategory === null && (
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

              {!query.trim() && activeCategory === null && (
                <Pressable
                  style={({ pressed }) => [styles.quickAction, pressed && styles.rowPressed]}
                  onPress={onOpenContactsPicker}
                >
                  <Ionicons name="people-outline" size={18} color={colors.accent} />
                  <Text style={styles.quickActionText}>Drive to friends & family</Text>
                </Pressable>
              )}

              {!query.trim() && activeCategory === null && (
                <Pressable
                  style={({ pressed }) => [styles.quickAction, pressed && styles.rowPressed]}
                  onPress={() => {
                    setPickTarget("share");
                    if (ref && typeof ref !== "function") ref.current?.expandHalf();
                  }}
                >
                  <Ionicons name="share-outline" size={18} color={colors.accent} />
                  <Text style={styles.quickActionText}>Share drive</Text>
                </Pressable>
              )}
            </>
          )}

          {!!errorText && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{errorText}</Text>
            </View>
          )}
        </Pressable>

        {showPredictions && (
          <FlatList
            data={predictions}
            keyExtractor={(item) => item.placeId}
            style={styles.listFlex}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
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

        {showSavedList && (
          <FlatList
            data={saved.custom}
            keyExtractor={(item) => item.placeId}
            style={styles.listFlex}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No saved places yet -- tap &quot;New&quot; above to add one.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Pressable style={styles.historyRowMain} onPress={() => onDestinationSelected(item)}>
                  <Ionicons name="bookmark" size={16} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.primaryText} numberOfLines={1}>
                      {item.label ?? item.name}
                    </Text>
                    <Text style={styles.secondaryText} numberOfLines={1}>
                      {item.address}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const next = await removeCustomPlace(item.placeId);
                    persistSaved(next);
                  }}
                  hitSlop={10}
                  style={styles.historyRemoveButton}
                  accessibilityLabel={`Remove ${item.name}`}
                >
                  <Ionicons name="close" size={16} color={colors.textFaint} />
                </Pressable>
              </View>
            )}
          />
        )}

        {showHistory && (
          <FlatList
            data={history}
            keyExtractor={(item) => item.placeId}
            style={styles.listFlex}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            ListHeaderComponent={<Text style={styles.historyHeaderText}>Recent searches</Text>}
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => onDestinationSelected(item)}>
                <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.primaryText} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {!!item.address && (
                    <Text style={styles.secondaryText} numberOfLines={1}>
                      {item.address}
                    </Text>
                  )}
                </View>
              </Pressable>
            )}
          />
        )}
      </View>
    </ThreeSnapBottomSheet>

    <Modal visible={!!namingPlace} transparent animationType="fade" onRequestClose={cancelNamingPlace}>
      <View style={styles.nameModalOverlay}>
        <View style={styles.nameModalCard}>
          <Text style={styles.nameModalTitle}>Name this place</Text>
          {!!namingPlace?.address && (
            <Text style={styles.nameModalAddress} numberOfLines={2}>
              {namingPlace.address}
            </Text>
          )}
          <TextInput
            value={placeName}
            onChangeText={setPlaceName}
            placeholder="e.g. Mum's, Gym, School"
            placeholderTextColor={colors.textFaint}
            style={styles.nameModalInput}
            maxLength={40}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={confirmNamedPlace}
          />
          <View style={styles.nameModalActions}>
            <Pressable
              style={({ pressed }) => [styles.nameModalButton, pressed && { opacity: pressedOpacity }]}
              onPress={cancelNamingPlace}
            >
              <Text style={styles.nameModalButtonTextMuted}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.nameModalButton,
                styles.nameModalButtonPrimary,
                pressed && { opacity: pressedOpacity },
              ]}
              onPress={confirmNamedPlace}
            >
              <Text style={styles.nameModalButtonTextPrimary}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>

    <Modal
      visible={contactsPickerOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setContactsPickerOpen(false)}
    >
      <View style={[styles.contactsModal, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.contactsModalHeader}>
          <Text style={styles.contactsModalTitle}>Friends & family</Text>
          <Pressable onPress={() => setContactsPickerOpen(false)} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        {contactsStatus !== "granted" ? (
          <Pressable style={styles.contactsConnectRow} onPress={onConnectContacts}>
            <Ionicons name="people-outline" size={20} color={colors.accent} />
            <Text style={styles.contactsConnectText}>Connect your contacts to drive to a saved address</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.contactsSearchRow}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={contactsQuery}
                onChangeText={setContactsQuery}
                placeholder="Search contacts…"
                placeholderTextColor={colors.textFaint}
                style={styles.contactsSearchInput}
              />
            </View>
            {contactsLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
            ) : filteredContacts.length === 0 ? (
              <Text style={styles.contactsEmptyText}>
                {contactsWithAddresses.length === 0
                  ? "None of your contacts have a saved address."
                  : "No matches for that search."}
              </Text>
            ) : (
              <FlatList
                data={filteredContacts}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
                renderItem={({ item }) => (
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    onPress={() => onPickContact(item)}
                    disabled={drivingToContactId === item.id}
                  >
                    <View style={[styles.predictionIconWrap, { backgroundColor: colors.accent }]}>
                      <Ionicons name="person" size={16} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.primaryText} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.secondaryText} numberOfLines={1}>
                        {item.formattedAddress}
                      </Text>
                    </View>
                    {drivingToContactId === item.id ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Ionicons name="navigate-outline" size={18} color={colors.accent} />
                    )}
                  </Pressable>
                )}
              />
            )}
          </>
        )}
      </View>
    </Modal>
    </>
  );
});

function CategoryChip({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.categoryChip,
        active && styles.categoryChipActive,
        pressed && { opacity: pressedOpacity },
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={15} color={active ? "#FFFFFF" : colors.text} />
      <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.lg },
  pressableFill: {},
  originRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 36,
    paddingVertical: spacing.xs,
  },
  originText: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.text },
  originDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginBottom: spacing.sm },
  pickingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  pickingBannerText: { fontSize: 13, fontWeight: "700", color: colors.accent },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    height: 52,
    gap: spacing.sm + 2,
    marginTop: spacing.xs,
  },
  searchIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  input: { flex: 1, fontSize: 16, color: colors.text },
  micNote: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs, paddingHorizontal: spacing.xs },
  chipsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  slotChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  slotChipText: { fontSize: 13, fontWeight: "700", color: colors.text },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
  },
  categoryChipActive: { backgroundColor: colors.accent },
  categoryChipText: { fontSize: 13, fontWeight: "700", color: colors.text },
  categoryChipTextActive: { color: "#FFFFFF" },
  quickAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  quickActionText: { fontSize: 14, fontWeight: "600", color: colors.accent },
  errorBanner: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#FEF2F2",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: { flex: 1, fontSize: 12, color: colors.danger },
  listFlex: { flex: 1, marginTop: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  historyRowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  historyRemoveButton: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  historyHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  emptyText: { fontSize: 13, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: "center" },
  predictionIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  predictionTitleRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs + 2 },
  predictionDistance: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  primaryText: { flexShrink: 1, fontSize: 15, color: colors.text, fontWeight: "600" },
  secondaryText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  nameModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  nameModalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  nameModalTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  nameModalAddress: { fontSize: 13, color: colors.textMuted },
  nameModalInput: {
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  nameModalActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  nameModalButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  nameModalButtonPrimary: { backgroundColor: colors.accent },
  nameModalButtonTextMuted: { fontSize: 15, fontWeight: "700", color: colors.textMuted },
  nameModalButtonTextPrimary: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  contactsModal: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  contactsModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  contactsModalTitle: { fontSize: 20, fontWeight: "800", color: colors.text },
  contactsConnectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  contactsConnectText: { flex: 1, fontSize: 13, color: colors.textMuted },
  contactsEmptyText: { fontSize: 13, color: colors.textFaint, textAlign: "center", marginTop: spacing.xl },
  contactsSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
    marginBottom: spacing.sm,
  },
  contactsSearchInput: { flex: 1, fontSize: 15, color: colors.text },
});
