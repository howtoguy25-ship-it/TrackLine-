import React, { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Image, Animated } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import { refreshLiveCameraImageUrl, type LiveTrafficCamera } from "@/services/liveTrafficCameras";

interface Props {
  camera: LiveTrafficCamera | null;
  onClose: () => void;
  onSheetChange?: (index: number) => void;
}

// TfNSW republishes each camera's frame on its own schedule (commonly cited as "roughly every
// 60s", but that's not a precise, per-camera guarantee this app can rely on) -- this is a real,
// government-run still-image feed, not a video stream; there is no live video endpoint for
// these cameras in the public dataset. Polling every 5s doesn't create motion that isn't there,
// but it does mean whenever TfNSW actually does publish a new frame, this app shows it within
// 5s instead of sitting on a stale one for up to a minute -- the real, direct fix for "says LIVE
// but looks frozen" within what this data source can actually support. The cost is re-fetching
// an unchanged frame most ticks, which is a small JPEG and only happens while this sheet is
// open, not a background drain.
const IMAGE_REFRESH_MS = 5_000;

export const LiveCameraSheet = forwardRef<BottomSheet, Props>(function LiveCameraSheet(
  { camera, onClose, onSheetChange },
  ref
) {
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ["46%"], []);
  const [src, setSrc] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // Ticks once a second purely to re-render the "Updated Xs ago" text below -- lastUpdatedAt
  // itself only changes once a minute, so without this the label would freeze at "0s ago" until
  // the next real frame landed instead of counting up live.
  const [, setClockTick] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const livePulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!camera) return;
    setImageLoaded(false);
    setLoadError(false);
    setSrc(refreshLiveCameraImageUrl(camera.imageUrl));
    const refreshId = setInterval(() => {
      setLoadError(false);
      setSrc(refreshLiveCameraImageUrl(camera.imageUrl));
    }, IMAGE_REFRESH_MS);
    const clockId = setInterval(() => setClockTick((t) => t + 1), 1000);
    return () => {
      clearInterval(refreshId);
      clearInterval(clockId);
    };
  }, [camera?.imageUrl]);

  // Real crossfade between successive frames -- previously a new frame just snapped in the
  // instant it finished loading, which read as a jarring flicker every refresh. Fading the new
  // frame in over the old one makes each real update look like a deliberate live refresh instead
  // of a broken reload.
  useEffect(() => {
    if (!imageLoaded) return;
    setLastUpdatedAt(Date.now());
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [imageLoaded, fadeAnim]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(livePulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [livePulse]);

  const updatedSecondsAgo = lastUpdatedAt ? Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000)) : null;
  const updatedText =
    updatedSecondsAgo === null ? "Loading…" : updatedSecondsAgo < 2 ? "Updated just now" : `Updated ${updatedSecondsAgo}s ago`;

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
        {camera && src && (
          <>
            <View style={styles.header}>
              <View style={styles.titleRow}>
                <Ionicons name="videocam" size={20} color={colors.text} />
                <Text style={styles.title}>{camera.title}</Text>
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
            {(camera.view || camera.direction) && (
              <Text style={styles.subtitle}>
                {[camera.view, camera.direction && `Facing ${camera.direction}`].filter(Boolean).join(" · ")}
              </Text>
            )}
            <View style={styles.imageWrap}>
              <Animated.Image
                source={{ uri: src }}
                style={[styles.image, { opacity: fadeAnim }]}
                resizeMode="cover"
                onLoad={() => {
                  setImageLoaded(true);
                  setLoadError(false);
                }}
                onError={() => setLoadError(true)}
              />
              <View style={styles.liveBadge}>
                <Animated.View style={[styles.liveDot, { opacity: livePulse }]} />
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
              {loadError && (
                <View style={[StyleSheet.absoluteFill, styles.errorOverlay]} pointerEvents="none">
                  <Ionicons name="cloud-offline-outline" size={22} color="#FFFFFF" />
                  <Text style={styles.errorOverlayText}>Camera feed unavailable -- retrying…</Text>
                </View>
              )}
            </View>
            <View style={styles.footerRow}>
              <Text style={styles.caption}>
                Real live NSW government traffic camera (Transport for NSW open data).
              </Text>
              <Text style={styles.updatedText}>{updatedText}</Text>
            </View>
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
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    flexShrink: 1,
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
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    marginTop: spacing.md,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  liveBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.danger,
  },
  liveBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  errorOverlay: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  errorOverlayText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  caption: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
  },
  updatedText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textFaint,
  },
});
