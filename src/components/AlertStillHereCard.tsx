import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ALERT_COLORS, ALERT_LABELS, type AlertDoc } from "@/types/alert";
import { AlertTypeGlyph } from "@/components/AlertTypeGlyph";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

interface Props {
  alert: AlertDoc;
  onStillHere: () => void;
  onNotHere: () => void;
}

// Real, explicit request: an automatic (not tap-to-open) proximity prompt -- MapScreen decides
// WHEN to show this (an alert 1-3 hours old, within 300m, the driver actually heading toward it
// -- see its own effect for the full eligibility check); this component only owns the slide-
// up/down presentation and the two-button response. Colored to match ALERT_COLORS/ALERT_LABELS
// for whichever real alert type this is (police/emergency vehicle/hazard/camera/crash/traffic
// light), same source of truth AlertMarker and AlertDetailSheet already use, so this never
// invents its own color or wording independent of what the alert actually is.
const OFFSCREEN_Y = 180;

export function AlertStillHereCard({ alert, onStillHere, onNotHere }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(OFFSCREEN_Y)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 16,
      stiffness: 180,
      mass: 0.9,
    }).start();
    // Only the initial slide-in -- `alert` changing means a brand new card instance (MapScreen
    // keys its render on the presence of a prompt, not on which alert it is), so this never
    // needs to re-run for the same mounted card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slides back off-screen BEFORE calling the real callback (which does the Firestore vote and
  // clears MapScreen's prompt state, unmounting this) -- so what the driver sees is one smooth
  // "answered, then it's gone" motion instead of an abrupt disappearance the instant they tap.
  const respond = (callback: () => void) => {
    Animated.timing(translateY, {
      toValue: OFFSCREEN_Y,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) callback();
    });
  };

  const accentColor = ALERT_COLORS[alert.type];
  const label = ALERT_LABELS[alert.type];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + spacing.lg, transform: [{ translateY }] }]}
    >
      <View style={[styles.card, { borderTopColor: accentColor }]}>
        <View style={styles.headerRow}>
          <View style={[styles.iconWrap, { backgroundColor: accentColor }]}>
            <AlertTypeGlyph type={alert.type} size={22} color="#FFFFFF" />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.title}>{label} still here?</Text>
            <Text style={styles.subtitle}>You're approaching where this was reported</Text>
          </View>
        </View>
        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => respond(onNotHere)}
            style={({ pressed }) => [styles.button, styles.notHereButton, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={styles.notHereText}>Not here</Text>
          </Pressable>
          <Pressable
            onPress={() => respond(onStillHere)}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: accentColor },
              pressed && { opacity: pressedOpacity },
            ]}
          >
            <Text style={styles.stillHereText}>Still here</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderTopWidth: 4,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.high,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  notHereButton: {
    backgroundColor: "#F3F4F6",
  },
  notHereText: {
    color: "#374151",
    fontWeight: "700",
    fontSize: 14,
  },
  stillHereText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
});
