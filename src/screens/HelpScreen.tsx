import React from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { View, Pressable, StyleSheet, ScrollView, Linking } from "react-native";
import { Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";

// Real, explicit request (Waze-style redesign Phase 4 -- main menu's Help row). Honest, real
// answers about how this app's own actual features work (not placeholder lorem-ipsum text) plus
// a real contact email -- the same support@tracklinemaps.com address already used as this app's
// own real contact in osmPlaces.ts's Overpass User-Agent.
const FAQ: { question: string; answer: string }[] = [
  {
    question: "Where do alerts (police, hazards, cameras) come from?",
    answer:
      "Every alert is reported by a real driver using TrackLine -- a community-sourced report, not a licensed government feed. They can be stale or wrong, which is why they auto-expire.",
  },
  {
    question: "Is AI Vehicle Detection recording or storing video?",
    answer:
      "No. The camera feed is analyzed on-device in real time and never recorded or saved. A cropped image of a detected number plate may be sent to a third-party plate-recognition service only if that optional feature is turned on.",
  },
  {
    question: "Why can't I pick a departure time further in the future for Plan a Drive?",
    answer:
      "TrackLine has no scheduled/unattended-start feature -- Plan a Drive's time presets only preview a predicted ETA for that departure time; tapping Start always begins routing right now.",
  },
  {
    question: "Can other people see my reported alerts or recorded voice clips?",
    answer:
      "Reported alerts are anonymous to other drivers (only you can delete your own). Recorded voice clips are stored privately in your own account and never shared.",
  },
];

export function HelpScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Help</Text>
        <Button
          variant="ghost"
          icon="close"
          iconColor={colors.textMuted}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Close"
        />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        {FAQ.map((item) => (
          <View key={item.question} style={styles.faqItem}>
            <Text style={styles.question}>{item.question}</Text>
            <Text style={styles.answer}>{item.answer}</Text>
          </View>
        ))}

        <Pressable
          onPress={() => Linking.openURL("mailto:support@tracklinemaps.com")}
          style={({ pressed }) => [styles.contactRow, pressed && { opacity: pressedOpacity }]}
        >
          <Icon name="mail-outline" size={20} color={colors.accent} />
          <Text style={styles.contactText}>Contact support@tracklinemaps.com</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  faqItem: { marginBottom: spacing.lg },
  question: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: 4 },
  answer: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  contactText: { fontSize: 14, fontWeight: "700", color: colors.accent },
});
