import React from "react";
import { View, Text, Pressable, StyleSheet, Modal } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Tracky } from "@/components/trackys/Tracky";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

const EXPLAINER_SHOWN_KEY = "@trackline/ghostModeExplainerShown";

export async function hasSeenGhostModeExplainer(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(EXPLAINER_SHOWN_KEY)) === "true";
  } catch {
    return true;
  }
}

export async function markGhostModeExplainerSeen(): Promise<void> {
  await AsyncStorage.setItem(EXPLAINER_SHOWN_KEY, "true").catch(() => {});
}

interface Props {
  visible: boolean;
  onStayHidden: () => void;
  onBecomeVisible: () => void;
}

// Real, explicit request -- "Default for new users: GHOST MODE (opt-in to be visible), first-
// launch explainer." settings.visibility already defaults to "ghost" (see services/settings.ts)
// before this ever shows, so this is purely informational -- "Stay hidden" just dismisses it,
// "Let others see me" is the one real opt-in action that flips it to "everyone". Shown once ever
// per device, gated by hasSeenGhostModeExplainer/markGhostModeExplainerSeen above -- see
// MapScreen.tsx's own mount effect for where that check happens.
export function GhostModeExplainerModal({ visible, onStayHidden, onBecomeVisible }: Props) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onStayHidden}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.trackyRow}>
            <Tracky mood="spooky" size={64} animated={false} reactOnTap={false} translucent />
          </View>
          <Text style={styles.title}>You&apos;re invisible by default</Text>
          <Text style={styles.body}>
            TrackLine starts every driver in Ghost mode -- other drivers can&apos;t see you on
            the map. You can still see everyone else&apos;s alerts and report your own,
            anonymously.
          </Text>
          <Text style={styles.body}>
            If you&apos;d like other nearby drivers to see your Tracky while you drive, you can
            turn that on any time from the Menu or Settings &gt; Privacy.
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.button, pressed && { opacity: pressedOpacity }]}
              onPress={onBecomeVisible}
            >
              <Text style={styles.buttonTextMuted}>Let others see me</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.button, styles.buttonPrimary, pressed && { opacity: pressedOpacity }]}
              onPress={onStayHidden}
            >
              <Text style={styles.buttonTextPrimary}>Stay hidden</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.high,
  },
  trackyRow: { alignItems: "center", marginBottom: spacing.sm },
  title: { fontSize: 18, fontWeight: "800", color: colors.text, textAlign: "center", marginBottom: spacing.sm },
  body: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.sm },
  actions: { flexDirection: "column", gap: spacing.sm, marginTop: spacing.md },
  button: { paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: "center" },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonTextMuted: { fontSize: 14, fontWeight: "700", color: colors.textMuted },
  buttonTextPrimary: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
});
