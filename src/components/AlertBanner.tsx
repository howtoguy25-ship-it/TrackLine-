import React, { useEffect, useState } from "react";
import { useLatest } from "@/hooks/useLatest";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Animated, StyleSheet } from "react-native";
import { Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, spacing } from "@/theme/tokens";

interface Props {
  visible: boolean;
  message: string;
  onDismiss: () => void;
}

export function AlertBanner({ visible, message, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useState(() => new Animated.Value(-120))[0];
  const onDismissRef = useLatest(onDismiss);

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : -120,
      useNativeDriver: true,
      bounciness: 6,
    }).start();

    if (visible) {
      const timer = setTimeout(() => onDismissRef.current(), 6000);
      return () => clearTimeout(timer);
    }
  }, [visible, translateY, onDismissRef]);

  return (
    <Animated.View
      style={[styles.banner, { top: insets.top + spacing.md, transform: [{ translateY }] }]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <Icon name="ambulance" size={22} color="#FFFFFF" />
      <Text style={styles.text}>{message}</Text>
      <Button
        variant="ghost"
        icon="close"
        iconColor="#FFFFFF"
        onPress={onDismiss}
        accessibilityLabel="Close"
      />
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
