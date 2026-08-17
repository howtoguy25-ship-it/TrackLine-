import React, { forwardRef, useMemo } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Linking, Image } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { PlaceInfo } from "@/services/places";
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
}

export const PlaceInfoSheet = forwardRef<BottomSheet, Props>(function PlaceInfoSheet(
  { place, onClose, onSheetChange, onGetDirections },
  ref
) {
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ["50%"], []);

  return (
    <BottomSheet
      ref={ref}
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
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.statusRow}>
              {place.rating != null && (
                <View style={styles.ratingWrap}>
                  <Ionicons name="star" size={14} color="#F59E0B" />
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
              {onGetDirections && (
                <Pressable
                  onPress={() => onGetDirections(place)}
                  style={({ pressed }) => [
                    styles.directionsButton,
                    { marginLeft: "auto" },
                    pressed && { opacity: pressedOpacity },
                  ]}
                >
                  <Ionicons name="navigate" size={14} color="#FFFFFF" />
                  <Text style={styles.directionsButtonText}>Directions</Text>
                </Pressable>
              )}
            </View>

            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              {place.photoUrls.length > 0 && (
                <ScrollView
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
                      <Ionicons name="call-outline" size={16} color={colors.accent} />
                      <Text style={styles.linkText}>{place.phoneNumber}</Text>
                    </Pressable>
                  )}
                  {place.website && (
                    <Pressable
                      style={({ pressed }) => [styles.linkRow, pressed && { opacity: pressedOpacity }]}
                      onPress={() => Linking.openURL(place.website!)}
                    >
                      <Ionicons name="globe-outline" size={16} color={colors.accent} />
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
                          <MaterialCommunityIcons name="star" size={12} color="#F59E0B" />
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
            </ScrollView>
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
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
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
  directionsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  directionsButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
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
