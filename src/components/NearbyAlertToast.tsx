import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, Pressable } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import { ALERT_COLORS, ALERT_ICONS, ALERT_LABELS, type AlertType } from "@/types/alert";

export interface NearbyAlertNotification {
  id: string;
  type: AlertType;
  distanceM: number;
}

interface Props {
  notification: NearbyAlertNotification | null;
  onDismiss: () => void;
}

// Real, explicit request -- a small, simple, dismissible notification when another user reports
// an alert within ~1km, shown ONE AT A TIME in sequence rather than stacking/overlaying the
// screen. The queueing itself lives in MapScreen.tsx (a real FIFO array, advancing to the next
// notification on dismiss/timeout) -- this component only ever renders the single CURRENT one,
// the same "one small toast, not a pile of them" shape AlertBanner already uses elsewhere in this
// app, just type-aware (icon/color/label per real AlertType) and carrying a real computed
// distance instead of a fixed message.
export function NearbyAlertToast({ notification, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const visible = notification != null;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : -120,
      useNativeDriver: true,
      bounciness: 6,
    }).start();

    if (visible) {
      const timer = setTimeout(onDismiss, 5000);
      return () => clearTimeout(timer);
    }
  }, [visible, notification?.id]);

  if (!notification) return null;

  const distanceLabel =
    notification.distanceM < 1000 ? `${Math.round(notification.distanceM)}m away` : `${(notification.distanceM / 1000).toFixed(1)}km away`;

  return (
    <Animated.View
      style={[
        styles.toast,
        { top: insets.top + spacing.md, borderLeftColor: ALERT_COLORS[notification.type], transform: [{ translateY }] },
      ]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <MaterialCommunityIcons
        name={ALERT_ICONS[notification.type] as keyof typeof MaterialCommunityIcons.glyphMap}
        size={20}
        color={ALERT_COLORS[notification.type]}
      />
      <Text style={styles.text} numberOfLines={1}>
        {ALERT_LABELS[notification.type]} reported {distanceLabel}
      </Text>
      <Pressable onPress={onDismiss} hitSlop={12} accessibilityLabel="Dismiss" style={({ pressed }) => pressed && { opacity: pressedOpacity }}>
        <MaterialCommunityIcons name="close" size={18} color={colors.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderLeftWidth: 4,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    ...shadow.high,
  },
  text: {
    color: colors.text,
    fontWeight: "600",
    fontSize: 14,
    flex: 1,
  },
});
