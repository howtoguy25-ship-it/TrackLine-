import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Linking,
  Share,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { Text } from "@/components/AppText";
import { PressableScale } from "@/components/PressableScale";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { getPlaceInfo, type PlaceDetails, type PlaceInfo } from "@/services/places";
import { getOsmPlaceInfo, isOsmPlaceId, searchNearbyOsmPlaces } from "@/services/osmPlaces";
import {
  addCustomPlace,
  getSavedPlaces,
  pushSavedPlacesToProfile,
  removeCustomPlace,
  setHomeOrWork,
  subscribeSavedPlaces,
  type SavedPlaces,
  type SavedPlaceSlot,
} from "@/services/savedPlaces";
import { driveShareMessage } from "@/services/driveLink";
import {
  getApprovedPlacePhotos,
  reportPlace,
  submitPlacePhoto,
  type ApprovedPlacePhoto,
  type PlaceReportReason,
} from "@/services/placeContributions";
import { isLookupablePlaceId, summarizeParking, todaysHours, type ParkingSummary } from "@/services/placePageLogic";
import { metersBetween } from "@/map/homeMapLogic";
import { formatDistance } from "@/utils/navFormat";
import { colors, shadow, spacing, pressedOpacity, scaleFor } from "@/theme/tokens";

// The place page (UI pass 2, section 4): what you see after choosing a search result, before
// any route is fetched. The map behind it is the real map, moved so the place sits in the top
// 40% (MapScreen pads the map for that and draws the red pin); this component draws the sheet
// over the bottom 60%, the two round buttons at the top, and the fixed "View routes" button.

/** Fraction of the screen the sheet covers -- MapScreen pads the map by the same amount. */
export const PLACE_PAGE_SHEET_FRACTION = 0.6;

interface Props {
  place: PlaceDetails;
  /** The driver's own position, for "1.6 km away". */
  origin: { latitude: number; longitude: number } | null;
  onBack: () => void;
  onClose: () => void;
  onViewRoutes: (place: PlaceDetails) => void;
  /** Opens the full parking list, centred on this place. */
  onSeeMoreParking: (place: PlaceDetails) => void;
  /** Opens Plan a drive with this place already chosen. */
  onPlanDrive: (place: PlaceDetails) => void;
}

const REPORT_REASONS: { key: PlaceReportReason; label: string }[] = [
  { key: "wrong_location", label: "It's in the wrong spot" },
  { key: "closed", label: "It's closed for good" },
  { key: "wrong_name", label: "The name is wrong" },
  { key: "other", label: "Something else" },
];

export function PlacePage({ place, origin, onBack, onClose, onViewRoutes, onSeeMoreParking, onPlanDrive }: Props) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const k = scaleFor(width);
  const { user } = useAuth();
  const { settings } = useSettings();

  // Business details (hours, rating, phone, photos) -- only for places Google or OSM can describe.
  const [info, setInfo] = useState<PlaceInfo | null>(null);
  const [parking, setParking] = useState<ParkingSummary | null>(null);
  const [userPhotos, setUserPhotos] = useState<ApprovedPlacePhoto[]>([]);
  const [saved, setSaved] = useState<SavedPlaces | null>(null);
  const [menu, setMenu] = useState<"more" | "report" | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (isLookupablePlaceId(place.placeId)) {
      (isOsmPlaceId(place.placeId) ? getOsmPlaceInfo(place.placeId) : getPlaceInfo(place.placeId))
        .then((result) => {
          if (!cancelled) setInfo(result);
        })
        .catch(() => {});
      getApprovedPlacePhotos(place.placeId).then((photos) => {
        if (!cancelled) setUserPhotos(photos);
      });
    }
    searchNearbyOsmPlaces(place.location, "parking")
      .then((carParks) => {
        if (!cancelled) setParking(summarizeParking(carParks));
      })
      .catch(() => {
        if (!cancelled) setParking({ kind: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [place.placeId, place.location]);

  useEffect(() => {
    getSavedPlaces().then(setSaved);
    return subscribeSavedPlaces(setSaved);
  }, []);

  const isSaved = !!saved?.custom.some((p) => p.placeId === place.placeId);
  const distanceText = origin
    ? `${formatDistance(
        metersBetween(origin.latitude, origin.longitude, place.location.latitude, place.location.longitude),
        settings.distanceUnit
      )} away`
    : null;
  const hoursToday = useMemo(() => todaysHours(info?.weekdayText, new Date()), [info?.weekdayText]);

  const sync = (next: SavedPlaces) => {
    if (user && !user.isAnonymous) pushSavedPlacesToProfile(user.uid, next).catch(() => {});
  };
  const toggleSave = async () => {
    sync(isSaved ? await removeCustomPlace(place.placeId) : await addCustomPlace(place));
  };
  const setSlot = async (slot: SavedPlaceSlot) => {
    setMenu(null);
    sync(await setHomeOrWork(slot, place));
    Alert.alert(slot === "home" ? "Saved as Home" : "Saved as Work", place.address || place.name);
  };
  const share = () => {
    Share.share({
      message: driveShareMessage({
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        name: place.name,
        address: place.address,
      }),
    }).catch(() => {});
  };
  const copyAddress = async () => {
    setMenu(null);
    await Clipboard.setStringAsync(place.address || place.name);
  };
  const report = async (reason: PlaceReportReason) => {
    setMenu(null);
    if (!user) {
      Alert.alert("Sign in to report a place");
      return;
    }
    try {
      await reportPlace(user.uid, place, reason);
      Alert.alert("Thanks", "We'll take a look at this place.");
    } catch {
      Alert.alert("Couldn't send that", "Check your connection and try again.");
    }
  };
  const addPhoto = async () => {
    if (!user) {
      Alert.alert("Sign in to add a photo");
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access is off", "You can allow it for TrackLine in your phone's Settings.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (picked.canceled || !picked.assets[0]) return;
    setUploading(true);
    try {
      await submitPlacePhoto(user.uid, place.placeId, picked.assets[0].uri);
      Alert.alert("Thanks for the photo", "It'll appear here once it's been reviewed.");
    } catch {
      Alert.alert("Couldn't upload that photo", "Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const sheetHeight = height * PLACE_PAGE_SHEET_FRACTION;
  const roundButton = { width: 48, height: 48, borderRadius: 24 };
  const footerHeight = 58 + spacing.lg + insets.bottom;
  const googlePhotos = info?.photoUrls ?? [];
  const canAddPhoto = isLookupablePlaceId(place.placeId);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [styles.round, roundButton, { top: insets.top + spacing.sm, left: spacing.lg }, pressed && { opacity: pressedOpacity }]}
        accessibilityRole="button"
        accessibilityLabel="Back to search"
      >
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </Pressable>
      <Pressable
        onPress={onClose}
        style={({ pressed }) => [styles.round, roundButton, { top: insets.top + spacing.sm, right: spacing.lg }, pressed && { opacity: pressedOpacity }]}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Ionicons name="close" size={26} color={colors.text} />
      </Pressable>

      <View style={[styles.sheet, { height: sheetHeight }]}>
        <View style={styles.grabber} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: footerHeight + spacing.lg }}>
          <Text style={[styles.name, { fontSize: 30 * k }]} numberOfLines={3}>
            {place.name}
          </Text>
          {!!distanceText && (
            <View style={styles.distancePill}>
              <Text style={styles.distancePillText}>{distanceText}</Text>
            </View>
          )}
          {!!place.address && <Text style={styles.address}>{place.address}</Text>}

          {/* Business details -- only what Google (or OpenStreetMap) actually returned. */}
          {!!info && (info.openNow !== undefined || hoursToday || info.rating !== undefined || info.phoneNumber) && (
            <View style={styles.facts}>
              {(info.openNow !== undefined || hoursToday) && (
                <Text style={styles.fact}>
                  {info.openNow !== undefined && (
                    <Text style={{ color: info.openNow ? "#15803D" : colors.danger, fontWeight: "600" }}>
                      {info.openNow ? "Open" : "Closed"}
                    </Text>
                  )}
                  {info.openNow !== undefined && hoursToday ? " · " : ""}
                  {hoursToday ? `Today ${hoursToday}` : ""}
                </Text>
              )}
              {info.rating !== undefined && (
                <Text style={styles.fact}>
                  ★ {info.rating.toFixed(1)}
                  {info.userRatingsTotal ? ` (${info.userRatingsTotal.toLocaleString()} reviews)` : ""}
                </Text>
              )}
              {!!info.phoneNumber && (
                <Pressable onPress={() => Linking.openURL(`tel:${info.phoneNumber}`)} hitSlop={6}>
                  <Text style={[styles.fact, { color: colors.accent }]}>{info.phoneNumber}</Text>
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.tiles}>
            <ActionTile icon={isSaved ? "bookmark" : "bookmark-outline"} label={isSaved ? "Saved" : "Save"} onPress={toggleSave} />
            <ActionTile icon="share-outline" label="Share" onPress={share} />
            <ActionTile icon="ellipsis-horizontal" label="More" onPress={() => setMenu("more")} />
          </View>

          {parking && parking.kind !== "none" && (
            <>
              <Text style={styles.sectionTitle}>Nearby parking</Text>
              <View style={styles.parkingCard}>
                <View style={styles.parkingPin}>
                  <Text style={styles.parkingPinText}>P</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.parkingTitle} numberOfLines={1}>
                    {parking.kind === "onsite" ? "Car park at this place" : parking.name}
                  </Text>
                  <Text style={styles.parkingSub} numberOfLines={1}>
                    {parking.kind === "onsite" ? parking.name : `About ${parking.walkMinutes} min walk`}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => onSeeMoreParking(place)} hitSlop={8}>
                <Text style={styles.link}>See more parking</Text>
              </Pressable>
            </>
          )}

          {(googlePhotos.length > 0 || userPhotos.length > 0 || canAddPhoto) && (
            <>
              <Text style={styles.sectionTitle}>Photos</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {canAddPhoto && (
                  <Pressable
                    onPress={addPhoto}
                    disabled={uploading}
                    style={({ pressed }) => [styles.addPhoto, pressed && { opacity: pressedOpacity }]}
                    accessibilityRole="button"
                    accessibilityLabel="Add a photo"
                  >
                    {uploading ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="camera-outline" size={30} color={colors.accent} />}
                    <Text style={styles.addPhotoText}>Add photo</Text>
                  </Pressable>
                )}
                {googlePhotos.map((url, i) => (
                  <View key={url} style={styles.photo}>
                    <Image source={{ uri: url }} style={styles.photoImage} />
                    {/* Google's terms: each Places photo shows who took it. */}
                    {!!info?.photoAttributions[i] && (
                      <Text style={styles.photoCredit} numberOfLines={1}>
                        {info.photoAttributions[i]}
                      </Text>
                    )}
                  </View>
                ))}
                {userPhotos.map((photo) => (
                  <View key={photo.id} style={styles.photo}>
                    <Image source={{ uri: photo.url }} style={styles.photoImage} />
                    <Text style={styles.photoCredit}>From a TrackLine driver</Text>
                  </View>
                ))}
              </ScrollView>
              {googlePhotos.length > 0 && <Text style={styles.poweredBy}>Photos from Google</Text>}
            </>
          )}
        </ScrollView>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <PressableScale
          onPress={() => onViewRoutes(place)}
          style={styles.viewRoutes}
          accessibilityRole="button"
          accessibilityLabel="View routes"
        >
          <Text style={styles.viewRoutesText}>View routes</Text>
        </PressableScale>
      </View>

      {menu && (
        <Pressable style={styles.menuOverlay} onPress={() => setMenu(null)}>
          <Pressable style={[styles.menuCard, { paddingBottom: insets.bottom + spacing.lg }]} onPress={() => {}}>
            {menu === "more" ? (
              <>
                <MenuItem icon="home-outline" label="Set as Home" onPress={() => setSlot("home")} />
                <MenuItem icon="briefcase-outline" label="Set as Work" onPress={() => setSlot("work")} />
                <MenuItem
                  icon="calendar-outline"
                  label="Add to a planned drive"
                  onPress={() => {
                    setMenu(null);
                    onPlanDrive(place);
                  }}
                />
                <MenuItem icon="copy-outline" label="Copy address" onPress={copyAddress} />
                {isLookupablePlaceId(place.placeId) && (
                  <MenuItem icon="flag-outline" label="Report a wrong place" onPress={() => setMenu("report")} />
                )}
              </>
            ) : (
              <>
                <Text style={styles.menuTitle}>What&apos;s wrong with this place?</Text>
                {REPORT_REASONS.map((reason) => (
                  <MenuItem key={reason.key} icon="chevron-forward" label={reason.label} onPress={() => report(reason.key)} />
                ))}
              </>
            )}
            <MenuItem icon="close" label="Cancel" onPress={() => setMenu(null)} />
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

function ActionTile({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.tile} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={26} color={colors.accent} />
      <Text style={styles.tileText}>{label}</Text>
    </PressableScale>
  );
}

function MenuItem({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && { opacity: pressedOpacity }]}>
      <Ionicons name={icon} size={22} color={colors.textMuted} />
      <Text style={styles.menuItemText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  round: {
    position: "absolute",
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.floating,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadow.high,
  },
  grabber: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.grabber,
    marginTop: 10,
    marginBottom: spacing.md,
  },
  name: { fontWeight: "700", color: colors.text },
  distancePill: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginTop: spacing.sm,
  },
  distancePillText: { fontSize: 15, fontWeight: "600", color: colors.text },
  address: { fontSize: 16, color: colors.textMuted, marginTop: spacing.sm },
  facts: { marginTop: spacing.md, gap: 4 },
  fact: { fontSize: 15, color: colors.text },
  tiles: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  tile: { flex: 1, height: 84, borderRadius: 16, backgroundColor: colors.surfaceMuted },
  tileText: { fontSize: 15, fontWeight: "600", color: colors.accent, marginTop: 4 },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  parkingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.chipBorder,
    borderRadius: 16,
    padding: spacing.md,
  },
  parkingPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  parkingPinText: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  parkingTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  parkingSub: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  link: { fontSize: 16, fontWeight: "600", color: colors.accent, marginTop: spacing.sm },
  photo: { width: 150 },
  photoImage: { width: 150, height: 110, borderRadius: 12, backgroundColor: colors.surfaceMuted },
  photoCredit: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  poweredBy: { fontSize: 11, color: colors.textFaint, marginTop: spacing.xs },
  addPhoto: {
    width: 110,
    height: 110,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.chipBorder,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  addPhotoText: { fontSize: 13, fontWeight: "600", color: colors.accent },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  viewRoutes: { height: 58, borderRadius: 29, backgroundColor: colors.primary },
  viewRoutesText: { fontSize: 20, fontWeight: "600", color: "#FFFFFF" },
  menuOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  menuCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  menuTitle: { fontSize: 17, fontWeight: "700", color: colors.text, marginVertical: spacing.sm },
  menuItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  menuItemText: { fontSize: 17, color: colors.text },
});
