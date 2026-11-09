import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "@/context/AuthContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

// Waze-style main menu, opened from the Menu button on the home map (see MapScreen.tsx).
// This is a deliberately minimal first slice -- the full designed panel (Tracky mascot, "Plan a
// drive" card, calendar events, Inbox, Invite a friend, Help) is Phase 4's own build; this phase
// only needs the button to lead somewhere real rather than nowhere. Settings and Account are
// both real, already-existing destinations.
export function MainMenuScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const isSignedIn = !!user && !user.isAnonymous;

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Menu</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel="Close menu"
        >
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <MenuRow
          icon="person-circle-outline"
          label={isSignedIn ? `Signed in as ${user!.email ?? user!.displayName ?? "you"}` : "Sign in"}
          onPress={() => navigation.navigate(isSignedIn ? "Settings" : "SignIn")}
        />
        <MenuRow icon="settings-outline" label="Settings" onPress={() => navigation.navigate("Settings")} />
      </ScrollView>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
      accessibilityLabel={label}
    >
      <View style={styles.rowIconWrap}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
});
