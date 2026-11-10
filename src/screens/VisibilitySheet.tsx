import React, { forwardRef } from "react";
import { View, Text, Pressable, StyleSheet, Switch } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSettings } from "@/context/SettingsContext";
import type { VisibilityMode } from "@/services/settings";
import { Tracky } from "@/components/trackys/Tracky";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

const SNAP_POINTS = ["62%"];

const VISIBILITY_OPTIONS: { key: VisibilityMode; label: string; description: string }[] = [
  { key: "everyone", label: "Visible to everyone", description: "Other drivers nearby can see your Tracky on the map while you're driving" },
  { key: "friendsOnly", label: "Friends only", description: "Only drivers you've added as a friend can see you" },
  { key: "ghost", label: "Ghost mode", description: "Invisible to everyone -- you can still see and report alerts" },
];

interface Props {
  onClose: () => void;
  onSheetChange?: (index: number) => void;
  onOpenPrivacySettings: () => void;
}

// Real, explicit request (Ghost mode + visibility control) -- opened by a long-press on the
// home map's own Menu button (see MapScreen.tsx/MenuButton.tsx). "Big switch" is the Visible/
// Ghost toggle up top (the fast, one-tap path real drivers actually use); the three-way radio
// group underneath is the same full picker Settings > Privacy exposes, kept in sync with it
// since both read/write the exact same settings.visibility field.
export const VisibilitySheet = forwardRef<BottomSheet, Props>(function VisibilitySheet(
  { onClose, onSheetChange, onOpenPrivacySettings },
  ref
) {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useSettings();
  const isGhost = settings.visibility === "ghost";

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onChange={onSheetChange}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Your visibility</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.bigToggleRow}>
          <Tracky mood={isGhost ? "spooky" : "happy"} size={48} animated={false} reactOnTap={false} translucent={isGhost} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bigToggleLabel}>{isGhost ? "Ghost mode" : "Visible to other drivers"}</Text>
            <Text style={styles.bigToggleDescription}>
              {isGhost
                ? "Other drivers can't see you right now."
                : "Other drivers nearby can see your Tracky while you're driving."}
            </Text>
          </View>
          <Switch
            value={!isGhost}
            onValueChange={(value) => updateSettings({ visibility: value ? "everyone" : "ghost" })}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>

        <Text style={styles.sectionLabel}>Who can see you</Text>
        {VISIBILITY_OPTIONS.map((option) => {
          const selected = settings.visibility === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => updateSettings({ visibility: option.key })}
              style={({ pressed }) => [styles.radioRow, pressed && { opacity: pressedOpacity }]}
              accessibilityLabel={`${option.label}. ${option.description}`}
            >
              <View style={styles.radioTextWrap}>
                <Text style={styles.radioLabel}>{option.label}</Text>
                <Text style={styles.radioDescription}>{option.description}</Text>
              </View>
              <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                {selected && <View style={styles.radioInner} />}
              </View>
            </Pressable>
          );
        })}

        <View style={styles.divider} />

        <Pressable
          onPress={onOpenPrivacySettings}
          style={({ pressed }) => [styles.linkRow, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel="More privacy settings"
        >
          <View style={styles.rowTextWrap}>
            <Text style={styles.radioLabel}>More privacy settings</Text>
            <Text style={styles.radioDescription}>Show my name on reports, auto-ghost behaviour</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  handleIndicator: {
    backgroundColor: colors.surfaceMuted,
    width: 40,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
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
  bigToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    ...shadow.low,
  },
  bigToggleLabel: { fontSize: 15, fontWeight: "800", color: colors.text },
  bigToggleDescription: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    gap: spacing.md,
  },
  radioTextWrap: {
    flex: 1,
  },
  rowTextWrap: {
    flex: 1,
  },
  radioLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  radioDescription: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterSelected: {
    borderColor: colors.accent,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 4,
    gap: spacing.md,
  },
});
