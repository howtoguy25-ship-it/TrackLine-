import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { SETTINGS_CATEGORY_LABELS, SETTINGS_CATEGORY_ICONS, type SettingsCategory } from "@/screens/SettingsScreen";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

// Real, explicit request (Waze-style redesign Phase 5) -- the top-level landing screen for
// Settings, Waze-style: a short list of categories rather than the old single ~2000-line flat
// scroll. Each card opens the exact same SettingsScreen, filtered to that category's own real
// sections (see SettingsScreen.tsx's own shouldShow/CATEGORY_SECTIONS) -- a navigation param,
// not a separate duplicated screen, so every section's existing state/handlers stay in the one
// place they already lived.
const CATEGORY_ORDER: SettingsCategory[] = [
  "account",
  "privacy",
  "mapDisplay",
  "navigationVoice",
  "alertsCommunity",
  "vehicleAI",
  ...(__DEV__ ? (["developer"] as SettingsCategory[]) : []),
];

export function SettingsCategoriesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      {CATEGORY_ORDER.map((category) => (
        <Pressable
          key={category}
          style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
          onPress={() => navigation.navigate("Settings", { category })}
          accessibilityLabel={SETTINGS_CATEGORY_LABELS[category]}
        >
          <View style={styles.rowIconWrap}>
            <Ionicons name={SETTINGS_CATEGORY_ICONS[category]} size={20} color={colors.accent} />
          </View>
          <Text style={styles.rowLabel}>{SETTINGS_CATEGORY_LABELS[category]}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
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
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
});
