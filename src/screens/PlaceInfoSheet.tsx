import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { View, Pressable, StyleSheet, ScrollView, Linking, Image, Animated } from "react-native";
import { Text } from "@/components/AppText";
import BottomSheet, { BottomSheetView, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { priceLevelText, type PlaceInfo } from "@/services/places";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

interface Props {
  place: PlaceInfo | null;
  onClose: () => void;
  onSheetChange?: (index: number) => void;
  // Real, confirmed gap -- this sheet had photos/rating/hours/phone/website/reviews but no way
  // to actually route there, forcing a driver to close it and re-search the same place by name.
  // Optional so a caller that only wants read-only info (none exist today, but kept honest to
  // the real shape) doesn't have to wire a no-op.
  onGetDirections?: (place: PlaceInfo) => void;
  // Real, explicit request -- a second, faster action beside Directions: fetches the real
  // recommended route and begins navigating immediately, matching Apple/Google Maps' own
  // place-card "Start" button. Optional for the same reason onGetDirections is.
  onStartNavigation?: (place: PlaceInfo) => void;
  // Real quick drive-time check (MapScreen's own traffic-aware Directions lookup, fired once
  // this sheet opens) -- like Apple Maps' "19 min." pill on a place card. Null while that
  // lookup is still in flight or hasn't started; never a guessed/placeholder figure.
  etaText?: string | null;
  // Real Street View Static thumbnail for this exact place (MapScreen's own getStreetViewUrl,
  // which only resolves when Google genuinely has coverage here) -- null means no real
  // coverage, not a failed load, so nothing fabricated is ever shown in its place.
  streetViewUrl?: string | null;
  // Real interactive (pan/zoom) Street View embed for this exact place, via Google's Maps Embed
  // API -- see getStreetViewEmbedUrl's own comment. Null whenever streetViewUrl is null (no real
  // coverage) or the caller hasn't computed it yet; this sheet never fabricates one from
  // streetViewUrl alone. If the embed genuinely fails to load (e.g. "Maps Embed API" isn't
  // enabled on this project's key), this sheet falls back to the plain static thumbnail below --
  // never a blank panel.
  streetViewEmbedUrl?: string | null;
}

// Real, explicit request -- the Street View thumbnail used to just pop in the instant its real
// network fetch finished, which read as an abrupt flash against this sheet's otherwise smooth
// animations. Plain RN <Image> has no cross-platform fade (fadeDuration is Android-only), so
// this fades the real loaded image in itself via a genuine Animated.Image opacity transition
// fired from the real onLoad event -- not a fixed timer guessing how long the fetch will take.
function FadeInImage({ uri, style }: { uri: string; style: any }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    opacity.setValue(0);
  }, [uri, opacity]);
  return (
    <Animated.Image
      source={{ uri }}
      style={[style, { opacity }]}
      onLoad={() => Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }).start()}
    />
  );
}

// Real, explicit request -- an actually-interactive (pan/zoom) Street View, not just a static
// photo. Tries the real Maps Embed API iframe first; if it genuinely fails to load (network
// error, HTTP error, or "Maps Embed API" not enabled on this project's key), falls back to the
// already-working static thumbnail below rather than ever showing a blank/broken panel.
function StreetViewPanel({
  embedUrl,
  staticUrl,
  style,
}: {
  embedUrl: string | null | undefined;
  staticUrl: string;
  style: any;
}) {
  const [embedFailed, setEmbedFailed] = useState(false);
  useEffect(() => {
    setEmbedFailed(false);
  }, [embedUrl]);
  if (!embedUrl || embedFailed) {
    return <FadeInImage uri={staticUrl} style={style} />;
  }
  return (
    <WebView
      source={{ uri: embedUrl }}
      style={style}
      onError={() => setEmbedFailed(true)}
      onHttpError={() => setEmbedFailed(true)}
      startInLoadingState
      renderLoading={() => <FadeInImage uri={staticUrl} style={style} />}
    />
  );
}

export const PlaceInfoSheet = forwardRef<BottomSheet, Props>(function PlaceInfoSheet(
  { place, onClose, onSheetChange, onGetDirections, onStartNavigation, etaText, streetViewUrl, streetViewEmbedUrl },
  ref
) {
  const insets = useSafeAreaInsets();
  // Two stages, like Apple Maps' own place card -- short stage lands enough to confirm the
  // right place/name/rating/ETA at a glance without covering most of the map; the tall stage
  // (opened via the swipe-up affordance on the Street View thumbnail below, or a manual drag)
  // reveals the rest -- hours/phone/reviews/photos.
  const snapPoints = useMemo(() => ["50%", "90%"], []);
  const sheetRef = useRef<BottomSheet>(null);
  useImperativeHandle(ref, () => sheetRef.current as BottomSheet);
  const expandSheet = () => sheetRef.current?.snapToIndex(1);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={onSheetChange}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}>
        {place && (
          <>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>
                  {place.name}
                </Text>
                <Text style={styles.subtitle} numberOfLines={2}>
                  {place.address}
                </Text>
                {/* Real category/price line -- only renders when Google/OSM actually returned
                    one of these for this place; never fabricated, never shown for a plain
                    address with no business data attached. */}
                {(place.category || priceLevelText(place.priceLevel)) && (
                  <Text style={styles.categoryLine} numberOfLines={1}>
                    {[place.category, priceLevelText(place.priceLevel)].filter(Boolean).join(" · ")}
                  </Text>
                )}
              </View>
              <Button
                variant="ghost"
                icon="close"
                iconColor={colors.textMuted}
                onPress={onClose}
                accessibilityLabel="Close"
              />
            </View>

            <View style={styles.statusRow}>
              {/* Real, explicit request -- a direction/arrow-shaped icon next to the live ETA
                  (was a car icon) -- this is a quick drive-time check, not a vehicle-type
                  indicator, so the icon reads as "this way, this long" rather than "by car". */}
              {etaText && (
                <View style={styles.etaPill}>
                  <Icon name="navigate" size={13} color="#FFFFFF" />
                  <Text style={styles.etaPillText}>{etaText}</Text>
                </View>
              )}
              {place.rating != null && (
                <View style={styles.ratingWrap}>
                  <Icon name="star" size={14} color="#F59E0B" />
                  <Text style={styles.ratingText}>
                    {place.rating.toFixed(1)}
                    {place.userRatingsTotal != null ? ` (${place.userRatingsTotal})` : ""}
                  </Text>
                </View>
              )}
              {place.openNow != null && (
                <Text style={[styles.openNowText, { color: place.openNow ? "#16A34A" : colors.danger }]}>
                  {place.openNow ? "Open now" : "Closed"}
                </Text>
              )}
            </View>

            {/* Real, explicit request -- a proper primary-actions row (Apple/Google Maps'
                own place-card convention), separate from the rating/open-now status line above:
                Directions (opens the real route picker -- alternatives, tolls, Add a stop) and a
                second, faster Start (fetches the real recommended route and begins navigating
                immediately, no picker). Either, both, or neither render depending on which
                callbacks the caller actually wired -- never a dead button. */}
            {(onGetDirections || onStartNavigation) && (
              <View style={styles.actionsRow}>
                {onGetDirections && (
                  <Button
                    variant="secondary"
                    icon="navigate-outline"
                    label="Directions"
                    onPress={() => onGetDirections(place)}
                    style={{ flex: 1 }}
                  />
                )}
                {onStartNavigation && (
                  <Button
                    variant="primary"
                    icon="play"
                    label="Start"
                    onPress={() => onStartNavigation(place)}
                    style={{ flex: 1 }}
                  />
                )}
              </View>
            )}

            {/* Real Street View -- Apple Maps' own "Look Around" equivalent, bottom-left of this
                initially-visible card per explicit request. The thumbnail itself is a plain View
                (not a Pressable) so the interactive embed's own pan/zoom touches inside it are
                never fought over by an outer tap handler; the chevron badge and hint text beside
                it are the actual tap-to-expand affordance (swiping up reaches the same expanded
                90% stage too). Omitted entirely rather than showing any placeholder when
                streetViewUrl is null -- see its own prop comment. */}
            {streetViewUrl && (
              <View style={styles.streetViewRow}>
                <View style={styles.streetViewThumbWrap}>
                  <StreetViewPanel
                    embedUrl={streetViewEmbedUrl}
                    staticUrl={streetViewUrl}
                    style={styles.streetViewThumb}
                  />
                </View>
                <Pressable
                  onPress={expandSheet}
                  style={({ pressed }) => [styles.streetViewExpandHint, pressed && { opacity: pressedOpacity }]}
                  accessibilityLabel="Street view. Swipe up for more details."
                >
                  <Text style={styles.streetViewHint}>Street View -- swipe up for more</Text>
                  <View style={styles.streetViewExpandBadge}>
                    <Icon name="chevron-up" size={13} color={colors.accent} />
                  </View>
                </Pressable>
              </View>
            )}

            {/* BottomSheetScrollView, not a plain ScrollView -- inside @gorhom/bottom-sheet, the
                sheet's own pan gesture handler intercepts drag touches meant for a plain
                ScrollView's content, so scrolling silently does nothing unless the library's own
                gesture-aware scroll component is used. */}
            <BottomSheetScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} showsVerticalScrollIndicator={false}>
              {place.photoUrls.length > 0 && (
                <ScrollView keyboardShouldPersistTaps="handled"
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.photoRow}
                  contentContainerStyle={styles.photoRowContent}
                >
                  {place.photoUrls.map((url) => (
                    <Image key={url} source={{ uri: url }} style={styles.photo} />
                  ))}
                </ScrollView>
              )}

              {place.weekdayText && place.weekdayText.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Hours</Text>
                  {place.weekdayText.map((line) => (
                    <Text key={line} style={styles.hoursLine}>
                      {line}
                    </Text>
                  ))}
                </View>
              )}

              {(place.phoneNumber || place.website) && (
                <View style={styles.section}>
                  {place.phoneNumber && (
                    <Pressable
                      style={({ pressed }) => [styles.linkRow, pressed && { opacity: pressedOpacity }]}
                      onPress={() => Linking.openURL(`tel:${place.phoneNumber}`)}
                    >
                      <Icon name="call-outline" size={16} color={colors.accent} />
                      <Text style={styles.linkText}>{place.phoneNumber}</Text>
                    </Pressable>
                  )}
                  {place.website && (
                    <Pressable
                      style={({ pressed }) => [styles.linkRow, pressed && { opacity: pressedOpacity }]}
                      onPress={() => Linking.openURL(place.website!)}
                    >
                      <Icon name="globe-outline" size={16} color={colors.accent} />
                      <Text style={styles.linkText} numberOfLines={1}>
                        {place.website}
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}

              {place.reviews.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Reviews</Text>
                  {place.reviews.map((review, i) => (
                    <View key={`${review.authorName}-${i}`} style={styles.reviewCard}>
                      <View style={styles.reviewHeader}>
                        <Text style={styles.reviewAuthor} numberOfLines={1}>
                          {review.authorName}
                        </Text>
                        <View style={styles.ratingWrap}>
                          <Icon name="star" size={12} color="#F59E0B" />
                          <Text style={styles.reviewRating}>{review.rating}</Text>
                        </View>
                      </View>
                      <Text style={styles.reviewTime}>{review.relativeTime}</Text>
                      <Text style={styles.reviewText} numberOfLines={4}>
                        {review.text}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </BottomSheetScrollView>
          </>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.high,
  },
  handleIndicator: {
    backgroundColor: colors.border,
    width: 40,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  categoryLine: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.accent,
    marginTop: 3,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  ratingWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  openNowText: {
    fontSize: 13,
    fontWeight: "600",
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  // Secondary/outline treatment -- Start is the one real "go now" action, so Directions (opens
  // the picker, doesn't commit to anything yet) reads as the lighter-weight choice beside it.
  etaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#16A34A",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  etaPillText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  streetViewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  streetViewThumbWrap: {
    width: 96,
    height: 72,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceMuted,
  },
  streetViewThumb: {
    width: "100%",
    height: "100%",
  },
  streetViewExpandHint: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    alignSelf: "stretch",
  },
  streetViewExpandBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  streetViewHint: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    flexShrink: 1,
  },
  scroll: {
    marginTop: spacing.md,
  },
  photoRow: {
    marginBottom: spacing.md,
  },
  photoRowContent: {
    gap: spacing.sm,
  },
  photo: {
    width: 140,
    height: 100,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  hoursLine: {
    fontSize: 13,
    color: colors.text,
    marginBottom: 2,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  linkText: {
    fontSize: 14,
    color: colors.accent,
    fontWeight: "600",
    flexShrink: 1,
  },
  reviewCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reviewAuthor: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
    flexShrink: 1,
    marginRight: spacing.sm,
  },
  reviewRating: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
  },
  reviewTime: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  reviewText: {
    fontSize: 13,
    color: colors.text,
    marginTop: spacing.xs + 2,
  },
});
