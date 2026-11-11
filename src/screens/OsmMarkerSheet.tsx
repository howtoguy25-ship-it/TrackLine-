import React, { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import { View, Pressable, StyleSheet, Image, ActivityIndicator } from "react-native";
import { Text } from "@/components/AppText";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { env } from "@/config/env";
import type { LatLng } from "@/utils/polyline";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import { TRAFFIC_LIGHT_MARKER, SPEED_CAMERA_MARKER } from "@/utils/osmMarkerStyle";

export type OsmMarkerKind = "traffic_light" | "speed_camera";

interface Props {
  kind: OsmMarkerKind | null;
  location: LatLng | null;
  onClose: () => void;
  onSheetChange?: (index: number) => void;
}

const LABELS: Record<OsmMarkerKind, string> = {
  traffic_light: "Traffic light",
  speed_camera: "Speed camera",
};

// Same icons as the map pin/settings toggle (see osmMarkerStyle.ts) so this sheet matches
// whichever marker was actually tapped.
const ICON_NAMES: Record<OsmMarkerKind, string> = {
  traffic_light: TRAFFIC_LIGHT_MARKER.icon,
  speed_camera: SPEED_CAMERA_MARKER.icon,
};

export const OsmMarkerSheet = forwardRef<BottomSheet, Props>(function OsmMarkerSheet(
  { kind, location, onClose, onSheetChange },
  ref
) {
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ["46%"], []);

  // There's no per-camera/per-light photo dataset -- OSM only gives a coordinate. Real Google
  // Street View imagery *at that exact coordinate* is the closest genuinely real answer to
  // "show me where this is" (vs. just a generic icon on the map), pulling from Google's actual
  // street-level photography rather than anything mocked/placeholder.
  //
  // The single panorama Google has at a given coordinate is sometimes obstructed in the shot
  // itself -- most commonly a large vehicle (a truck, a bus, occasionally Google's own capture
  // car) parked or passing right in front of the lens at the moment that panorama was
  // photographed. There's no way to detect that automatically without running the image
  // through a vision model ourselves, so instead this offers a real, honest manual escape
  // hatch: "Try another angle" first re-crops the SAME panorama from a different heading (a
  // genuinely different photo if the obstruction didn't wrap the whole horizon), and if that's
  // been tried already, probes the Street View Metadata API (a free, imageless lookup) at a
  // few nearby real-world offsets for a DIFFERENT panorama entirely -- an actual different
  // capture instant from Google, not a re-request of the same blocked shot.
  const NEARBY_OFFSET_DEG = 0.00035; // ~35-40m -- close enough to still be "this spot"
  const [altLocation, setAltLocation] = useState<LatLng | null>(null);
  const [headingIndex, setHeadingIndex] = useState(0); // 0 = default heading, 1-4 = 0/90/180/270
  const [findingAngle, setFindingAngle] = useState(false);

  // Fresh marker tapped -- drop any angle/nearby-pano search from the previous one.
  useEffect(() => {
    setAltLocation(null);
    setHeadingIndex(0);
  }, [location?.latitude, location?.longitude]);

  const baseLocation = altLocation ?? location;
  const headingParam = headingIndex > 0 ? `&heading=${(headingIndex - 1) * 90}` : "";
  const streetViewUrl = baseLocation
    ? `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${baseLocation.latitude},${baseLocation.longitude}&fov=80${headingParam}&key=${env.googlePlacesApiKey}`
    : null;

  // Google's Street View Static API returns a real HTTP error body (not a placeholder image)
  // when the request is rejected -- e.g. a 403 with a plain-text "enable billing" message --
  // which React Native's <Image> can't decode, so it just fails silently with no visual
  // feedback unless onLoad/onError are handled explicitly. Reset per URL so switching between
  // markers doesn't show the previous marker's loaded/error state for a beat before the new
  // request resolves.
  const [imageStatus, setImageStatus] = useState<"loading" | "loaded" | "error">("loading");
  useEffect(() => {
    setImageStatus("loading");
  }, [streetViewUrl]);

  const fetchPanoId = useCallback(async (loc: LatLng): Promise<string | null> => {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/streetview/metadata?location=${loc.latitude},${loc.longitude}&key=${env.googlePlacesApiKey}`
      );
      const json = await res.json();
      return json.status === "OK" && json.pano_id ? String(json.pano_id) : null;
    } catch {
      return null;
    }
  }, []);

  const tryAnotherAngle = useCallback(async () => {
    if (!location || findingAngle) return;
    setFindingAngle(true);
    try {
      const currentPanoId = await fetchPanoId(baseLocation ?? location);
      const offsets: LatLng[] = [
        { latitude: location.latitude + NEARBY_OFFSET_DEG, longitude: location.longitude },
        { latitude: location.latitude - NEARBY_OFFSET_DEG, longitude: location.longitude },
        { latitude: location.latitude, longitude: location.longitude + NEARBY_OFFSET_DEG },
        { latitude: location.latitude, longitude: location.longitude - NEARBY_OFFSET_DEG },
      ];
      for (const candidate of offsets) {
        const candidatePanoId = await fetchPanoId(candidate);
        if (candidatePanoId && candidatePanoId !== currentPanoId) {
          setAltLocation(candidate);
          setHeadingIndex(0);
          return;
        }
      }
      // No distinct nearby capture found -- fall back to a different crop angle of the same
      // panorama. Still a real, different photo whenever the obstruction wasn't all-around.
      setHeadingIndex((i) => (i + 1) % 5);
    } finally {
      setFindingAngle(false);
    }
  }, [location, baseLocation, findingAngle, fetchPanoId]);

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
        {kind && location && (
          <>
            <View style={styles.header}>
              <View style={styles.titleRow}>
                <MaterialCommunityIcons name={ICON_NAMES[kind] as any} size={20} color={colors.text} />
                <Text style={styles.title}>{LABELS[kind]}</Text>
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
            <Text style={styles.subtitle}>
              {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
            </Text>
            {streetViewUrl && (
              <View style={styles.imageWrap}>
                <Image
                  source={{ uri: streetViewUrl }}
                  style={styles.image}
                  resizeMode="cover"
                  onLoad={() => setImageStatus("loaded")}
                  onError={() => setImageStatus("error")}
                />
                {imageStatus === "loading" && (
                  <View style={styles.imageOverlay}>
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  </View>
                )}
                {imageStatus === "error" && (
                  <View style={styles.imageOverlay}>
                    <Ionicons name="image-outline" size={22} color={colors.textMuted} />
                    <Text style={styles.imageErrorText}>Street View image unavailable right now</Text>
                  </View>
                )}
                {/* Real fix for a shot blocked by a passing vehicle at capture time -- see
                    tryAnotherAngle's own comment. Not shown while the image itself is still
                    loading/erroring so it never sits on top of that state's own UI. */}
                {imageStatus === "loaded" && (
                  <Pressable
                    onPress={tryAnotherAngle}
                    disabled={findingAngle}
                    hitSlop={10}
                    style={({ pressed }) => [
                      styles.angleButton,
                      pressed && !findingAngle && { opacity: pressedOpacity },
                    ]}
                    accessibilityLabel="Try another angle if this image is blocked"
                  >
                    {findingAngle ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Ionicons name="sync" size={16} color="#FFFFFF" />
                    )}
                  </Pressable>
                )}
              </View>
            )}
            <Text style={styles.caption}>
              Real Google Street View imagery of this spot -- location from OpenStreetMap
              community data. If the shot is blocked (e.g. by a passing truck), tap{" "}
              <Ionicons name="sync" size={11} color={colors.textMuted} /> on the photo to try a
              different real angle or a nearby capture.
            </Text>
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
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  imageWrap: {
    width: "100%",
    aspectRatio: 640 / 360,
    borderRadius: radius.lg,
    marginTop: spacing.md,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imageOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
  },
  imageErrorText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  angleButton: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(17, 24, 39, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  caption: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
});
