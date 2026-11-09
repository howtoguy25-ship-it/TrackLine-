import React from "react";
import { Pressable, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadow, pressedOpacity } from "@/theme/tokens";

interface Props {
  onPress: () => void;
  // Real unread count -- see MainMenuScreen/inbox.ts. Zero (no badge rendered) is a genuine
  // "nothing unread" state, not a placeholder; this never shows a number that wasn't actually
  // counted from real data.
  unreadCount: number;
  style?: object;
}

// Waze-style top-left square white rounded "Menu" button -- see MapScreen.tsx's own Phase 1
// layout comment for where this sits relative to the Compass button directly under it.
export function MenuButton({ onPress, unreadCount, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, style, pressed && { opacity: pressedOpacity }]}
      accessibilityLabel={unreadCount > 0 ? `Menu, ${unreadCount} unread` : "Menu"}
    >
      <Ionicons name="menu" size={32} color={colors.text} />
      {unreadCount > 0 && <View style={styles.badge} pointerEvents="none" />}
    </Pressable>
  );
}

// Real, explicit request (Waze-style redesign, Phase 1B section 9) -- literal 72pt. Unlike the
// nav instruction card/bottom banner elsewhere in this redesign, this button doesn't share a
// row with other controls, so the literal spec size is used as-is rather than scaled down.
const styles = StyleSheet.create({
  button: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...shadow.medium,
  },
  badge: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
});
