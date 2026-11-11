import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Pressable } from "react-native";
import { Text } from "@/components/AppText";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

interface Props {
  visible: boolean;
  message: string;
  onDismiss: () => void;
}

export function AlertBanner({ visible, message, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : -120,
      useNativeDriver: true,
      bounciness: 6,
    }).start();

    if (visible) {
      const timer = setTimeout(onDismiss, 6000);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  return (
    <Animated.View
      style={[styles.banner, { top: insets.top + spacing.md, transform: [{ translateY }] }]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <MaterialCommunityIcons name="ambulance" size={22} color="#FFFFFF" />
      <Text style={styles.text}>{message}</Text>
      <Pressable onPress={onDismiss} hitSlop={12} style={({ pressed }) => pressed && { opacity: pressedOpacity }}>
        <MaterialCommunityIcons name="close" size={20} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.danger,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    ...shadow.high,
  },
  text: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15,
    flex: 1,
  },
});
