import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Tracky } from "@/components/trackys/Tracky";
import { TRACKY_MOODS, TRACKY_MOOD_ORDER, isMoodUnlocked } from "@/components/trackys/moods";
import { useTrackyMood } from "@/hooks/useTrackyMood";
import { useSettings } from "@/context/SettingsContext";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

// Real, explicit request -- "Profile → 'Your mood': grid of all moods (locked ones show how to
// unlock... selected mood ticked, preview animates)". This screen is just that grid for now --
// the ADD-ON "Make your Tracky" customiser (colour/eyes/mouth/headwear/etc. tabs) is its own,
// separate, not-yet-started pass per the user's own explicit sequencing choice; this is Part 1's
// real, complete scope.
export function TrackyProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { settings } = useSettings();
  const isGhostMode = settings.visibility === "ghost";
  const { displayMood, selected, drivingStreakDays, setMood, setAuto } = useTrackyMood(isGhostMode);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Tracky</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.previewRow}>
        <Tracky mood={displayMood} size={120} animated reactOnTap />
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.sectionLabel}>Your mood</Text>
        {selected !== "auto" && (
          <Pressable onPress={setAuto} hitSlop={8}>
            <Text style={styles.autoLink}>Back to auto</Text>
          </Pressable>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {TRACKY_MOOD_ORDER.map((key) => {
            const mood = TRACKY_MOODS[key];
            const unlocked = isMoodUnlocked(mood, {
              drivingStreakDays,
              isGhostMode,
              isBirthdayToday: displayMood === "birthday" && mood.key === "birthday",
            });
            const isSelected = selected === key;
            return (
              <Pressable
                key={key}
                style={({ pressed }) => [styles.tile, isSelected && styles.tileSelected, pressed && unlocked && { opacity: pressedOpacity }]}
                onPress={() => unlocked && setMood(key)}
                disabled={!unlocked}
                accessibilityLabel={mood.label}
              >
                <View style={!unlocked && styles.tileLocked}>
                  <Tracky mood={key} size={44} animated={false} reactOnTap={false} />
                </View>
                {!unlocked && (
                  <View style={styles.lockBadge}>
                    <Ionicons name="lock-closed" size={11} color="#FFFFFF" />
                  </View>
                )}
                {isSelected && (
                  <View style={styles.checkBadge}>
                    <Ionicons name="checkmark" size={11} color="#FFFFFF" />
                  </View>
                )}
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {mood.label}
                </Text>
                {!unlocked && !!mood.unlockHint && (
                  <Text style={styles.tileHint} numberOfLines={2}>
                    {mood.unlockHint}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  previewRow: { alignItems: "center", paddingVertical: spacing.lg },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  autoLink: { fontSize: 13, fontWeight: "700", color: colors.accent },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingBottom: spacing.xl },
  tile: {
    width: "22%",
    alignItems: "center",
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    position: "relative",
  },
  tileSelected: { backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.accent },
  tileLocked: { opacity: 0.35 },
  lockBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
  },
  tileLabel: { fontSize: 11, fontWeight: "700", color: colors.text, marginTop: 2, textAlign: "center" },
  tileHint: { fontSize: 9, color: colors.textFaint, textAlign: "center", marginTop: 1 },
});
