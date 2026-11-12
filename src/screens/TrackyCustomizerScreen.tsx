import React, { useEffect, useMemo, useState } from "react";
import { View, Pressable, StyleSheet, ScrollView } from "react-native";
import { Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Tracky } from "@/components/trackys/Tracky";
import {
  BODY_COLOR_PALETTE,
  EYE_STYLE_OPTIONS,
  MOUTH_STYLE_OPTIONS,
  ACCESSORY_OPTIONS,
  TRAIL_OPTIONS,
  TRACKY_PRESETS,
  isCustomizationUnlocked,
  type TrackyCustomization,
} from "@/components/trackys/customization";
import { isUnlocked, type TrackyUnlockContext } from "@/components/trackys/moods";
import { useTrackyAppearance } from "@/hooks/useTrackyAppearance";
import { useSettings } from "@/context/SettingsContext";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

type TabKey = "presets" | "colour" | "eyes" | "mouth" | "extras" | "trail";

const TABS: { key: TabKey; label: string }[] = [
  { key: "presets", label: "Presets" },
  { key: "colour", label: "Colour" },
  { key: "eyes", label: "Eyes" },
  { key: "mouth", label: "Mouth" },
  { key: "extras", label: "Extras" },
  { key: "trail", label: "Trail" },
];

// Only these three accessories actually read a colour prop (see accessories.tsx's own
// TrackyAccessory dispatcher) -- offering a colour row for any other one would be a control
// that visibly does nothing.
const TINTABLE_ACCESSORIES = new Set(["headband", "cap", "bucketHat"]);

// Real, explicit request (ADD-ON Part A -- "Make your Tracky" customiser). Edits a local DRAFT
// (so the live preview updates instantly without a Firestore write per tap) and only persists
// on Save -- which also flips the driver's appearance mode to "custom", since saving a design
// is the real, explicit act of choosing to show it. "Use my mood instead" is the reverse of
// that: it keeps the saved design but goes back to the auto/selected mood look.
export function TrackyCustomizerScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { settings } = useSettings();
  const isGhostMode = settings.visibility === "ghost";
  const appearance = useTrackyAppearance(isGhostMode);

  const [tab, setTab] = useState<TabKey>("presets");
  const [draft, setDraft] = useState<TrackyCustomization>(appearance.customization);
  const [seededFromSaved, setSeededFromSaved] = useState(false);

  // The saved design arrives asynchronously (AsyncStorage/Firestore) -- seed the draft from it
  // exactly once, the moment it has actually loaded, and never again after that (a later
  // re-seed would silently throw away whatever the driver has tapped since).
  useEffect(() => {
    if (!appearance.loaded || seededFromSaved) return;
    const timer = setTimeout(() => {
      setDraft(appearance.customization);
      setSeededFromSaved(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [appearance.loaded, appearance.customization, seededFromSaved]);

  const unlockCtx: TrackyUnlockContext = useMemo(
    () => ({
      drivingStreakDays: appearance.drivingStreakDays,
      isGhostMode,
      isBirthdayToday: appearance.isBirthdayToday,
    }),
    [appearance.drivingStreakDays, appearance.isBirthdayToday, isGhostMode]
  );

  const draftUnlocked = isCustomizationUnlocked(draft, unlockCtx);

  const onSave = () => {
    if (!draftUnlocked) return;
    appearance.saveCustomization(draft);
    navigation.goBack();
  };

  const onUseMood = () => {
    appearance.setMode("mood");
    navigation.goBack();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Make your Tracky</Text>
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
        <Tracky customization={draft} size={120} animated reactOnTap />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={({ pressed }) => [styles.tab, tab === t.key && styles.tabSelected, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextSelected]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.panel}>
        {tab === "presets" && (
          <View style={styles.grid}>
            {TRACKY_PRESETS.map((preset) => {
              const unlocked = isCustomizationUnlocked(preset.customization, unlockCtx);
              return (
                <Pressable
                  key={preset.key}
                  onPress={() => setDraft(preset.customization)}
                  style={({ pressed }) => [styles.tile, pressed && { opacity: pressedOpacity }]}
                  accessibilityLabel={`${preset.label} preset`}
                >
                  <View style={!unlocked && styles.lockedFade}>
                    <Tracky customization={preset.customization} size={48} animated={false} reactOnTap={false} />
                  </View>
                  {!unlocked && <LockBadge />}
                  <Text style={styles.tileLabel} numberOfLines={1}>
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {tab === "colour" && (
          <>
            <Text style={styles.sectionLabel}>Body colour</Text>
            <View style={styles.swatchRow}>
              {BODY_COLOR_PALETTE.map((c) => (
                <Swatch key={c} color={c} selected={draft.color === c} onPress={() => setDraft({ ...draft, color: c })} />
              ))}
            </View>
            <Text style={styles.sectionLabel}>Two-tone (bottom half)</Text>
            <View style={styles.swatchRow}>
              <Pressable
                onPress={() => setDraft({ ...draft, colorBottom: undefined })}
                style={[styles.swatch, styles.swatchNone, !draft.colorBottom && styles.swatchSelected]}
                accessibilityLabel="No two-tone"
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </Pressable>
              {BODY_COLOR_PALETTE.map((c) => (
                <Swatch key={c} color={c} selected={draft.colorBottom === c} onPress={() => setDraft({ ...draft, colorBottom: c })} />
              ))}
            </View>
          </>
        )}

        {tab === "eyes" && (
          <View style={styles.grid}>
            {EYE_STYLE_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => setDraft({ ...draft, eyeStyle: o.key })}
                style={({ pressed }) => [styles.tile, draft.eyeStyle === o.key && styles.tileSelected, pressed && { opacity: pressedOpacity }]}
              >
                <Tracky customization={{ ...draft, eyeStyle: o.key }} size={44} animated={false} reactOnTap={false} />
                <Text style={styles.tileLabel}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {tab === "mouth" && (
          <View style={styles.grid}>
            {MOUTH_STYLE_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => setDraft({ ...draft, mouthStyle: o.key })}
                style={({ pressed }) => [styles.tile, draft.mouthStyle === o.key && styles.tileSelected, pressed && { opacity: pressedOpacity }]}
              >
                <Tracky customization={{ ...draft, mouthStyle: o.key }} size={44} animated={false} reactOnTap={false} />
                <Text style={styles.tileLabel}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {tab === "extras" && (
          <>
            <View style={styles.grid}>
              <Pressable
                onPress={() => setDraft({ ...draft, accessory: undefined, accessoryColor: undefined })}
                style={({ pressed }) => [styles.tile, !draft.accessory && styles.tileSelected, pressed && { opacity: pressedOpacity }]}
              >
                <Tracky customization={{ ...draft, accessory: undefined }} size={44} animated={false} reactOnTap={false} />
                <Text style={styles.tileLabel}>None</Text>
              </Pressable>
              {ACCESSORY_OPTIONS.map((o) => {
                const unlocked = isUnlocked(o.unlock, unlockCtx);
                return (
                  <Pressable
                    key={o.key}
                    onPress={() => setDraft({ ...draft, accessory: o.key, accessoryColor: undefined })}
                    style={({ pressed }) => [styles.tile, draft.accessory === o.key && styles.tileSelected, pressed && { opacity: pressedOpacity }]}
                    accessibilityLabel={unlocked ? o.label : `${o.label}, locked. ${o.unlockHint ?? ""}`}
                  >
                    <View style={!unlocked && styles.lockedFade}>
                      <Tracky customization={{ ...draft, accessory: o.key, accessoryColor: undefined }} size={44} animated={false} reactOnTap={false} />
                    </View>
                    {!unlocked && <LockBadge />}
                    <Text style={styles.tileLabel} numberOfLines={1}>
                      {o.label}
                    </Text>
                    {!unlocked && !!o.unlockHint && (
                      <Text style={styles.tileHint} numberOfLines={2}>
                        {o.unlockHint}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
            {draft.accessory && TINTABLE_ACCESSORIES.has(draft.accessory) && (
              <>
                <Text style={styles.sectionLabel}>Colour</Text>
                <View style={styles.swatchRow}>
                  {BODY_COLOR_PALETTE.map((c) => (
                    <Swatch
                      key={c}
                      color={c}
                      selected={draft.accessoryColor === c}
                      onPress={() => setDraft({ ...draft, accessoryColor: c })}
                    />
                  ))}
                </View>
              </>
            )}
          </>
        )}

        {tab === "trail" && (
          <>
            <Text style={styles.helper}>
              The trail other drivers see behind your Tracky while you&apos;re moving on their map.
            </Text>
            {TRAIL_OPTIONS.map((o) => {
              const unlocked = isUnlocked(o.unlock, unlockCtx);
              const selected = draft.trail === o.key;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => setDraft({ ...draft, trail: o.key })}
                  style={({ pressed }) => [styles.trailRow, selected && styles.trailRowSelected, pressed && { opacity: pressedOpacity }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trailLabel}>{o.label}</Text>
                    {!unlocked && !!o.unlockHint && <Text style={styles.tileHint}>{o.unlockHint}</Text>}
                  </View>
                  {!unlocked ? (
                    <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
                  ) : selected ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

      {!draftUnlocked && (
        <Text style={styles.lockedNotice}>
          This design uses a part you haven&apos;t unlocked yet -- swap it out to save.
        </Text>
      )}
      <View style={styles.actions}>
        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: pressedOpacity }]} onPress={onUseMood}>
          <Text style={styles.secondaryButtonText}>Use my mood instead</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, !draftUnlocked && styles.primaryButtonDisabled, pressed && draftUnlocked && { opacity: pressedOpacity }]}
          onPress={onSave}
          disabled={!draftUnlocked}
        >
          <Text style={styles.primaryButtonText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Swatch({ color, selected, onPress }: { color: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.swatch, { backgroundColor: color }, selected && styles.swatchSelected]}
      accessibilityLabel={`Colour ${color}`}
    >
      {selected && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
    </Pressable>
  );
}

function LockBadge() {
  return (
    <View style={styles.lockBadge}>
      <Ionicons name="lock-closed" size={11} color="#FFFFFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  previewRow: { alignItems: "center", paddingVertical: spacing.md },
  tabBar: { flexGrow: 0, marginBottom: spacing.sm },
  tabBarContent: { gap: spacing.xs },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  tabSelected: { backgroundColor: colors.accent },
  tabText: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  tabTextSelected: { color: "#FFFFFF" },
  panel: { paddingBottom: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    width: "22%",
    alignItems: "center",
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    position: "relative",
    borderWidth: 2,
    borderColor: "transparent",
  },
  tileSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  tileLabel: { fontSize: 11, fontWeight: "700", color: colors.text, marginTop: 2, textAlign: "center" },
  tileHint: { fontSize: 9, color: colors.textFaint, textAlign: "center", marginTop: 1 },
  lockedFade: { opacity: 0.35 },
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
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.sm },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "transparent",
    ...shadow.low,
  },
  swatchNone: { backgroundColor: colors.surfaceMuted },
  swatchSelected: { borderColor: colors.text },
  helper: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  trailRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: "transparent",
  },
  trailRowSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  trailLabel: { fontSize: 15, fontWeight: "700", color: colors.text },
  lockedNotice: { fontSize: 12, color: colors.danger, textAlign: "center", marginBottom: spacing.sm },
  actions: { flexDirection: "row", gap: spacing.sm },
  secondaryButton: {
    flex: 1,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
  },
  secondaryButtonText: { fontSize: 14, fontWeight: "700", color: colors.text },
  primaryButton: {
    flex: 1,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
  },
  primaryButtonDisabled: { opacity: 0.4 },
  primaryButtonText: { fontSize: 14, fontWeight: "800", color: "#FFFFFF" },
});
