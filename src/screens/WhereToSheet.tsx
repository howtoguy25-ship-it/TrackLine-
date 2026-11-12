import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SharedValue } from "react-native-reanimated";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import * as Crypto from "expo-crypto";
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
  ScrollView,
} from "react-native";
import { Text, TextInput } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path, Rect } from "react-native-svg";
import { ThreeSnapBottomSheet, type ThreeSnapBottomSheetRef } from "@/components/ThreeSnapBottomSheet";
import { AddressKeypadAccessory, ADDRESS_KEYPAD_ACCESSORY_ID } from "@/components/AddressKeypadAccessory";
import {
  searchPlaces,
  getPlaceDetails,
  PlacesApiError,
  type PlacePrediction,
  type PlaceDetails,
} from "@/services/places";
import { getSearchHistory, addSearchHistoryEntry, removeSearchHistoryEntry } from "@/services/searchHistory";
import { AUTOCOMPLETE_DEBOUNCE_MS, SearchSession, rankPredictions } from "@/services/searchRanking";
import {
  getCalendarPermissionStatus,
  requestCalendarAccess,
  getUpcomingEventsWithLocation,
  type UpcomingDriveEvent,
} from "@/services/calendarEvents";
import { Tracky } from "@/components/trackys/Tracky";
import type { TrackyMoodKey } from "@/components/trackys/moods";
import { formatDistance } from "@/utils/navFormat";
import {
  getSavedPlaces,
  setHomeOrWork,
  removeHomeOrWork,
  addCustomPlace,
  removeCustomPlace,
  pushSavedPlacesToProfile,
  pullSavedPlacesFromProfile,
  subscribeSavedPlaces,
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


// Outlined icons for search results. A plain outlined pin for anything that isn't obviously a
// station, airport, hotel, food place or park.
function predictionIconFor(types: string[] | undefined): keyof typeof Ionicons.glyphMap {
  const t = new Set(types ?? []);
  if (t.has("train_station") || t.has("transit_station") || t.has("subway_station") || t.has("light_rail_station")) {
    return "train-outline";
  }
  if (t.has("bus_station")) return "bus-outline";
  if (t.has("airport")) return "airplane-outline";
  if (t.has("lodging")) return "bed-outline";
  if (t.has("restaurant") || t.has("cafe") || t.has("food")) return "restaurant-outline";
  if (t.has("park")) return "leaf-outline";
  return "location-outline";
}

export type WhereToCategory = "saved" | "fuel" | "food" | "parking" | "hotels";

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
  /**
   * A destination chosen in the search screen -- shown on the place page before any route is
   * fetched. Shortcuts on the sheet itself (Home, Work, a saved place, a recent) skip that page
   * and go straight to routes through onDestinationSelected.
   */
  onPlaceChosen?: (place: PlaceDetails) => void;
}

export interface WhereToSheetRef extends ThreeSnapBottomSheetRef {
  /** Opens the full-screen search -- e.g. "Back" from the place page. */
  openSearch: () => void;
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

export const WhereToSheet = forwardRef<WhereToSheetRef, Props>(function WhereToSheet(
  {
    biasLocation,
    onDestinationSelected,
    onFindNearestStation,
    findingNearestStation,
    bottomInset,
    visibleHeight,
    onPlaceChosen,
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
  // The full-screen search (section 3 of the UI pass): opens over everything when the sheet's
  // search field is tapped, closes when a place is chosen or the driver backs out.
  const [searchOpen, setSearchOpen] = useState(false);
  // Why the last search came back empty-handed: offline is shown differently from a key/quota
  // problem, and both differently from "nothing matches".
  const [searchFailure, setSearchFailure] = useState<"offline" | "service" | null>(null);
  // One autocomplete billing session per search -- see services/searchRanking.ts.
  const sessionRef = useRef(new SearchSession(() => Crypto.randomUUID()));
  // Which query the current predictions answer, so "no results" is only claimed for the text
  // that was actually searched (not for a keystroke still waiting out the debounce).
  const [answeredQuery, setAnsweredQuery] = useState("");
  const { settings } = useSettings();
  const micNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSearchHistory().then(setHistory);
    getSavedPlaces().then(setSaved);
    // Saved from somewhere else (the place page) -- shown here straight away.
    return subscribeSavedPlaces(setSaved);
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
        setSearchFailure(null);
        setAnsweredQuery("");
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        setErrorText(null);
        setSearchFailure(null);
        try {
          const results = await searchPlaces(text, biasLocation, sessionRef.current.forAutocomplete());
          setPredictions(rankPredictions(results, text));
          setAnsweredQuery(text);
        } catch (err) {
          setPredictions([]);
          setAnsweredQuery(text);
          if (err instanceof PlacesApiError) {
            setSearchFailure("service");
            setErrorText(
              /billing/i.test(err.message)
                ? "Search unavailable -- billing isn't enabled on this app's Google Cloud project"
                : `Search unavailable (${err.status}) -- check the Places API key`
            );
          } else {
            setSearchFailure("offline");
            setErrorText(null);
          }
        } finally {
          setLoading(false);
        }
      }, AUTOCOMPLETE_DEBOUNCE_MS);
    },
    [biasLocation]
  );

  const resetSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuery("");
    setPredictions([]);
    setAnsweredQuery("");
    setSearchFailure(null);
    setErrorText(null);
    setPickTarget("route");
    setActiveCategory(null);
    setSearchOpen(false);
    sessionRef.current.abandon();
    Keyboard.dismiss();
  }, []);

  /** Opens the full-screen search, for a destination or to fill a saved-place slot. */
  const openSearch = useCallback((target: PickTarget = "route") => {
    setActiveCategory(null);
    setPickTarget(target);
    setQuery("");
    setPredictions([]);
    setAnsweredQuery("");
    setErrorText(null);
    setSearchFailure(null);
    setSearchOpen(true);
  }, []);

  // The sheet itself, plus a way for the map to reopen the search screen.
  const sheetRef = useRef<ThreeSnapBottomSheetRef>(null);
  useImperativeHandle(
    ref,
    () => ({
      collapse: () => sheetRef.current?.collapse(),
      expandHalf: () => sheetRef.current?.expandHalf(),
      expandFull: () => sheetRef.current?.expandFull(),
      openSearch: () => openSearch("route"),
    }),
    [openSearch]
  );

  const handlePicked = useCallback(
    async (place: PlaceDetails) => {
      if (pickTarget === "route") {
        addSearchHistoryEntry(place).then(setHistory);
        resetSearch();
        (onPlaceChosen ?? onDestinationSelected)(place);
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
    [pickTarget, onDestinationSelected, onPlaceChosen, persistSaved, resetSearch]
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
        const details = await getPlaceDetails(prediction.placeId, sessionRef.current.forDetails());
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

  const beginPicking = openSearch;

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
    // What's heard is typed into the search screen, so that's where listening happens.
    setSearchOpen(true);
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
  }, [listening, navLanguage, onChangeText, showMicNote]);
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

  // "More options" > calendar. Before access is given the row offers to connect; afterwards it
  // shows the next event that has a location, and opens the list of them.
  const [calendarStatus, setCalendarStatus] = useState<"granted" | "denied" | "undetermined" | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<UpcomingDriveEvent[]>([]);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [drivingToEventId, setDrivingToEventId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCalendarPermissionStatus()
      .then(async (status) => {
        if (cancelled) return;
        setCalendarStatus(status);
        if (status === "granted") {
          const events = await getUpcomingEventsWithLocation();
          if (!cancelled) setCalendarEvents(events);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const onPressCalendar = useCallback(async () => {
    if (calendarStatus === "granted") {
      setEventsOpen(true);
      return;
    }
    const granted = await requestCalendarAccess().catch(() => false);
    setCalendarStatus(granted ? "granted" : "denied");
    if (!granted) {
      Alert.alert("Calendar access is off", "You can turn it on for TrackLine in your phone's Settings.");
      return;
    }
    setCalendarEvents(await getUpcomingEventsWithLocation().catch(() => []));
    setEventsOpen(true);
  }, [calendarStatus]);
  const onPickEvent = useCallback(
    async (event: UpcomingDriveEvent) => {
      setDrivingToEventId(event.id);
      try {
        const found = await searchPlaces(event.location, biasLocation);
        if (found.length === 0) {
          Alert.alert("Couldn't find that address", `No match found for "${event.location}".`);
          return;
        }
        const place = await getPlaceDetails(found[0].placeId);
        setEventsOpen(false);
        onDestinationSelected(place);
      } catch {
        Alert.alert("Couldn't look up that address", "Check your connection and try again.");
      } finally {
        setDrivingToEventId(null);
      }
    },
    [biasLocation, onDestinationSelected]
  );
  const nextEvent = calendarEvents[0];

  const onRemoveRecent = useCallback(async (placeId: string) => {
    setHistory(await removeSearchHistoryEntry(placeId));
  }, []);

  const onLongPressCustomPlace = useCallback(
    (placeId: string, name: string) => {
      Alert.alert(name, "Remove this saved place?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => persistSaved(await removeCustomPlace(placeId)),
        },
      ]);
    },
    [persistSaved]
  );

  const onPressCategory = useCallback(
    (category: WhereToCategory) => {
      if (category === "saved") {
        setActiveCategory((v) => (v === "saved" ? null : "saved"));
        return;
      }
      setActiveCategory(null);
      resetSearch();
      if (category === "fuel") onFindPetrol();
      else if (category === "food") onFindRestaurants();
      else if (category === "parking") onFindParking();
      else if (category === "hotels") onFindHotels();
    },
    [onFindPetrol, onFindRestaurants, onFindParking, onFindHotels, resetSearch]
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
  const typed = query.trim();
  const showSavedList = activeCategory === "saved" && !picking && !typed;
  // "Nothing matches" is only said for the text that was actually searched, once the answer is in.
  const showNoResults = !!typed && !loading && !searchFailure && answeredQuery === query && predictions.length === 0;

  return (
    <>
    <ThreeSnapBottomSheet
      ref={sheetRef}
      snapFractions={snapFractions}
      topInset={insets.top}
      onChange={onSheetChange}
      bottomInset={bottomInset}
      visibleHeight={visibleHeight}
    >
      <View style={styles.content}>
        {/* The search field. Tapping it opens the full-screen search -- the sheet itself never
            shows a keyboard. */}
        <Pressable
          style={({ pressed }) => [styles.field, pressed && { opacity: pressedOpacity }]}
          onPress={() => openSearch("route")}
          accessibilityRole="search"
          accessibilityLabel="Where to? Search for a place"
        >
          <Ionicons name="search" size={24} color={colors.textMuted} />
          <Text style={styles.fieldPlaceholder}>Where to?</Text>
          <Pressable onPress={onPressMic} hitSlop={12} accessibilityRole="button" accessibilityLabel="Search by voice">
            <Ionicons name="mic" size={24} color={colors.text} />
          </Pressable>
        </Pressable>

        {/* Home, Work, the driver's own saved places, then + New -- scrolling sideways once
            there are more than fit. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.slotRow}
          keyboardShouldPersistTaps="handled"
        >
          <SlotChip
            label="Home"
            icon={<HomeGlyph />}
            onPress={() => onPressHomeOrWork("home")}
            onLongPress={() => onLongPressHomeOrWork("home")}
          />
          <SlotChip
            label="Work"
            icon={<WorkGlyph />}
            onPress={() => onPressHomeOrWork("work")}
            onLongPress={() => onLongPressHomeOrWork("work")}
          />
          {saved.custom.map((place) => (
            <SlotChip
              key={place.placeId}
              label={place.label ?? place.name}
              icon={<Ionicons name="bookmark" size={20} color="#7C3AED" />}
              onPress={() => onDestinationSelected(place)}
              onLongPress={() => onLongPressCustomPlace(place.placeId, place.label ?? place.name)}
            />
          ))}
          <SlotChip
            label="New"
            icon={<Ionicons name="add" size={22} color={colors.accent} />}
            link
            onPress={() => beginPicking("custom")}
          />
        </ScrollView>

        <ScrollView keyboardShouldPersistTaps="handled" style={styles.listFlex} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
          {history.length > 0 && <Text style={styles.sectionLabel}>Recent</Text>}
          {history.map((item) => (
            <RecentRow
              key={item.placeId}
              place={item}
              onPress={() => onDestinationSelected(item)}
              onDelete={() => onRemoveRecent(item.placeId)}
            />
          ))}

          <Text style={styles.sectionLabel}>More options</Text>
          <OptionRow
            icon="people-outline"
            title="Drive to friends & family"
            subtitle="Search contacts"
            onPress={onOpenContactsPicker}
          />
          <OptionRow
            icon="calendar-outline"
            title={calendarStatus === "granted" ? "Upcoming events" : "Connect calendar"}
            subtitle={
              calendarStatus !== "granted"
                ? "Get to events on time"
                : nextEvent
                  ? `${nextEvent.title} · ${nextEvent.startDate.toLocaleString(undefined, {
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}`
                  : "No upcoming events with a location"
            }
            onPress={onPressCalendar}
          />
          {onFindNearestStation && (
            <OptionRow
              icon="train-outline"
              title="Nearest train/bus station"
              subtitle={findingNearestStation ? "Finding the closest stop…" : "Walking directions to the closest stop"}
              onPress={onFindNearestStation}
              busy={findingNearestStation}
            />
          )}
          <OptionRow
            icon="share-outline"
            title="Share drive"
            subtitle="Send someone a link to a place"
            onPress={() => openSearch("share")}
          />
        </ScrollView>
      </View>
    </ThreeSnapBottomSheet>

    {/* ---------------- The full-screen search ---------------- */}
    {/* Native slide, not a Reanimated "entering" animation: a layout animation inside a Modal
        isn't guaranteed to run, and a Modal that opens with its content still parked off-screen
        is an invisible full-screen layer that swallows every tap (with its autoFocus field
        raising the keyboard). The native animation always ends with the screen in place. */}
    <Modal visible={searchOpen} transparent animationType="slide" onRequestClose={resetSearch} statusBarTranslucent>
      <View style={[styles.searchScreen, { paddingTop: insets.top + spacing.sm }]}>
        {picking && (
          <View style={styles.pickingBanner}>
            <Text style={styles.pickingBannerText}>{pickingLabel}</Text>
          </View>
        )}
        <View style={styles.searchTopRow}>
          <Pressable onPress={resetSearch} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={28} color={colors.textMuted} />
          </Pressable>
          <View style={styles.searchField}>
            <TextInput
              value={query}
              onChangeText={onChangeText}
              autoFocus
              onFocus={() => setAddressInputFocused(true)}
              onBlur={() => setAddressInputFocused(false)}
              placeholder={picking ? "Search address" : "Where to?"}
              placeholderTextColor={colors.textFaint}
              selectionColor={colors.primary}
              style={styles.searchInput}
              returnKeyType="search"
              autoCorrect={false}
              inputAccessoryViewID={ADDRESS_KEYPAD_ACCESSORY_ID}
            />
            {loading && <ActivityIndicator size="small" color={colors.accent} />}
            {query.length > 0 ? (
              <Pressable onPress={() => onChangeText("")} hitSlop={12} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={22} color={colors.textFaint} />
              </Pressable>
            ) : (
              <Pressable
                onPress={onPressMic}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={listening ? "Stop listening" : "Search by voice"}
                accessibilityState={{ selected: listening }}
              >
                <Ionicons name={listening ? "mic" : "mic-outline"} size={22} color={listening ? colors.danger : colors.text} />
              </Pressable>
            )}
          </View>
        </View>
        {listening && <Text style={[styles.micNote, { color: colors.danger }]}>Listening… say where you want to go</Text>}
        {!!micNote && !listening && <Text style={styles.micNote}>{micNote}</Text>}
        <AddressKeypadAccessory visible={addressInputFocused} onKeyPress={(char) => onChangeText(query + char)} />

        {!typed && !picking && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRow}
            keyboardShouldPersistTaps="handled"
          >
            <CategoryChip icon="bookmark" label="Saved" active={activeCategory === "saved"} onPress={() => onPressCategory("saved")} />
            <CategoryChip icon="car" label="Fuel" onPress={() => onPressCategory("fuel")} />
            <CategoryChip icon="restaurant" label="Food" onPress={() => onPressCategory("food")} />
            <CategoryChip icon="square-outline" label="Parking" onPress={() => onPressCategory("parking")} />
            <CategoryChip icon="bed" label="Hotels" onPress={() => onPressCategory("hotels")} />
          </ScrollView>
        )}

        {typed && searchFailure === "offline" && (
          <EmptyState mood="rainy" title="You're offline" body="Search needs a connection. Check your signal and try again." />
        )}
        {typed && searchFailure === "service" && !!errorText && (
          <EmptyState mood="grumpy" title="Search isn't working right now" body={errorText} />
        )}
        {showNoResults && (
          <EmptyState mood="focused" title="No places found" body={`Nothing matches "${typed}". Try a street, suburb or business name.`} />
        )}

        {typed && predictions.length > 0 && (
          <FlatList
            data={predictions}
            keyExtractor={(item) => item.placeId}
            style={styles.listFlex}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.resultRow, pressed && styles.rowPressed]}
                onPress={() => onSelectPrediction(item)}
              >
                <View style={styles.resultIcon}>
                  <Ionicons name={predictionIconFor(item.types)} size={28} color={colors.textMuted} />
                </View>
                <View style={styles.resultText}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.primaryText}
                  </Text>
                  {!!item.secondaryText && (
                    <Text style={styles.resultSubtitle} numberOfLines={1}>
                      {item.secondaryText}
                    </Text>
                  )}
                </View>
                {item.distanceMeters !== undefined && (
                  <Text style={styles.resultDistance}>{formatDistance(item.distanceMeters, settings.distanceUnit)}</Text>
                )}
              </Pressable>
            )}
          />
        )}

        {showSavedList && (
          <FlatList
            data={saved.custom}
            keyExtractor={(item) => item.placeId}
            style={styles.listFlex}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            ListEmptyComponent={
              <EmptyState mood="chill" title="No saved places yet" body={'Tap "+ New" on the map to save one.'} />
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.resultRow, pressed && styles.rowPressed]}
                onPress={() => {
                  resetSearch();
                  (onPlaceChosen ?? onDestinationSelected)(item);
                }}
                onLongPress={() => onLongPressCustomPlace(item.placeId, item.label ?? item.name)}
              >
                <View style={styles.resultIcon}>
                  <Ionicons name="bookmark-outline" size={26} color={colors.textMuted} />
                </View>
                <View style={styles.resultText}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.label ?? item.name}
                  </Text>
                  <Text style={styles.resultSubtitle} numberOfLines={1}>
                    {item.address}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        )}

        {!typed && !showSavedList && (
          <ScrollView style={styles.listFlex} keyboardShouldPersistTaps="handled">
            {history.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { paddingHorizontal: spacing.lg }]}>Recent</Text>
                {history.map((item) => (
                  <RecentRow
                    key={item.placeId}
                    place={item}
                    inset
                    onPress={() => handlePicked(item)}
                    onDelete={() => onRemoveRecent(item.placeId)}
                  />
                ))}
              </>
            ) : (
              <EmptyState mood="chill" title="Where are we off to?" body="Search for a place, an address or a business." />
            )}
          </ScrollView>
        )}

        {/* "+ New": name the place that was just picked. An overlay inside this screen rather
            than a second Modal -- iOS won't present one modal while another is on screen. */}
        {!!namingPlace && (
          <View style={styles.nameModalOverlay}>
            <View style={styles.nameModalCard}>
              <Text style={styles.nameModalTitle}>Name this place</Text>
              {!!namingPlace.address && (
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
                  style={({ pressed }) => [styles.nameModalButton, styles.nameModalButtonPrimary, pressed && { opacity: pressedOpacity }]}
                  onPress={confirmNamedPlace}
                >
                  <Text style={styles.nameModalButtonTextPrimary}>Save</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>

    {/* Upcoming calendar events that have a location -- tap one to get directions there. */}
    <Modal visible={eventsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEventsOpen(false)}>
      <View style={[styles.contactsModal, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.contactsModalHeader}>
          <Text style={styles.contactsModalTitle}>Upcoming events</Text>
          <Pressable onPress={() => setEventsOpen(false)} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
        {calendarEvents.length === 0 ? (
          <EmptyState
            mood="sleepy"
            title="Nothing coming up"
            body="Events in your calendar that have a location will show here."
          />
        ) : (
          <FlatList keyboardShouldPersistTaps="handled"
            data={calendarEvents}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.resultRow, pressed && styles.rowPressed]}
                onPress={() => onPickEvent(item)}
                disabled={drivingToEventId === item.id}
              >
                <View style={styles.resultIcon}>
                  <Ionicons name="calendar-outline" size={26} color={colors.textMuted} />
                </View>
                <View style={styles.resultText}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.resultSubtitle} numberOfLines={1}>
                    {item.startDate.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} ·{" "}
                    {item.location}
                  </Text>
                </View>
                {drivingToEventId === item.id && <ActivityIndicator color={colors.accent} />}
              </Pressable>
            )}
          />
        )}
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
              <FlatList keyboardShouldPersistTaps="handled"
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
      style={({ pressed }) => [styles.categoryChip, active && styles.categoryChipActive, pressed && { opacity: pressedOpacity }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
    >
      <Ionicons name={icon} size={18} color={active ? "#FFFFFF" : colors.text} />
      <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

// Home and Work chip artwork: two small original drawings, not system icons.
function HomeGlyph() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path d="M3 11.2 L12 3.5 L21 11.2" stroke="#F97316" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M5.5 10 V20 H18.5 V10" fill="#38BDF8" />
      <Rect x="10" y="13.5" width="4" height="6.5" rx="1" fill="#FFFFFF" />
    </Svg>
  );
}

function WorkGlyph() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Rect x="8.5" y="3.5" width="7" height="4" rx="1.4" stroke="#7C4A1E" strokeWidth={2} fill="none" />
      <Rect x="3" y="7" width="18" height="13" rx="2.5" fill="#B7793D" />
      <Rect x="3" y="11.5" width="18" height="2" fill="#7C4A1E" />
      <Rect x="10.5" y="10.5" width="3" height="4" rx="0.8" fill="#FBBF24" />
    </Svg>
  );
}

function SlotChip({
  label,
  icon,
  link,
  onPress,
  onLongPress,
}: {
  label: string;
  icon: React.ReactNode;
  link?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.slotChip, pressed && { opacity: pressedOpacity }]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <Text style={[styles.slotChipText, link && { color: colors.accent }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A recent search. Swipe left to reveal Delete. */
function RecentRow({
  place,
  inset,
  onPress,
  onDelete,
}: {
  place: PlaceDetails;
  inset?: boolean;
  onPress: () => void;
  onDelete: () => void;
}) {
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable style={styles.deleteAction} onPress={onDelete} accessibilityRole="button" accessibilityLabel={`Delete ${place.name}`}>
          <Text style={styles.deleteActionText}>Delete</Text>
        </Pressable>
      )}
    >
      <Pressable
        style={({ pressed }) => [styles.resultRow, !inset && styles.resultRowFlush, pressed && styles.rowPressed]}
        onPress={onPress}
        accessibilityHint="Swipe left to delete"
      >
        <View style={styles.resultIcon}>
          <Ionicons name="time-outline" size={26} color={colors.textMuted} />
        </View>
        <View style={styles.resultText}>
          <Text style={styles.resultTitle} numberOfLines={1}>
            {place.name}
          </Text>
          {!!place.address && (
            <Text style={styles.resultSubtitle} numberOfLines={1}>
              {place.address}
            </Text>
          )}
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

/** A "More options" row: icon, title, and a blue line saying what it does. */
function OptionRow({
  icon,
  title,
  subtitle,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.resultRow, styles.resultRowFlush, pressed && styles.rowPressed]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
    >
      <View style={styles.resultIcon}>
        {busy ? <ActivityIndicator color={colors.accent} /> : <Ionicons name={icon} size={26} color={colors.textMuted} />}
      </View>
      <View style={styles.resultText}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.resultSubtitle, { color: colors.accent }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

/** Empty, no-results and offline states: a small Tracky and a line or two. */
function EmptyState({ mood, title, body }: { mood: TrackyMoodKey; title: string; body: string }) {
  return (
    <View style={styles.emptyState}>
      <Tracky mood={mood} size={72} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.lg },
  // --- the sheet
  field: {
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceMuted,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  fieldPlaceholder: { flex: 1, fontSize: 20, fontWeight: "400", color: colors.textFaint },
  slotRow: { gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  slotChip: {
    height: 62,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    maxWidth: 220,
  },
  slotChipText: { fontSize: 20, fontWeight: "600", color: colors.text },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  // --- rows shared by the sheet and the search screen: icon column 68pt, divider inset to it
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 72,
    paddingRight: spacing.lg,
    backgroundColor: colors.surface,
  },
  resultRowFlush: { paddingRight: 0 },
  resultIcon: { width: 68, alignItems: "center", justifyContent: "center" },
  resultText: {
    flex: 1,
    alignSelf: "stretch",
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultTitle: { fontSize: 20, fontWeight: "600", color: colors.text },
  resultSubtitle: { fontSize: 15, fontWeight: "400", color: colors.textMuted, marginTop: 2 },
  resultDistance: { fontSize: 17, fontWeight: "400", color: colors.textMuted, marginLeft: spacing.sm },
  deleteAction: { width: 96, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  deleteActionText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  // --- the full-screen search
  searchScreen: { ...StyleSheet.absoluteFill, backgroundColor: colors.surface },
  searchTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm },
  searchField: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceMuted,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  searchInput: { flex: 1, fontSize: 20, fontWeight: "400", color: colors.text, height: "100%" },
  categoryRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  emptyState: { alignItems: "center", paddingHorizontal: spacing.xl, paddingTop: spacing.xl, gap: spacing.xs },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginTop: spacing.sm, textAlign: "center" },
  emptyBody: { fontSize: 15, color: colors.textMuted, textAlign: "center" },
  pickingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  pickingBannerText: { fontSize: 13, fontWeight: "700", color: colors.accent },
  micNote: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs, paddingHorizontal: spacing.xs },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 44,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 22,
    paddingHorizontal: spacing.lg,
  },
  categoryChipActive: { backgroundColor: colors.accent },
  categoryChipText: { fontSize: 16, fontWeight: "600", color: colors.text },
  categoryChipTextActive: { color: "#FFFFFF" },
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
  predictionIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
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
